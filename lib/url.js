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

const LOOKS_LIKE_YT = /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i;
const ID_LEN = 11;

/**
 * extractVideoId 返回 null 时，进一步判断「为什么失败」。
 *
 * 最常见的真实场景不是「乱填」，而是**链接复制少了一位**：
 * YouTube 的视频 ID 固定 11 位，少一位时上面所有模式都匹配不上，
 * 于是只能报笼统的「无法识别链接」，用户完全不知道错在哪。
 * 这里把「解析到的片段 + 实际位数」还原出来，让报错可自证。
 *
 * @returns {{message:string, detail:string}|null} 无法判断时返回 null
 */
function diagnoseUrl(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return null;
  const compact = s.replace(/\s/g, '');

  // 1) watch?v=xxx 形态，但值不是 11 位
  const byQuery = /[?&]v=([A-Za-z0-9_-]+)/.exec(compact);
  if (byQuery && byQuery[1].length !== ID_LEN) {
    const got = byQuery[1];
    return {
      message: `链接里的视频 ID 是 ${got.length} 位，YouTube 的视频 ID 固定 ${ID_LEN} 位。`,
      detail: `解析到「${got}」（${got.length} 位）。多半是复制时漏了字符，请重新完整复制链接。`,
    };
  }

  // 2) 短链 / shorts / live / embed 形态，但值不是 11 位
  const byPath = /(?:youtu\.be\/|shorts\/|live\/|embed\/|youtube\.com\/v\/)([A-Za-z0-9_-]+)/i.exec(compact);
  if (byPath && byPath[1].length !== ID_LEN) {
    const got = byPath[1];
    return {
      message: `链接里的视频 ID 是 ${got.length} 位，应为 ${ID_LEN} 位。`,
      detail: `解析到「${got}」（${got.length} 位）。请重新完整复制链接，或直接填 ${ID_LEN} 位视频 ID。`,
    };
  }

  // 3) 整串只是字母数字，看着像（残缺的）视频 ID
  if (/^[A-Za-z0-9_-]+$/.test(compact) && compact.length !== ID_LEN) {
    return {
      message: `视频 ID 应为 ${ID_LEN} 位，当前是 ${compact.length} 位。`,
      detail: `收到「${compact}」。请检查是否漏了字符。`,
    };
  }

  // 4) 是 YouTube 域名，但里面挑不出 ID
  if (LOOKS_LIKE_YT.test(s)) {
    return {
      message: `链接里没有找到 ${ID_LEN} 位的视频 ID。`,
      detail: '请确认链接是视频页（watch / youtu.be / shorts / live），而不是频道页或播放列表页。',
    };
  }

  return null;
}

module.exports = { extractVideoId, diagnoseUrl };
