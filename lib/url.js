'use strict';
/** 从各种形态的 YouTube 链接中解析出 11 位视频 ID */

const PATTERNS = [
  /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/i,
  /youtu\.be\/([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com|youtube-nocookie\.com)\/(?:embed|v|e)\/([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com|youtube-nocookie\.com)\/shorts\/([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com|youtube-nocookie\.com)\/live\/([A-Za-z0-9_-]{11})/i,
  /[?&]v=([A-Za-z0-9_-]{11})/,
];

function extractVideoId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const compact = s.replace(/\s/g, '');
  for (const re of PATTERNS) {
    const m = compact.match(re);
    if (m) return m[1];
  }
  return null;
}

module.exports = { extractVideoId };
