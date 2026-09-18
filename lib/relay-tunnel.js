'use strict';
/**
 * 隧道启动器（本地专用，云端不会加载）
 *
 * 由 relay.bat 调用：起一条公网隧道，把本机 127.0.0.1:<port> 暴露成 https 地址，
 * 供云端函数转发取数请求过来。
 *
 * 支持两种隧道，自动择优：
 *   1. ngrok    —— 免费账号自带**永久固定**的 dev 域名（形如 abc123.ngrok-free.dev），
 *                  配一次 RELAY_URL 就再也不用改了（推荐）
 *   2. cloudflared —— 免注册、下载即用，但 trycloudflare 域名**每次重启都会变**，
 *                  变了就得回部署平台改 RELAY_URL 并重新部署
 *
 * 为什么把这段逻辑放在 Node 而不是批处理里：
 *   - 需要实时解析子进程输出拿到公网地址，批处理的 for /f 管道既脆弱又会吞掉实时输出；
 *   - 拿到地址后还要写剪贴板、做自检，这些在 Node 里都是几行的事。
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const LINE = '='.repeat(64);

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const PORT = Number(argValue('--port') || 8801);
const LOCAL = `http://127.0.0.1:${PORT}`;

const log = (...a) => process.stdout.write(a.join(' ') + '\n');

/* ------------------------------ 工具探测 ------------------------------ */

