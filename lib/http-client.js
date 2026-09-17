'use strict';
/**
 * 极简 HTTP 客户端
 * - 零依赖，仅使用 Node 内置模块
 * - 收集所有候选通路（直连 / 环境变量代理 / Windows 系统代理），并行探测后自动择优
 * - 支持 HTTP CONNECT 隧道、gzip·deflate·br 解压、chunked 解码、重定向跟随
 */

const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const config = require('./config');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * TLS 证书校验开关。
 * 默认开启校验；只有使用「中间人型」代理（会替换证书）时才需要
 * 通过环境变量 INSECURE_TLS=1 关掉。
 */
const TLS_INSECURE = config.load().insecureTls;

/* ------------------------------------------------------------------ */
/* 候选通路收集                                                        */
/* ------------------------------------------------------------------ */

function normalizeProxy(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  if (/^socks/i.test(s)) return ''; // socks 暂不支持
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    if (!u.port) u.port = '80';
    return u.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function proxyFromEnv() {
  const list = [];
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const v = normalizeProxy(process.env[k]);
    if (v) list.push(v);
  }
  return list;
}

/**
 * 常见本地代理客户端默认端口（Clash / Clash Verge / V2Ray / Surge 等）
 * 这是「系统代理」之外最可靠的自动发现手段：
 * 部分受限环境会禁用 reg.exe，无法读取注册表中的系统代理设置。
 *
 * 仅在本地运行时启用 —— 云端服务器上根本不存在这些本地端口，
 * 逐个探测毫无意义，还会让每次冷启动白白多等数秒。
 */
const COMMON_PORTS = [7890, 7891, 7897, 7898, 10808, 10809, 1080, 1081, 8118, 8889, 20171];

function proxyFromCommonPorts() {
  if (config.isServerless()) return [];
  return COMMON_PORTS.map((p) => `http://127.0.0.1:${p}`);
}

let candidates = [];   // [{ kind:'proxy'|'direct', url, source }]
let activeProxy = '';  // 当前生效的代理
let transport = null;  // null | 'direct' | 'proxy'
let transportError = '';

function buildCandidates(forced) {
  const list = [];
  if (forced) {
    const v = normalizeProxy(forced);
    if (v) list.push({ kind: 'proxy', url: v, source: '手动指定' });
    return list;
  }

  // 1) 显式配置的代理（配置文件或环境变量 PROXY_URL）优先级最高
  const cfg = config.load();
  const savedV = normalizeProxy(cfg.proxy);
  if (savedV) list.push({ kind: 'proxy', url: savedV, source: cfg.proxySource || '配置指定' });

  // 2) 其余代理环境变量
  for (const url of proxyFromEnv()) {
    if (!list.some((c) => c.url === url)) list.push({ kind: 'proxy', url, source: '环境变量' });
  }

  // 3) 常见本地代理端口（仅本地运行）
  for (const url of proxyFromCommonPorts()) {
    if (!list.some((c) => c.url === url)) list.push({ kind: 'proxy', url, source: '端口探测' });
  }

  // 4) 直连兜底（放在候选末尾，但探测是并行的）
  list.push({ kind: 'direct', url: '', source: '直连' });
  return list;
}

/** 手动指定代理（传空字符串则恢复自动探测） */
function setProxy(url) {
  candidates = buildCandidates(url || '');
  transport = null;
  activeProxy = '';
}

function getProxyInfo() {
  return {
    activeProxy,
    transport,
    transportError,
    candidates: candidates.map((c) => ({ kind: c.kind, url: c.url, source: c.source })),
  };
}

/* ------------------------------------------------------------------ */
/* 底层：代理隧道 + 原始 HTTP/1.1                                      */
/* ------------------------------------------------------------------ */

