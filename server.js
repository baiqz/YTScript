'use strict';
/**
 * YT Script · YouTube 视频文稿提取工具 —— 本地服务
 *
 * 零外部依赖，仅使用 Node 内置模块。
 *
 *   node server.js [--port 8790] [--host 127.0.0.1] [--proxy http://127.0.0.1:7890] [--no-open]
 *
 * 直接双击 start.bat 即可：会自动打开浏览器，端口被占用时自动顺延，
 * 若本应用已经在跑则直接把页面调出来，不会报错。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');

const { setProxy, ensureTransport, request, getProxyInfo } = require('./lib/http-client');
const { json } = require('./lib/api-respond');
const config = require('./lib/config');
const { safeEqual } = require('./lib/guard');

const transcriptHandler = require('./api/transcript');
const healthHandler = require('./api/health');
const proxyHandler = require('./api/proxy');

/* ---------------------------- 启动参数 ---------------------------- */

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/*
 * 中继模式（--relay）：本实例会被公网隧道暴露出去，供云端函数转发取数请求。
 * 这时它是「对外服务」，安全边界必须收紧：
 *   - 改代理接口直接 403 —— 否则任何路过的人都能把出口指向别处，等于送人一个 SSRF；
 *   - 其余 /api/* 一律校验中继令牌，区分「云端的合法转发」和「随便路过的人」；
 *   - 只有 /api/health 保持开放（不含敏感信息，且被用来探活排障）。
 * 令牌优先取环境变量，没有就自动生成并写进 config.json（该文件不入库）。
 */
const RELAY_MODE = config.isRelayMode();
const RELAY_TOKEN = RELAY_MODE ? config.ensureRelayToken() : '';

// 中继模式换一个默认端口：本地日常那份服务通常已经占着 8790，
// 而且隧道要指向固定端口，两者冲突会很难查
const BASE_PORT = Number(argValue('--port') || process.env.PORT || (RELAY_MODE ? 8801 : 8790));
const HOST = argValue('--host') || '127.0.0.1';
const NO_OPEN = process.argv.includes('--no-open') || process.env.WB_NO_OPEN === '1';
const MAX_PORT_TRIES = 10;
const PUBLIC_DIR = path.join(__dirname, 'public');

if (argValue('--proxy')) setProxy(argValue('--proxy'));

/* ---------------------------- 静态资源 ---------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // 前端路由兜底
      if (!path.extname(filePath)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, b2) =>
          e2
            ? send(res, 404, 'text/plain; charset=utf-8', 'Not Found')
            : send(res, 200, MIME['.html'], b2)
        );
      }
      return send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
    }
    send(res, 200, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', buf);
  });
}

/* ------------------------------ 路由 ------------------------------ */

const API_ROUTES = {
  '/api/transcript': transcriptHandler,
  '/api/health': healthHandler,
  '/api/proxy': proxyHandler,
};

/** 中继模式下校验令牌（支持请求头与 ?token= 两种带法） */
function relayAuthorized(req) {
  if (!RELAY_MODE) return true;
  if (!RELAY_TOKEN) return false;
  const h = req.headers || {};
  const fromHeader = h['x-relay-token'] || '';
  let fromQuery = '';
  try {
    fromQuery = new URL(req.url, 'http://x').searchParams.get('token') || '';
  } catch {
    /* ignore */
  }
  const given = String(fromHeader || fromQuery);
  return given ? safeEqual(given, RELAY_TOKEN) : false;
}

/** 中继模式下这个端口是公网可达的，先把该拦的都拦掉 */
function guardRelay(req, res, pathname) {
  if (!RELAY_MODE || !pathname.startsWith('/api/')) return false;

  if (pathname === '/api/proxy') {
    json(res, 403, {
      ok: false,
      error: '中继模式下不允许远程修改出口代理',
      code: 'FORBIDDEN',
    });
    return true;
  }

  // 健康检查保持开放：不含敏感信息，且要供探活与排障使用
  if (pathname === '/api/health') return false;

  if (!relayAuthorized(req)) {
    json(res, 401, {
      ok: false,
      error: '缺少或错误的中继令牌',
      code: 'RELAY_UNAUTHORIZED',
      hint: '这个端口已对外暴露，只有携带正确 X-Relay-Token 的请求才会被受理。',
    });
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;

  if (guardRelay(req, res, p)) return;

  const handler = API_ROUTES[p];
  if (handler) {
    try {
      return await handler(req, res);
    } catch (e) {
      if (!res.headersSent) return json(res, 500, { ok: false, error: e.message, code: 'INTERNAL' });
      return;
    }
  }

  /* 本地专用：直接把一次 YouTube 探活结果返回，方便排查网络 */
  if (p === '/api/ping') {
    const started = Date.now();
    try {
      const r = await request('https://www.youtube.com/robots.txt', { retries: 0, timeout: 8000 });
      return json(res, 200, {
        ok: r.status === 200,
        status: r.status,
        ms: Date.now() - started,
        ...getProxyInfo(),
      });
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message, ms: Date.now() - started, ...getProxyInfo() });
    }
  }

  if (p.startsWith('/api/')) return json(res, 404, { ok: false, error: 'Not Found', code: 'NOT_FOUND' });

  return serveStatic(req, res);
});

/* ---------------------------- 打开浏览器 ---------------------------- */

