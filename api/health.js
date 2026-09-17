'use strict';
/**
 * GET /api/health[?probe=1]
 *
 * 健康检查。默认**不做任何外部请求，也不触发通路探测** —— 页面每次加载
 * 都会调用它，探测一轮代理要好几秒，纯属浪费函数执行时间。
 * 需要真正验证 YouTube 连通性时用 ?probe=1。
 */

const config = require('../lib/config');
const { json, getParam } = require('../lib/api-respond');
const {
  listCandidates,
  currentTransport,
  getProxyInfo,
  request,
} = require('../lib/http-client');

module.exports = async function handler(req, res) {
  const cfg = config.load();
  const cands = listCandidates();
  const info = getProxyInfo();
  const transport = currentTransport();

  const payload = {
    ok: true,
    // 固定标识：server.js 借此判断「这个端口上是本应用而不是别的程序」
    service: 'ytscript',
    mode: cfg.publicMode ? 'public' : 'local',

    // 尚未判定时为 null：说明本次实例还没发过真实请求，不代表不可用
    transport,
    transportReady: Boolean(transport),
    candidateCount: cands.length,
    // 公开模式下只说明「有没有配出口代理」，不暴露具体地址
    proxyConfigured: cands.some((c) => c.kind === 'proxy'),
    allowProxyConfig: cfg.allowProxyConfig && !cfg.publicMode,

    rateLimit: { max: cfg.rateLimitMax, windowMs: cfg.rateLimitWindowMs },
    cacheTtlSec: Math.floor(cfg.cacheTtlMs / 1000),

    // 本机中继：只说明「配没配」，绝不回显地址或令牌
    relayConfigured: Boolean(String(cfg.relayUrl || '').trim() && String(cfg.relayToken || '').trim()),
    // 本机这一端是否以中继模式运行（会被公网隧道暴露）
    relayMode: config.isRelayMode(),
    relayTokenSet: Boolean(String(cfg.relayToken || '').trim()),

    time: new Date().toISOString(),
  };

  // 本地运行时带上完整通路信息，供页面上的「网络设置」展示与预填
  if (!cfg.publicMode) {
    payload.activeProxy = info.activeProxy;
    payload.transportError = info.transportError || '';
    payload.candidates = cands;
    // 自己电脑上跑，回显中继地址方便核对拼写
    payload.relayUrl = cfg.relayUrl;
  }

  if (getParam(req, 'probe') === '1') {
    const started = Date.now();
    try {
      const r = await request('https://www.youtube.com/robots.txt', {
        retries: 0,
        timeout: 8000,
      });
      payload.probe = { ok: r.status === 200, status: r.status, ms: Date.now() - started };
    } catch (e) {
      payload.probe = { ok: false, error: e.message, ms: Date.now() - started };
    }
  }

  // 健康检查本身零成本，但也没必要让每个访客都打到函数上
  return json(res, 200, payload, {
    'Cache-Control': cfg.publicMode ? 'public, max-age=0, s-maxage=10' : 'no-store',
  });
};
