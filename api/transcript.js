'use strict';
/**
 * GET /api/transcript?url=<视频链接或 ID>&lang=&tlang=&force=1
 *
 * 文稿提取主接口 —— Vercel 无服务器函数入口。
 * 与本地 server.js 共用 lib/ 下的同一套取数核心。
 */

const config = require('../lib/config');
const { fetchTranscript } = require('../lib/youtube');
const { json, errorPayload, cacheHeaders, getParam } = require('../lib/api-respond');
const { clientIp, checkAccess, checkRateLimit, withTimeout } = require('../lib/guard');

// 复用实例内的网络通路判定结果，避免每次调用重复探测
const { ensureTransport } = require('../lib/http-client');

module.exports = async function handler(req, res) {
  const cfg = config.load();

  if (req.method === 'OPTIONS') return json(res, 204, undefined);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { ok: false, error: '仅支持 GET 请求', code: 'METHOD_NOT_ALLOWED' });
  }

  if (!checkAccess(req, cfg)) {
    return json(res, 401, { ok: false, error: '访问码不正确', code: 'UNAUTHORIZED' });
  }

  const target = getParam(req, 'url') || getParam(req, 'v');
  if (!target) {
    return json(res, 400, {
      ok: false,
      error: '缺少参数 url',
      code: 'BAD_URL',
      hint: '请传入完整的 YouTube 视频链接或视频 ID。',
    });
  }

  // 限流（默认按 IP，时间窗内超过阈值直接拒绝）
  const rl = await checkRateLimit(clientIp(req), cfg);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter || 60));
    return json(res, 429, {
      ok: false,
      error: `请求过于频繁，请在 ${rl.retryAfter || 60} 秒后重试。`,
      code: 'RATE_LIMITED',
      hint: '服务对单个 IP 做了限流，稍等片刻即可。',
    });
  }

  const lang = getParam(req, 'lang');
  const tlang = getParam(req, 'tlang');
  const force = getParam(req, 'force') === '1';

  const started = Date.now();
  try {
    // 确保网络通路已判定（单候选时为零开销）
    await ensureTransport();

    // 翻译要现场生成，比首次提取慢得多，因此给两条不同的预算
    const totalMs = tlang ? cfg.translateTimeoutMs : cfg.requestTimeoutMs;
    const deadline = started + totalMs;

    const data = await withTimeout(
      fetchTranscript(target, { lang, tlang, force, deadline }),
      totalMs,
      '服务端访问 YouTube 超时（可能是出口网络受限）。'
    );

    if (rl.remaining !== undefined) {
      res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    }

    // 翻译失败但原文已拿到时，不要写进 CDN 缓存，
    // 否则用户半天内都点不到一次「重试翻译」
    const degraded = Boolean(tlang && !data.translatedTo);
    return json(
      res,
      200,
      { ok: true, elapsedMs: Date.now() - started, ...data },
      degraded ? { 'Cache-Control': 'no-store' } : cacheHeaders(force, cfg)
    );
  } catch (e) {
    const { status, body } = errorPayload(e, cfg);
    return json(res, status, body);
  }
};