function openBrowser(url) {
  if (NO_OPEN) return;

  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  let attempts;
  if (process.platform === 'win32') {
    attempts = [
      [path.join(sysRoot, 'System32', 'cmd.exe'), ['/c', 'start', '', url]],
      [path.join(sysRoot, 'explorer.exe'), [url]],
      ['cmd', ['/c', 'start', '', url]],
    ];
  } else if (process.platform === 'darwin') {
    attempts = [['open', [url]]];
  } else {
    attempts = [['xdg-open', [url]]];
  }

  for (const [file, args] of attempts) {
    // 绝对路径但文件不存在时跳过，换下一个候选；
    // 一律用绝对路径是因为部分环境下 PATH 不完整，裸命令名会 ENOENT
    if (file.includes('\\') || file.includes('/')) {
      if (!fs.existsSync(file)) continue;
    }
    try {
      const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {});
      child.unref();
      return;
    } catch {
      /* 换下一个候选 */
    }
  }
  console.log('  （没能自动打开浏览器，请手动访问上面的地址）');
}

/* --------------------- 端口占用 / 重复启动处理 --------------------- */

const SERVICE_TAG = 'ytscript';

/** 探测某个端口上是否已经是本应用在运行 */
function probeSelf(port, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve(j && j.ok === true && j.service === SERVICE_TAG ? j : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

function listenOnce(port) {
  return new Promise((resolve) => {
    const onError = (e) => {
      server.removeListener('listening', onListening);
      resolve(e);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(null);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

function describeTransport(info) {
  if (!info || !info.transport) return '尚未判定（首次提取时自动确定）';
  return info.transport === 'proxy' ? `代理 ${info.activeProxy}` : '直连';
}

async function onReady(port) {
  const url = `http://${HOST}:${port}`;
  console.log(`  本地地址   ${url}`);
  console.log(`  资源目录   ${PUBLIC_DIR}`);
  console.log('');
  console.log('  浏览器会自动打开。若没反应，手动访问上面的地址即可。');
  console.log('  按 Ctrl+C 停止服务。');

  if (RELAY_MODE) {
    console.log('');
    console.log('  中继模式已开启 —— 本端口经由隧道对外提供服务');
    console.log(`  中继令牌   ${RELAY_TOKEN}`);
    console.log('  1) 把上面的令牌填到部署平台的 RELAY_TOKEN 环境变量');
    console.log('  2) 把隧道给出的公网地址填到 RELAY_URL');
    console.log('  安全边界：/api/proxy 已禁用，其余 /api/* 均需令牌');
  }

  console.log(`${'─'.repeat(56)}\n`);

  server.on('error', (e) => {
    console.error('\n服务异常:', e.message, '\n');
    process.exit(1);
  });

  // 先把浏览器调起来，不要让网络探测挡在前面：
  // 探测要并行试十几条候选通路，耗时几秒，页面本身并不需要等它。
  openBrowser(url);

  // 探测放到后台，结果出来了再补一行日志
  ensureTransport(true)
    .then((t) => {
      const info = getProxyInfo();
      console.log(`  [网络] 通路：${describeTransport({ ...info, transport: t })}（候选 ${info.candidates.length} 条）`);
      if (info.transportError) console.log(`  [网络] ${info.transportError}`);
    })
    .catch((e) => {
      console.log(`  [网络] 探测异常：${e.message}`);
    });
}

async function boot() {
  const line = '─'.repeat(56);
  console.log(`\n${line}`);
  console.log('  YT Script · YouTube 视频文稿提取工具');
  console.log(line);

  // 中继模式不做端口顺延：隧道指向的是固定端口，悄悄换端口只会让中继连不上、
  // 而且报错点离现场很远。宁可当场停下来说清楚。
  const maxTries = RELAY_MODE ? 1 : MAX_PORT_TRIES;

  for (let i = 0; i < maxTries; i++) {
    const port = BASE_PORT + i;

    // 本应用已经在跑：直接把页面调出来，不当成错误
    const existing = await probeSelf(port);
    if (existing) {
      console.log(`  已经在运行 ${HOST}:${port}（无需重复启动）`);
      console.log(`  网络通路   ${describeTransport(existing)}`);
      if (RELAY_MODE) {
        console.log(`  中继令牌   ${RELAY_TOKEN}`);
        console.log('  （已开启中继模式；若刚改过令牌，请先关掉旧窗口再重启）');
      }
      console.log('');
      console.log('  已为你打开浏览器，可直接关掉这个窗口。');
      console.log(`${line}\n`);
      openBrowser(`http://${HOST}:${port}`);
      // 退出码 3 = 已在运行，交给 start.bat 区分提示
      process.exit(3);
    }

    const err = await listenOnce(port);
    if (!err) return onReady(port);

    if (err.code !== 'EADDRINUSE') {
      console.error(`\n服务启动失败: ${err.message}\n`);
      process.exit(1);
    }

    if (RELAY_MODE) {
      console.error('');
      console.error(`端口 ${port} 已被占用。中继模式下端口必须固定（公网隧道要指向它），不会自动顺延。`);
      console.error(`请换一个端口重试，例如：`);
      console.error(`  node server.js --relay --port ${port + 1}`);
      console.error('');
      process.exit(1);
    }

    console.log(`  端口 ${port} 被占用，自动改用 ${port + 1} ...`);
  }

  console.error(`\n连续 ${MAX_PORT_TRIES} 个端口都被占用，请手动指定：node server.js --port 8899\n`);
  process.exit(1);
}

boot();
