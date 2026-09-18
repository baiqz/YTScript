'use strict';
/**
 * 本机中继
 *
 * 背景：把服务部署到大厂的共享无服务器出口后，YouTube 会对该出口 IP 的
 * 「高风控视频」要求人机校验（POT / PO token），实测中文知识类视频 0/8 全被拦。
 * 换客户端、带 visitorData、重试都已实测无效，唯一变量是出口 IP。
 *
 * 解法：云端函数不再自己去访问 YouTube，而是把整条提取请求转发到
 * **你自己电脑上运行的 server.js**，由它用本机可用的出口去取数。
 * 本机侧需要把端口通过隧道（Cloudflare Tunnel / ngrok / frp 等）暴露成公网地址，
 * 再把这个地址配到部署平台的 RELAY_URL。
 *
 * 安全边界（很重要）：
 *   - 中继地址会被暴露到公网，所以必须配 RELAY_TOKEN；
 *   - 本机侧以 --relay 启动时会：禁用远程改代理接口、并对所有 /api/* 校验令牌；
 *   - 这里要求「地址 + 令牌」齐备才启用，缺令牌一律不启用，避免裸奔。
 */

const { requestJSON } = require('./http-client');

/** 中继是否可用：地址与令牌必须同时具备 */
function relayUsable(cfg) {
  return Boolean(String(cfg.relayUrl || '').trim() && String(cfg.relayToken || '').trim());
}

/** 取请求的查询串（保留 ? 与全部参数），原样透传给中继 */
function queryOf(req) {
  const u = (req && req.url) || '';
  const i = u.indexOf('?');
  return i === -1 ? '' : u.slice(i);
}

/**
 * 判断这个错误是否属于「中继这一侧自己坏了」。
 *
 * 这类必须降级为直连：中继配错了、电脑关机了、隧道断了，都不该让整个站点跟着瘫痪。
 * 而中继正常返回的业务错误（如 NO_CAPTIONS）必须原样透传，
 * 否则既多花一次往返，又会掩盖真实原因。
 *
 * 判据分三层，顺序不能换：
 *
 *   1. 中继自身配置问题（令牌不符 / 被本机侧禁用）→ 中继坏了，降级直连。
 *   2. **报文不是本服务的** → 隧道或网关自己产生的错误页。
 *      实测 Cloudflare 会把源站的 502/504 换成自己的 JSON 错误页，
 *      cloudflared 未连通时返回 530/1033。这类内容必须拦掉：
 *      它既不是业务结果（透传会把用户引向错误的排查方向），
 *      也不代表 YouTube 那边有任何问题。判据是报文里有没有本服务一定会带的 ok 字段。
 *   3. 是本服务的报文 → 一律当业务结果透传（含 ok:false 的业务错误）。
 */
function isRelaySideFailure(status, payload) {
  const p = payload || {};
  if (p.code === 'RELAY_UNAUTHORIZED' || p.code === 'RELAY_DISABLED') return true;
  if (status === 401 || status === 403) return true;
  if (typeof p.ok !== 'boolean') return true;
  return false;
}

/**
 * 把「中继为什么没走通」翻译成一句能直接照着查的中文。
 *
 * 这段文字会作为 warning 附在降级直连的响应里。没有它，用户只会看到
 * 「配了中继却没生效」这种哑火现象，然后去猜是 YouTube 的问题还是中继的问题。
 */
function describeRelayFailure(status, payload) {
  const p = payload || {};
  const cfName = String(p.error_name || '');
  const cfCode = String(p.error_code || '');

  if (p.code === 'RELAY_UNAUTHORIZED') {
    return '中继令牌不匹配 —— 核对部署平台的 RELAY_TOKEN 与本机 config.json 里的是否一致';
  }
  if (p.code === 'RELAY_DISABLED') return '中继已被本机侧禁用';
  // Cloudflare 隧道：1033 = 隧道没注册上；530 是它的外层状态码
  if (status === 530 || cfCode === '1033' || cfName.includes('tunnel')) {
    return '隧道没连上 Cloudflare（本机的隧道进程可能已退出，或刚启动还没就绪）';
  }
  if (status === 502 || status === 504) {
    return '请求到了 Cloudflare 但回源失败（本机服务可能已停止，或 RELAY_URL 是上一次隧道的旧地址）';
  }
  if (status === 404) {
    return '中继地址返回 404 —— 多半是隧道重启后地址变了，需要更新 RELAY_URL';
  }
  if (status >= 500) return `隧道侧错误 HTTP ${status}`;
  return `响应异常（HTTP ${status}）`;
}

/**
 * 把一次提取请求转发到本机中继。
 * @param {{req:object, clientIp?:string, budgetMs?:number}} opts
 *        budgetMs —— 本次请求的总时间预算，中继超时不会超过它
 * @returns {Promise<{status:number, payload:object, relaySideFailure:boolean}>}
 */
async function relayTranscript(cfg, opts = {}) {
  const base = String(cfg.relayUrl || '').trim().replace(/\/+$/, '');
  const url = `${base}/api/transcript${queryOf(opts.req)}`;

  const headers = {
    'X-Relay-Token': cfg.relayToken,
    Accept: 'application/json',
    'User-Agent': 'ytscript-relay/1.0',
    // ngrok 免费版会在 HTML 浏览器流量前插一个警告页；这个头用于跳过它。
    // 对 cloudflared 无害，纯粹是为了让隧道换成 ngrok 时不用改代码。
    'ngrok-skip-browser-warning': '1',
  };
  // 带上真实访客 IP，中继端可据此做限流与日志
  if (opts.clientIp) headers['X-Forwarded-For'] = opts.clientIp;

  // 中继可能只是因为电脑关机/隧道断开而连不上，这类失败通常立刻返回；
  // 但真挂住时不能让它吃满整个函数时长，否则降级直连就没时间了
  const timeout = Math.max(5_000, Math.min(cfg.relayTimeoutMs, opts.budgetMs || cfg.relayTimeoutMs));

  const r = await requestJSON(url, {
    method: 'GET',
    headers,
    retries: 0,
    timeout,
  });

  return {
    status: r.status,
    payload: r.json,
    relaySideFailure: isRelaySideFailure(r.status, r.json),
  };
}

module.exports = { relayUsable, relayTranscript, queryOf, isRelaySideFailure, describeRelayFailure };