function firstExisting(cands) {
  for (const c of cands) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function findNgrok() {
  const local = firstExisting([
    path.join(ROOT, 'ngrok.exe'),
    path.join(ROOT, 'tools', 'ngrok.exe'),
  ]);
  if (local) return local;
  // 系统 PATH 里也可能装了 ngrok。注意 'where' 本身不一定在 PATH 上
  // （受限环境下 System32 可能缺席），所以用绝对路径并且整段容错。
  try {
    const whereExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe');
    if (fs.existsSync(whereExe)) {
      const r = spawnSync(whereExe, ['ngrok'], { encoding: 'utf8', timeout: 10000 });
      if (r.status === 0 && r.stdout && r.stdout.trim()) return 'ngrok';
    }
  } catch {
    /* ignore */
  }
  return '';
}

function findCloudflared() {
  return firstExisting([
    path.join(ROOT, 'cloudflared.exe'),
    path.join(ROOT, 'cloudflared-windows-amd64.exe'),
    path.join(ROOT, 'tools', 'cloudflared.exe'),
    path.join(ROOT, 'tools', 'cloudflared-windows-amd64.exe'),
  ]);
}

/** ngrok 已配置 authtoken 吗？没配的话它起不来，不如直接用另一个 */
function ngrokReady(exe) {
  try {
    const r = spawnSync(exe, ['config', 'check'], { encoding: 'utf8', timeout: 15000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/* ------------------------------ 剪贴板 ------------------------------ */

function copyToClipboard(text) {
  const clip = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'clip.exe');
  try {
    if (!fs.existsSync(clip)) return false;
    const p = spawn(clip, [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    p.stdin.end(text);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ 端口检查 ------------------------------ */

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(false)));
  });
}

/* ------------------------------ 隧道地址识别 ------------------------------ */

// cloudflared: https://xxx.trycloudflare.com
// ngrok:       url=https://xxx.ngrok-free.dev  /  .ngrok.app  /  .ngrok.io
const URL_PATTERNS = [
  /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com\b/i,
  /url=(https:\/\/[^\s"']+)/i,
  /https:\/\/[a-z0-9][a-z0-9-]*\.ngrok-free\.(?:dev|app)\b/i,
  /https:\/\/[a-z0-9][a-z0-9-]*\.ngrok\.(?:io|app)\b/i,
];

function extractUrl(buf) {
  for (const re of URL_PATTERNS) {
    const m = buf.match(re);
    if (m) return (m[1] || m[0]).replace(/[",]+$/, '');
  }
  return '';
}

/* ------------------------------ 自检 ------------------------------ */

/** 从公网侧打一次 health，确认隧道真的把请求送到本机了 */
async function selfCheck(url) {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(url + '/api/health?_cb=' + Date.now(), {
        headers: {
          // ngrok 免费版的浏览器警告页对 API 请求无效，带上这个头可确保万无一失
          'ngrok-skip-browser-warning': '1',
          'User-Agent': 'ytscript-relay/1.0',
        },
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json();
      if (j && j.service === 'ytscript') return j;
    } catch {
      /* 边缘路由还没挂上，继续等 */
    }
    await new Promise((s) => setTimeout(s, 2000));
  }
  return null;
}

/* ------------------------------ 主流程 ------------------------------ */

(async () => {
  log('');
  log(LINE);
  log('  正在建立公网隧道 ...');
  log(LINE);

  // 端口上必须有服务：隧道只是把请求转发进来，后面没人应答就毫无意义。
  // 注意判定方向 —— portBusy() 返回 true 表示「有人在监听」，正是我们要的状态。
  if (!(await portBusy(PORT))) {
    log('');
    log(`  [错误] 端口 ${PORT} 上没有服务。`);
    log('  隧道必须指向一个正在运行的本机服务。');
    log('  正常情况下 relay.bat 会先起服务再调本脚本；');
    log('  如果你是手工调用的，请先执行：');
    log(`      node server.js --relay --port ${PORT} --no-open`);
    log('');
    process.exit(1);
  }

  const ngrokExe = findNgrok();
  const cfExe = findCloudflared();

  let kind = '';
  let exe = '';
  let args = [];

  if (ngrokExe && ngrokReady(ngrokExe)) {
    kind = 'ngrok';
    exe = ngrokExe;
    // --log stdout 让地址出现在标准输出里；logfmt 便于解析
    args = ['http', String(PORT), '--log', 'stdout', '--log-format', 'logfmt'];
  } else if (cfExe) {
    kind = 'cloudflared';
    exe = cfExe;
    args = ['tunnel', '--url', LOCAL, '--no-autoupdate'];
  } else if (ngrokExe) {
    log('');
    log('  [错误] 检测到 ngrok.exe，但它还没有配置 authtoken，无法建立隧道。');
    log('');
    log('  任选一种方式解决：');
    log('    A) 配置 ngrok（配好后地址永久固定，一劳永逸）');
    log('       1. 注册 https://dashboard.ngrok.com/signup');
    log('       2. 复制页面上的 authtoken，在本目录执行：');
    log('          ngrok.exe config add-authtoken <你的authtoken>');
    log('    B) 用 cloudflared（免注册，但地址每次重启会变）');
    log('       下载并放进本目录（任一文件名都可以）：');
    log('       https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe');
    log('');
    process.exit(1);
  } else {
    log('');
    log('  [错误] 没找到任何隧道程序（ngrok.exe 或 cloudflared.exe）。');
    log('');
    log('  推荐 A：ngrok —— 免费账号自带永久固定域名，配置一次即可，之后不用再改部署平台');
    log('      1. 注册 https://dashboard.ngrok.com/signup');
    log('      2. 下载 ngrok.exe 放进本目录：https://ngrok.com/download');
    log('      3. 配置令牌：ngrok.exe config add-authtoken <你的authtoken>');
    log('');
    log('  快速 B：cloudflared —— 免注册，直接下载放进本目录即可用');
    log('      https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe');
    log('');
    log('  （放着不动也行：站点会自动退回云端直连，只是部分视频会被 YouTube 风控拦下）');
    log('');
    process.exit(1);
  }

  const stable = kind === 'ngrok';
  log('');
  log(`  隧道程序：${kind}${stable ? '  —— 地址永久固定，配一次以后不用再改' : '  —— 免注册，但地址每次重启都会变'}`);
  log('');

  const child = spawn(exe, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let buf = '';
  let url = '';
  let announced = false;

  const onData = (d) => {
    process.stdout.write(d); // 原样透传，方便排障
    if (url) return;
    buf = (buf + d.toString('utf8')).slice(-8000);
    const found = extractUrl(buf);
    if (found && !announced) {
      announced = true;
      url = found;
      announce(found, stable);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (e) => {
    log('');
    log('  [错误] 隧道程序启动失败：' + e.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    log('');
    if (url) {
      log('  隧道已关闭。站点会自动退回云端直连（还能用，只是部分视频会被风控拦下）。');
      log('  想恢复：重新双击 relay.bat。');
      if (!stable) {
        log('');
        log('  注意：cloudflared 的地址每次重启都会变。');
        log('  如果你不想每次都回部署平台改 RELAY_URL，建议改用 ngrok（免费固定域名）。');
      }
    } else {
      log(`  隧道程序退出（代码 ${code}），没有拿到公网地址。`);
      log('  上面的输出里通常有原因。');
    }
    log('');
    process.exit(code === null ? 0 : code);
  });

  // Ctrl+C 时把子进程一起收掉，别留孤儿
  const bye = () => { try { child.kill(); } catch {} };
  process.on('SIGINT', () => { bye(); setTimeout(() => process.exit(0), 500); });
  process.on('SIGTERM', bye);
})();

/* ------------------------------ 地址播报 ------------------------------ */

function announce(url, stable) {
  let token = '';
  try {
    token = String(require('./config').relayToken() || '');
  } catch {
    /* ignore */
  }
  const copied = copyToClipboard(url);

  log('');
  log(LINE);
  log('  隧道已就绪 —— 把下面两个值填到部署平台');
  log(LINE);
  log('');
  log('  1) RELAY_URL');
  log('     ' + url);
  if (copied) log('     （已复制到剪贴板，直接 Ctrl+V 即可）');
  log('');
  log('  2) RELAY_TOKEN');
  log('     ' + token);
  log('');
  log('  位置：Vercel → 你的项目 → Settings → Environment Variables');
  log('');
  log('  填完必须手动 Redeploy 一次 —— 环境变量改动不会自动生效，');
  log('  这是最容易漏掉的一步。');
  log('');
  if (stable) {
    log('  这个地址是永久的，配置一次以后都不用再改。');
  } else {
    log('  ⚠ 这个地址是临时的，每次重启 relay.bat 都会变。');
    log('    想一劳永逸，改用 ngrok（免费账号自带永久固定域名）。');
  }
  log('');
  log(LINE);
  log('  自检中（从公网侧回打本机）...');
  log(LINE);

  selfCheck(url).then((j) => {
    log('');
    if (j) {
      log('  ✓ 自检通过 —— 隧道确实把请求送到了本机。');
      log(`    relayMode=${j.relayMode}  relayTokenSet=${j.relayTokenSet}`);
      log('');
      log('  接下来：填变量 → Redeploy → 在页面上试刚才失败的那个视频。');
    } else {
      log('  ✗ 自检没通过：地址拿到了，但从公网访问不通。');
      log('    常见原因：隧道刚建好、边缘路由还没生效（再等十几秒重试），');
      log('    或本机网络到隧道服务商不稳定。');
      log('    手动验证：浏览器打开 ' + url + '/api/health');
    }
    log('');
    log('  保持这个窗口开着，站点才会走你家出口。按 Ctrl+C 停止。');
    log(LINE);
    log('');
  });
}
