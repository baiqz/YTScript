'use strict';
/**
 * GET /api/transcript?url=<视频链接或 ID>&lang=&tlang=&force=1
 *
 * 文稿提取主接口 —— Vercel 无服务器函数入口。
 * 与本地 server.js 共用 lib/ 下的同一套取数核心。
 */

const config = require('../lib/config');
const { fetchTranscript } = require('../lib/youtube');
const {
  json,
  errorPayload,
  cacheHeaders,
  getParam,
  statusForCode,
  publicSafeRelayBody,
} = require('../lib/api-respond');
const { clientIp, checkAccess, checkRateLimit, withTimeout } = require('../lib/guard');
const { relayUsable, relayTranscript, describeRelayFailure, briefRelayFailure, shouldFallbackToDirect } = require('../lib/relay');

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
  let relayNote = '';

  /*
   * 中继没走通时要说清原因，但两套措辞：
   *   - 本机主人看的版本会点名 config.json / RELAY_TOKEN 该去哪核对，排障直接照着做；
   *   - 公开部署下换成短版，只说清是「鉴权 / 隧道 / 地址」哪一类，不暴露内部实现。
   */
  const relayProblem = (status, payload, err) => {
    const detail = err ? err.message : describeRelayFailure(status, payload);
    return cfg.publicMode
      ? `本机中继当前不可用（${err ? '连不上' : briefRelayFailure(status, payload)}），已改走云端直连。`
      : `本机中继不可用（${detail}），已改走云端直连。`;
  };

  // 翻译要现场生成，比首次提取慢得多，因此给两条不同的预算。
  // 中继与直连共用这一份预算 —— 否则「中继超时 45s + 再降级直连 25s」会超出
  // 无服务器平台的函数时长上限，被平台直接掐断，连错误信息都拿不到。
  const totalMs = tlang ? cfg.translateTimeoutMs : cfg.requestTimeoutMs;

  try {
    /*
     * 第一优先：本机中继。
     *
     * 本机出口是住宅网络，取数成功率实测 100%；而云端共享出口对高风控视频
     * 会被 YouTube 拦下（详见 DEPLOY.md 4.5）。所以只要配了中继就先走中继。
     */
    if (relayUsable(cfg)) {
      let out = null;
      try {
        out = await relayTranscript(cfg, { req, clientIp: clientIp(req), budgetMs: totalMs });
      } catch (e) {
        relayNote = relayProblem(0, null, e);
      }

      if (out && !out.relaySideFailure) {
        const body = { ...out.payload, viaRelay: true, elapsedMs: Date.now() - started };
        if (out.payload.ok === true) {
          const degraded = Boolean(tlang && !out.payload.translatedTo);
          return json(res, 200, body, degraded ? { 'Cache-Control': 'no-store' } : cacheHeaders(force, cfg));
        }
        /*
         * 中继返回的**内容级**判定（如 POT_REQUIRED / NO_CAPTIONS）原样透传：
         * 同一出口对同一视频的拦截是稳定复现的，再去直连撞一次纯属浪费预算。
         *
         * 但**网络级**失败（TIMEOUT / FETCH_FAILED）只说明中继那边不通
         * （代理被关、断网），这时直连真的可能成功 —— 两个出口本来就是不同的 IP，
         * 所以继续往下走。判据见 lib/relay.js 的 RELAY_FALLBACK_CODES。
         */
        if (!shouldFallbackToDirect(out.payload.code)) {
          // 状态码要从 code 还原：中继那端不能把 502/504 发出来，否则会被
          // Cloudflare 换成它自己的错误页（详见 api-respond 的 relaySafeStatus）
          return json(res, statusForCode(out.payload.code, out.status || 502), publicSafeRelayBody(body, cfg));
        }
        relayNote = cfg.publicMode
          ? '本机中继当前不可用（网络不通），已改走云端直连。'
          : `本机中继网络不通（${out.payload.error || out.payload.code}），已改走云端直连。`;
      }
      if (out && !relayNote) relayNote = relayProblem(out.status, out.payload);
    }

    // 确保网络通路已判定（单候选时为零开销）
    await ensureTransport();

    // 降级直连时只剩「总预算减去已花掉的时间」，不足 6 秒就按 6 秒收尾，
    // 宁可快速失败也不要被平台掐断
    const leftMs = Math.max(6_000, totalMs - (Date.now() - started));
    const deadline = started + totalMs;

    const data = await withTimeout(
      fetchTranscript(target, { lang, tlang, force, deadline }),
      leftMs,
      '服务端访问 YouTube 超时（可能是出口网络受限）。'
    );

    if (rl.remaining !== undefined) {
      res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    }

    // 中继没走通时，把原因一并告诉用户，避免"明明配了中继却没生效"这种哑火
    if (relayNote && !data.warning) data.warning = relayNote;

    // 翻译失败但原文已拿到时，不要写进 CDN 缓存，
    // 否则用户半天内都点不到一次「重试翻译」
    const degraded = Boolean(tlang && !data.translatedTo);
    return json(
      res,
      200,
      { ok: true, elapsedMs: Date.now() - started, viaRelay: false, ...data },
      degraded ? { 'Cache-Control': 'no-store' } : cacheHeaders(force, cfg)
    );
  } catch (e) {
    const { status, body } = errorPayload(e, cfg);
    /*
     * 直连也失败时，中继那条线索更要留着 —— 这是用户手上唯一的非「YouTube 又抽风了」
     * 的解释。只在确实配了中继（relayNote 非空）时追加，避免给没配中继的人添噪音。
     */
    if (relayNote) body.hint = `${relayNote} ${body.hint || ''}`.trim();
    return json(res, status, body);
  }
};