function connectTunnel(proxyUrl, targetHost, targetPort, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const p = new URL(proxyUrl);
    const headers = { Host: `${targetHost}:${targetPort}`, 'Proxy-Connection': 'Keep-Alive' };
    if (p.username) {
      const cred = Buffer.from(
        `${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`
      ).toString('base64');
      headers['Proxy-Authorization'] = `Basic ${cred}`;
    }
    const req = http.request({
      host: p.hostname,
      port: Number(p.port) || 80,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers,
    });
    req.setTimeout(timeout, () => req.destroy(new Error('代理连接超时')));
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理 CONNECT 失败 (HTTP ${res.statusCode})`));
        return;
      }
      resolve(socket);
    });
    req.on('error', reject);
    req.end();
  });
}

function wrapTLS(socket, servername) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ socket, servername, rejectUnauthorized: !TLS_INSECURE });
    s.setTimeout(30000, () => s.destroy(new Error('TLS 超时')));
    s.once('secureConnect', () => resolve(s));
    s.once('error', reject);
  });
}

function dechunk(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    const eol = buf.indexOf('\r\n', pos);
    if (eol === -1) break;
    const size = parseInt(buf.subarray(pos, eol).toString('latin1').split(';')[0], 16);
    if (!Number.isFinite(size) || size <= 0) break;
    out.push(buf.subarray(eol + 2, eol + 2 + size));
    pos = eol + 2 + size + 2;
  }
  return Buffer.concat(out);
}

function maybeDecompress(buf, encoding) {
  const enc = String(encoding || '').toLowerCase();
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buf);
    if (enc.includes('gzip')) return zlib.gunzipSync(buf);
    if (enc.includes('deflate')) return zlib.inflateSync(buf);
  } catch {
    /* 解压失败原样返回 */
  }
  return buf;
}

function parseRawResponse(buf) {
  const idx = buf.indexOf('\r\n\r\n');
  if (idx === -1) throw new Error('响应头不完整');
  const head = buf.subarray(0, idx).toString('latin1');
  let body = buf.subarray(idx + 4);
  const lines = head.split('\r\n');
  const m = lines[0].match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
  const status = m ? Number(m[1]) : 0;
  const headers = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  if ((headers['transfer-encoding'] || '').toLowerCase().includes('chunked')) {
    body = dechunk(body);
  }
  body = maybeDecompress(body, headers['content-encoding']);
  return { status, headers, body };
}

function rawRequest(socket, { host, port, method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const h = {
      Host: port === 443 || port === 80 ? host : `${host}:${port}`,
      Connection: 'close',
      'Accept-Encoding': 'gzip, deflate, br',
      ...headers,
    };
    let head = `${method} ${path} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(h)) {
      if (v !== undefined && v !== null) head += `${k}: ${v}\r\n`;
    }
    head += '\r\n';

    const chunks = [];
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };

    socket.setTimeout(45000, () => done(reject, new Error('读取响应超时')));
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => {
      try {
        done(resolve, parseRawResponse(Buffer.concat(chunks)));
      } catch (e) {
        done(reject, e);
      }
    });
    socket.on('error', (e) => done(reject, e));
    socket.write(head, 'latin1');
    if (body) socket.write(body);
  });
}

/* ------------------------------------------------------------------ */
/* 通路探测                                                            */
/* ------------------------------------------------------------------ */

const PROBE_URL = 'https://www.youtube.com/robots.txt';

