'use strict';
/**
 * 无服务器函数的统一响应封装（零依赖，只用 Node 内置的 res 对象）
 */

const STATUS_BY_CODE = {
  BAD_URL: 400,
  NO_CAPTIONS: 404,
  TRACK_EMPTY: 502,
  POT_REQUIRED: 502,
  PLAYER_FAILED: 502,
  TIMEOUT: 504,
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
};

function json(res, status, obj, headers = {}) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.statusCode = status;
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}

/** 提取失败时的响应：公开模式下不暴露内部细节 */
function errorPayload(e, cfg) {
  const code = e.code || 'FETCH_FAILED';
  let status = STATUS_BY_CODE[code] || 502;
  if (code === 'TRACK_EMPTY' && /限流|429/.test(e.message || '')) status = 429;

  let hint;
  if (code === 'TIMEOUT') {
    hint = cfg.publicMode
      ? '服务端访问 YouTube 超时，请稍后重试。'
      : '服务端访问 YouTube 超时。请检查代理是否可用，或换一个代理地址。';
  } else if (status === 429) {
    hint = 'YouTube 侧暂时限流，等待十几秒后重试即可。';
  } else if (code === 'NO_CAPTIONS') {
    hint = '这个视频没有字幕，换一个有字幕的视频试试。';
  } else if (code === 'BAD_URL') {
    hint = '请粘贴完整的 YouTube 视频链接，或直接填 11 位视频 ID。';
  } else if (cfg.publicMode) {
    hint = '服务端暂时无法访问 YouTube，请稍后重试。';
  } else {
    hint =
      '如果持续失败，请确认本机可访问 youtube.com（国内通常需要代理），' +
      '或在「网络设置」中填入可用代理。';
  }

  return {
    status,
    body: {
      ok: false,
      error: e.message || '提取失败',
      code,
      // 公开模式下不回传内部细节，避免泄露实现
      detail: cfg.publicMode ? '' : e.detail || '',
      hint,
    },
  };
}

/** 成功响应的 CDN 缓存策略：字幕内容基本不变，交给边缘节点挡住重复请求 */
function cacheHeaders(force, cfg) {
  if (force) return { 'Cache-Control': 'no-store' };
  const seconds = Math.max(60, Math.floor(cfg.cacheTtlMs / 1000));
  return {
    'Cache-Control': `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=86400`,
  };
}

/**
 * 读取查询参数。
 * Vercel 会预处理出 req.query；本地 harness 与自建服务下则从 URL 自行解析，
 * 保证两种运行形态行为一致。
 */
function getParam(req, name, fallback = '') {
  if (req.query && req.query[name] !== undefined) {
    const v = req.query[name];
    return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
  }
  const url = req.url || '';
  const i = url.indexOf('?');
  if (i === -1) return fallback;
  const sp = new URLSearchParams(url.slice(i + 1));
  return sp.get(name) ?? fallback;
}

module.exports = { json, errorPayload, cacheHeaders, getParam, STATUS_BY_CODE };
