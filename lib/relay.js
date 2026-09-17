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
 * 这类必须降级为直连：中继配错了、电脑关机了，不该让整个站点跟着瘫痪。
 * 而中继正常返回的业务错误（如 NO_CAPTIONS）必须原样透传，
 * 否则既多花一次往返，又会掩盖真实原因。
 */
function isRelaySideFailure(status, payload) {
  const code = payload && payload.code;
  if (code === 'RELAY_UNAUTHORIZED' || code === 'RELAY_DISABLED') return true;
  if (status === 401 || status === 403) return true;
  return false;
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

module.exports = { relayUsable, relayTranscript, queryOf, isRelaySideFailure };