async function once(url, opts = {}) {
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const port = Number(u.port) || (isHttps ? 443 : 80);
  const path = u.pathname + u.search;
  const method = (opts.method || 'GET').toUpperCase();
  const bodyBuf =
    opts.body === undefined || opts.body === null
      ? null
      : Buffer.isBuffer(opts.body)
        ? opts.body
        : Buffer.from(String(opts.body), 'utf8');

  if (transport === 'proxy' && activeProxy) {
    const sock = await connectTunnel(activeProxy, u.hostname, port, opts.timeout || 12000);
    const socket = isHttps ? await wrapTLS(sock, u.hostname) : sock;
    const headers = { 'User-Agent': DEFAULT_UA, ...(opts.headers || {}) };
    if (bodyBuf) headers['Content-Length'] = bodyBuf.length;
    try {
      return await rawRequest(socket, { host: u.hostname, port, method, path, headers, body: bodyBuf });
    } finally {
      socket.destroy();
    }
  }

  return new Promise((resolve, reject) => {
    const mod = isHttps ? https : http;
    const req = mod.request(
      {
        host: u.hostname,
        port,
        path,
        method,
        headers: {
          'User-Agent': DEFAULT_UA,
          'Accept-Encoding': 'gzip, deflate, br',
          ...(opts.headers || {}),
        },
        rejectUnauthorized: !TLS_INSECURE,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: maybeDecompress(Buffer.concat(chunks), res.headers['content-encoding']),
          })
        );
      }
    );
    req.setTimeout(opts.timeout || 30000, () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function probeCandidate(cand, timeoutMs) {
  const prevT = transport;
  const prevP = activeProxy;
  transport = cand.kind;
  activeProxy = cand.url;
  try {
    const r = await once(PROBE_URL, { timeout: timeoutMs, headers: { 'Accept-Encoding': 'identity' } });
    return r.status >= 200 && r.status < 500;
  } catch {
    return false;
  } finally {
    transport = prevT;
    activeProxy = prevP;
  }
}

/** 并行探测所有候选通路，锁定可用的那条 */
async function probeAndPick(timeoutMs) {
  if (!candidates.length) candidates = buildCandidates('');

  // 只有一条候选时（云端直连、或用户显式指定了唯一代理）无需探测，
  // 直接锁定 —— 省掉冷启动时一次多余的往返。
  if (candidates.length === 1) {
    const only = candidates[0];
    transport = only.kind;
    activeProxy = only.kind === 'proxy' ? only.url : '';
    transportError = '';
    return transport;
  }

  const results = await Promise.all(
    candidates.map(async (c) => ({ c, ok: await probeCandidate(c, timeoutMs) }))
  );
  const winner = results.find((r) => r.ok);

  if (winner) {
    transport = winner.c.kind;
    activeProxy = winner.c.kind === 'proxy' ? winner.c.url : '';
    transportError = '';
    // 记住这次可用的通路，下次启动直接命中
    // （云端文件系统只读，save 会静默跳过，不报错）
    if (winner.c.kind === 'proxy' && winner.c.url !== config.load().proxy) {
      config.save({ proxy: winner.c.url, proxySource: winner.c.source });
    }
  } else {
    const first = candidates[0];
    transport = first.kind;
    activeProxy = first.kind === 'proxy' ? first.url : '';
    transportError = '全部网络通路探测失败，请检查网络或代理设置';
  }
  return transport;
}

/**
 * 探测中的 Promise。启动横幅与用户首次请求可能几乎同时触发探测，
 * 复用同一个 Promise 可以避免重复往返，也防止后完成的探测覆盖先前的结论。
 */
let inflightProbe = null;

async function ensureTransport(force = false, timeoutMs = 7000) {
  if (transport && !force) return transport;
  if (inflightProbe) return inflightProbe;

  inflightProbe = probeAndPick(timeoutMs).finally(() => {
    inflightProbe = null;
  });
  return inflightProbe;
}

/* ------------------------------------------------------------------ */
/* 统一请求入口                                                        */
/* ------------------------------------------------------------------ */

/** 返回 { status, headers, body(Buffer), text, url } */
async function request(url, opts = {}) {
  const retries = opts.retries === undefined ? 1 : opts.retries;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (!transport) await ensureTransport();
    try {
      let res = await once(url, opts);
      let current = url;
      let hops = 0;
      while (
        !opts.noFollow &&
        [301, 302, 303, 307, 308].includes(res.status) &&
        res.headers.location &&
        hops < 5
      ) {
        current = new URL(res.headers.location, current).toString();
        const nextOpts = { ...opts };
        if (res.status === 303) nextOpts.method = 'GET';
        res = await once(current, nextOpts);
        hops++;
      }
      return {
        status: res.status,
        headers: res.headers,
        body: res.body,
        text: res.body.toString('utf8'),
        url: current,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await ensureTransport(true); // 通路可能已失效，重新择优
    }
  }
  throw lastErr;
}

async function requestJSON(url, opts = {}) {
  const r = await request(url, opts);
  try {
    return { ...r, json: JSON.parse(r.text) };
  } catch {
    throw new Error(`响应不是合法 JSON (HTTP ${r.status})`);
  }
}

/* ------------------------------------------------------------------ */
/* 通路状态查询（不触发探测）                                          */
/* ------------------------------------------------------------------ */

/** 构建或复用候选通路列表，不做任何网络探测 */
function listCandidates() {
  if (!candidates.length) candidates = buildCandidates('');
  return candidates;
}

/** 已判定的通路（尚未判定时返回 null），不会触发探测 */
function currentTransport() {
  return transport;
}

module.exports = {
  request,
  requestJSON,
  ensureTransport,
  setProxy,
  getProxyInfo,
  buildCandidates,
  listCandidates,
  currentTransport,
  DEFAULT_UA,
};
