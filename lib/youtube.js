'use strict';
/**
 * YouTube 文稿提取核心
 *
 * 取数策略（实测结论）：
 *   - ANDROID_VR 客户端：player 接口稳定返回字幕轨道，且 timedtext 可直接下载（首选）
 *   - MWEB / WEB 客户端：可作备选，并可拿到「翻译目标语言」列表
 *   - 视频落地页 HTML：最后兜底，可解析 ytInitialPlayerResponse
 * 注意：WEB 端字幕 URL 需要 POT 令牌，直接请求会返回 0 字节空响应，
 *       因此字幕下载统一使用 ANDROID_VR 轨道。
 */

const { request, requestJSON } = require('./http-client');
const { extractVideoId, diagnoseUrl } = require('./url');
const TRANSLATION_LANGS = require('./languages');
const config = require('./config');
const { withTimeout } = require('./util');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ 文本工具 ------------------------------ */

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&nbsp;': ' ', '&#x27;': "'", '&#x2F;': '/', '&mdash;': '—', '&ndash;': '–',
};

function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z#0-9x]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function cleanText(s) {
  return decodeEntities(s)
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 从文本中按括号配对切出完整 JSON 对象字符串 */
function sliceJSON(text, startIdx) {
  let depth = 0, inStr = false, esc = false;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

/* ------------------------------ 客户端定义 ------------------------------ */

const UA_VR = 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip';
const UA_ANDROID = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
const UA_IOS = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)';
const UA_MWEB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const K_A = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w'; // ANDROID 系
const K_IOS = 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc';  // iOS 系
const K_W = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // WEB 系

const CLIENTS = [
  {
    name: 'ANDROID', key: K_A, ua: UA_ANDROID, canFetchTrack: true,
    client: {
      clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30,
      osName: 'Android', osVersion: '11', hl: 'en', gl: 'US',
    },
    headers: { 'User-Agent': UA_ANDROID, 'X-YouTube-Client-Name': '3', 'X-YouTube-Client-Version': '20.10.38' },
  },
  {
    name: 'IOS', key: K_IOS, ua: UA_IOS, canFetchTrack: true,
    client: {
      clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2',
      osName: 'iPhone', osVersion: '18.3.2.22D82', hl: 'en', gl: 'US',
    },
    headers: { 'User-Agent': UA_IOS, 'X-YouTube-Client-Name': '5', 'X-YouTube-Client-Version': '20.10.4' },
  },
  {
    name: 'ANDROID_VR', key: K_A, ua: UA_VR, canFetchTrack: true,
    client: {
      clientName: 'ANDROID_VR', clientVersion: '1.60.19', androidSdkVersion: 32,
      osName: 'Android', osVersion: '12', hl: 'en', gl: 'US',
    },
    headers: { 'User-Agent': UA_VR, 'X-YouTube-Client-Name': '28', 'X-YouTube-Client-Version': '1.60.19' },
  },
  {
    name: 'MWEB', key: K_W, ua: UA_MWEB, canFetchTrack: false,
    client: { clientName: 'MWEB', clientVersion: '2.20240701.00.00', hl: 'en', gl: 'US' },
    headers: { 'User-Agent': UA_MWEB },
  },
  {
    name: 'WEB', key: K_W, ua: UA_WEB, canFetchTrack: false,
    client: { clientName: 'WEB', clientVersion: '2.20240701.00.00', hl: 'en', gl: 'US' },
    headers: { 'User-Agent': UA_WEB },
  },
];

function hasTracks(pr) {
  return !!pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length;
}

/* --------------------------- player response --------------------------- */

const prCache = new Map(); // videoId -> { pr, source, at }
const PR_TTL = 15 * 60 * 1000;

/**
 * 把 YouTube 的 playabilityStatus 翻译成「用户能看懂且能据此行动」的失败原因。
 *
 * 动机：以前无论什么原因失败都笼统报「服务端暂时无法访问 YouTube」，
 * 但视频被删、私享、地区限制、年龄限制的时候，服务端网络明明是好的，
 * 这句话会把用户往排查代理的方向带偏。
 */
const PLAYABILITY_RULES = [
  [/sign in to confirm your age|age.?restrict/i, 'AGE_RESTRICTED',
    '该视频有年龄限制，需要登录才能观看，因此取不到字幕。'],
  // 注意：实测这种拦截对「同一出口 + 同一视频」是稳定复现的（连打 6 次 0 成功），
  // 因此文案里**不能**承诺「重试就能过」，否则用户会白试很多次。
  [/not a bot|unusual traffic|confirm you'?re not a bot|too many requests/i, 'POT_REQUIRED',
    'YouTube 要求人机校验（风控拦截），该视频暂时取不到字幕。'],
  [/private video|this video is private/i, 'VIDEO_UNAVAILABLE',
    '该视频是私享（仅自己可见）视频，无法提取字幕。'],
  [/has been removed|no longer available|deleted/i, 'VIDEO_UNAVAILABLE',
    '该视频已被删除或下架，无法提取字幕。'],
  [/not available in your country|unavailable in your country|blocked.*country|region/i, 'VIDEO_UNAVAILABLE',
    '该视频存在地区限制，当前网络出口所在地区无法观看。'],
  [/video unavailable|this video is unavailable/i, 'VIDEO_UNAVAILABLE',
    '视频不存在或已不可访问，请检查链接里的视频 ID 是否正确（11 位、区分大小写）。'],
  [/live stream|premiere/i, 'VIDEO_UNAVAILABLE',
    '该视频是直播或首映，结束后才可能有字幕。'],
];

/** 依据各客户端的 playabilityStatus 判定「视频侧」的失败原因 */
function classifyPlayability(observations) {
  const answered = observations.filter((o) => o.responded);
  const troubled = answered.filter((o) => o.status && o.status !== 'OK');
  const text = troubled.map((o) => `${o.status} ${o.reason || ''}`).join(' | ');

  if (troubled.length) {
    for (const [re, code, message] of PLAYABILITY_RULES) {
      if (re.test(text)) return { code, message };
    }
    const st = troubled[0].status;
    if (st === 'ERROR' || st === 'UNPLAYABLE' || st === 'LOGIN_REQUIRED') {
      return {
        code: 'VIDEO_UNAVAILABLE',
        message: '视频不可用（不存在 / 已删除 / 私享 / 地区或年龄限制），请检查链接里的视频 ID。',
      };
    }
  }
  return null;
}

function playerResponseFromHTML(html) {
  const m = /ytInitialPlayerResponse\s*=\s*/.exec(html);
  if (m) {
    const start = html.indexOf('{', m.index + m[0].length - 1);
    if (start !== -1) {
      const json = sliceJSON(html, start);
      if (json) {
        try {
          const pr = JSON.parse(json);
          if (pr?.videoDetails?.videoId || pr?.captions) return pr;
        } catch { /* ignore */ }
      }
    }
  }
  return null;
}

async function callPlayerApi(client, videoId, hl) {
  const r = await requestJSON(
    `https://www.youtube.com/youtubei/v1/player?key=${client.key}&prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...client.headers,
      },
      body: JSON.stringify({
        videoId,
        context: { client: { ...client.client, hl: hl || client.client.hl } },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      retries: 0,
    }
  );
  return r.json;
}

/**
 * 获取 player response。返回 { pr, source, ua }
 * @param {string} videoId
 * @param {{hl?:string, skipCache?:boolean}} opts
 */
async function getPlayerResponse(videoId, opts = {}) {
  const { hl = 'en', skipCache = false } = opts;
  const hit = prCache.get(videoId);
  if (!skipCache && hit && Date.now() - hit.at < PR_TTL) return hit;

  const notes = [];
  let fallback = null; // 有轨道但无法下载的（如网页端），留作元数据兜底
  // 记录每个客户端到底「有没有拿到响应」，用于区分视频侧问题与网络侧问题
  const observations = [];

  // 1) 优先能直接下载字幕的客户端
  for (const c of CLIENTS.filter((x) => x.canFetchTrack)) {
    try {
      const pr = await callPlayerApi(c, videoId, hl);
      const ps = pr?.playabilityStatus;
      const st = ps?.status;
      observations.push({ source: c.name, responded: true, status: st || '', reason: ps?.reason || '' });
      if (hasTracks(pr) && st !== 'UNPLAYABLE') {
        const rec = { pr, source: c.name, ua: c.ua, canFetchTrack: true };
        prCache.set(videoId, { ...rec, at: Date.now() });
        return rec;
      }
      notes.push(`${c.name}: ${st || '无字幕轨道'}${ps?.reason ? ' (' + ps.reason + ')' : ''}`);
    } catch (e) {
      observations.push({ source: c.name, responded: false, error: e.message });
      notes.push(`${c.name}: ${e.message}`);
    }
  }

  // 2) 其余客户端，可拿到轨道列表与翻译语言
  for (const c of CLIENTS.filter((x) => !x.canFetchTrack)) {
    try {
      const pr = await callPlayerApi(c, videoId, hl);
      const ps = pr?.playabilityStatus;
      const st = ps?.status;
      observations.push({ source: c.name, responded: true, status: st || '', reason: ps?.reason || '' });
      if (hasTracks(pr)) {
        if (!fallback) fallback = { pr, source: c.name, ua: c.ua, canFetchTrack: false };
        continue;
      }
      notes.push(`${c.name}: ${st || '无字幕轨道'}${ps?.reason ? ' (' + ps.reason + ')' : ''}`);
    } catch (e) {
      observations.push({ source: c.name, responded: false, error: e.message });
      notes.push(`${c.name}: ${e.message}`);
    }
  }

  // 3) 落地页 HTML 兜底
  try {
    const r = await request(`https://www.youtube.com/watch?v=${videoId}&hl=${hl}`, {
      headers: { 'User-Agent': UA_WEB, 'Accept-Language': `${hl},en;q=0.8` },
      retries: 0,
    });
    const pr = playerResponseFromHTML(r.text);
    if (pr && (hasTracks(pr) || pr.videoDetails)) {
      const rec = fallback || { pr, source: 'HTML', ua: UA_WEB, canFetchTrack: false };
      if (!fallback) rec.pr = pr;
      if (hasTracks(pr) || pr?.videoDetails?.title) {
        prCache.set(videoId, { ...rec, at: Date.now() });
        return rec;
      }
    }
    notes.push('落地页: 未解析到有效数据');
  } catch (e) {
    notes.push(`落地页: ${e.message}`);
  }

  if (fallback) {
    prCache.set(videoId, { ...fallback, at: Date.now() });
    return fallback;
  }

  const st = (() => { try { return notes.join(' | '); } catch { return ''; } })();

  // 先看视频侧：只要有任何客户端拿到了 playabilityStatus，就能判定真实原因
  const classified = classifyPlayability(observations);
  if (classified) {
    const e = new Error(classified.message);
    e.code = classified.code;
    e.detail = st;
    throw e;
  }

  // 所有客户端都「没拿到任何响应」→ 这才是真正的网络/出口问题
  if (!observations.some((o) => o.responded)) {
    const e = new Error('服务端与 YouTube 通信失败：所有客户端均无响应。');
    e.code = 'FETCH_FAILED';
    e.detail = st;
    throw e;
  }

  const err = new Error('无法获取该视频的字幕信息，可能是不存在 / 私享 / 未开启字幕 / 区域限制。');
  err.code = 'PLAYER_FAILED';
  err.detail = st;
  throw err;
}

/* ------------------------------ 字幕轨道 ------------------------------ */

function trackName(t) {
  return (
    t.name?.simpleText ||
    (t.name?.runs || []).map((r) => r.text).join('') ||
    t.languageCode
  );
}

function listTracks(pr) {
  const renderer = pr?.captions?.playerCaptionsTracklistRenderer;
  const tracks = renderer?.captionTracks || [];
  const seen = new Set();
  const mapped = [];
  for (const t of tracks) {
    const key = `${t.languageCode}|${t.kind || 'manual'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mapped.push({
      lang: t.languageCode,
      name: trackName(t),
      isAuto: t.kind === 'asr',
      baseUrl: t.baseUrl,
      vssId: t.vssId || '',
    });
  }
  // 手动字幕优先
  mapped.sort((a, b) => (a.isAuto === b.isAuto ? 0 : a.isAuto ? 1 : -1));

  const remote = (renderer?.translationLanguages || []).map((o) => ({
    code: o.languageCode,
    name: o.languageName?.simpleText || o.languageCode,
  }));
  const merged = [...remote];
  for (const l of TRANSLATION_LANGS) if (!merged.some((m) => m.code === l.code)) merged.push(l);

  return { tracks: mapped, translationLanguages: merged, remoteTranslationCount: remote.length };
}

/* ------------------------------ 解析字幕 ------------------------------ */

function parseJSON3(text) {
  const data = JSON.parse(text);
  const segs = [];
  for (const ev of data.events || []) {
    if (!ev.segs) continue;
    const t = cleanText(ev.segs.map((s) => s.utf8 || '').join(''));
    if (!t) continue;
    segs.push({ start: (ev.tStartMs || 0) / 1000, dur: (ev.dDurationMs || 0) / 1000, text: t });
  }
  return segs;
}

function parseXML(text) {
  const segs = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(text))) {
    const start = parseFloat((m[1].match(/\bstart="([\d.]+)"/) || [])[1] || '0');
    const dur = parseFloat((m[1].match(/\bdur="([\d.]+)"/) || [])[1] || '0');
    const t = cleanText(m[2].replace(/<[^>]+>/g, ''));
    if (!t) continue;
    segs.push({ start, dur, text: t });
  }
  return segs;
}

/** 去掉自动字幕常见的滚动重复片段 */
function dedupe(segs) {
  const out = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (!prev) { out.push(s); continue; }
    if (prev.text === s.text) continue;
    if (s.text.startsWith(prev.text) && s.text.length > prev.text.length) {
      out[out.length - 1] = { start: prev.start, dur: s.start - prev.start + s.dur, text: s.text };
      continue;
    }
    out.push(s);
  }
  return out;
}

/**
 * 翻译语言别名。YouTube 对同一种语言存在多个等价代码，
 * 某些别名（如 zh-CN）命中缓存可立即返回，而 zh-Hans 需现场生成、易被限流。
 */
const TLANG_ALIAS = {
  'zh-Hans': ['zh-CN', 'zh-Hans', 'zh'],
  'zh-CN': ['zh-CN', 'zh-Hans', 'zh'],
  'zh-Hant': ['zh-TW', 'zh-Hant', 'zh'],
  'zh-TW': ['zh-TW', 'zh-Hant', 'zh'],
  'zh': ['zh-CN', 'zh', 'zh-Hans'],
  'pt-BR': ['pt-BR', 'pt'],
  'pt': ['pt', 'pt-BR'],
  'es-419': ['es-419', 'es'],
  'es': ['es', 'es-419'],
  'fil': ['fil', 'tl'],
  'no': ['no', 'nb'],
};

function tlangCandidates(tlang) {
  const list = TLANG_ALIAS[tlang] ? [...TLANG_ALIAS[tlang]] : [tlang];
  if (!list.includes(tlang)) list.unshift(tlang);
  return [...new Set(list)];
}

/**
 * 下载并解析一条字幕轨道，遇 429 自动退避重试
 * @param {string} baseUrl 轨道地址
 * @param {{tlang?:string, ua?:string, maxAttempts?:number, rounds?:number}} opts
 */
async function fetchTrack(baseUrl, { tlang = '', ua, maxAttempts = 2, rounds = 1 } = {}) {
  const variants = tlang ? tlangCandidates(tlang) : [''];
  const totalRounds = tlang ? rounds : 1;

  let lastNote = '';
  for (let round = 0; round < totalRounds; round++) {
    for (const variant of variants) {
      const url = new URL(baseUrl);
      url.searchParams.set('fmt', 'json3');
      if (variant) url.searchParams.set('tlang', variant);

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const r = await request(url.toString(), {
          retries: 0,
          headers: ua ? { 'User-Agent': ua } : {},
        });

        if (r.status === 429) {
          lastNote = '接口限流';
          if (attempt < maxAttempts - 1) await sleep(1500 * (attempt + 1));
          continue;
        }
        if (r.status !== 200) {
          lastNote = `HTTP ${r.status}`;
          break; // 该变体不可用，换下一个变体
        }
        if (!r.text.trim()) {
          lastNote = '返回内容为空';
          if (attempt < maxAttempts - 1) await sleep(800 * (attempt + 1));
          continue;
        }
        const cleaned = parseTrackText(r.text);
        if (cleaned.length) return { segments: cleaned, usedTlang: variant };
        lastNote = '未解析到字幕片段';
        break;
      }
    }
    if (round < totalRounds - 1) await sleep(1500 * (round + 1) + Math.random() * 700);
  }

  throw Object.assign(
    new Error(
      lastNote === '接口限流'
        ? 'YouTube 字幕接口暂时限流（429），请等待 10~30 秒后重试。'
        : `未获取到字幕内容（${lastNote}）。`
    ),
    { code: 'TRACK_EMPTY', note: lastNote }
  );
}

function parseTrackText(text) {
  let segs = [];
  try { segs = parseJSON3(text); } catch { segs = parseXML(text); }
  if (!segs.length) segs = parseXML(text);
  return dedupe(segs).filter((s) => s.text);
}

/* ------------------------------ 视频元信息 ------------------------------ */

async function fetchVideoMeta(videoId, pr) {
  const d = pr?.videoDetails;
  if (d?.title) {
    const thumbs = d.thumbnail?.thumbnails || [];
    return {
      id: videoId,
      title: decodeEntities(d.title),
      author: decodeEntities(d.author || ''),
      authorId: d.channelId || '',
      lengthSeconds: Number(d.lengthSeconds || 0),
      viewCount: Number(d.viewCount || 0),
      description: decodeEntities(d.shortDescription || '').slice(0, 600),
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      isLive: !!d.isLiveContent,
    };
  }
  try {
    const r = await requestJSON(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { retries: 0 }
    );
    return {
      id: videoId, title: r.json.title, author: r.json.author_name,
      authorId: '', lengthSeconds: 0, viewCount: 0, description: '',
      thumbnail: r.json.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      isLive: false,
    };
  } catch {
    return {
      id: videoId, title: `YouTube 视频 ${videoId}`, author: '', authorId: '',
      lengthSeconds: 0, viewCount: 0, description: '',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, isLive: false,
    };
  }
}

/* ------------------------------ 结果缓存 ------------------------------ */

const resultCache = new Map(); // key -> { data, at }
const RESULT_TTL = 6 * 60 * 1000;

/* ------------------------------ 主流程 ------------------------------ */

/**
 * 翻译步骤可用的时间预算。
 *
 * YouTube 的按需翻译要现场生成，实测耗时 20~46 秒（自动字幕视频最慢）。
 * 有 deadline 时按「剩余时间减去收尾余量」计算，确保内层先于外层总超时触发，
 * 这样超时也能优雅退化成「原文 + 提示」，而不是整个请求失败。
 */
function translateBudget(deadline) {
  const cap = config.load().translateTimeoutMs;
  if (!deadline) return cap;
  const left = deadline - Date.now() - 1500;
  return Math.max(3000, Math.min(cap, left));
}

/**
 * @param {string} input 视频链接或 11 位 ID
 * @param {{lang?:string, tlang?:string, force?:boolean, deadline?:number}} opts
 *        deadline —— 绝对时间戳（Date.now() 口径），用于约束翻译步骤的耗时
 */
async function fetchTranscript(input, opts = {}) {
  const videoId = extractVideoId(input);
  if (!videoId) {
    const diag = diagnoseUrl(input);
    throw Object.assign(
      new Error(diag ? diag.message : '无法识别视频链接，请粘贴完整的 YouTube 视频地址'),
      { code: 'BAD_URL', detail: diag ? diag.detail : '' }
    );
  }

  const { lang = '', tlang = '', force = false, deadline = 0 } = opts;
  const cacheKey = `${videoId}|${lang}|${tlang}`;
  const hit = resultCache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < RESULT_TTL) return { ...hit.data, fromCache: true };

  const rec = await getPlayerResponse(videoId, { hl: lang || 'en' });
  const { tracks, translationLanguages } = listTracks(rec.pr);

  if (!tracks.length) {
    throw Object.assign(
      new Error('该视频没有可用字幕：UP 主未上传字幕，且未开启自动字幕。'),
      { code: 'NO_CAPTIONS' }
    );
  }

  // 选定轨道
  let track = null;
  if (lang) {
    track =
      tracks.find((t) => t.lang === lang && !t.isAuto) ||
      tracks.find((t) => t.lang === lang) ||
      tracks.find((t) => t.lang.split('-')[0] === lang.split('-')[0]);
  }
  if (!track) {
    track =
      tracks.find((t) => !t.isAuto && /^en/i.test(t.lang)) ||
      tracks.find((t) => !t.isAuto) ||
      tracks.find((t) => /^en/i.test(t.lang)) ||
      tracks[0];
  }

  // 只有具备下载能力的客户端轨道可用；否则尝试一次网页端轨道（可能因 POT 缺失失败）
  const trackUa = rec.canFetchTrack ? rec.ua : UA_ANDROID;
  let segments = [];
  let translatedTo = '';
  let warn = '';

  try {
    ({ segments } = await fetchTrack(track.baseUrl, { ua: trackUa }));
  } catch (e) {
    if (!rec.canFetchTrack) {
      throw Object.assign(
        new Error('该视频的字幕无法直接下载（YouTube 风控校验失败），请稍后重试或更换视频。'),
        { code: 'POT_REQUIRED', detail: e.message }
      );
    }
    throw e;
  }

  // 翻译只是增强项：无论失败还是太慢，都必须退化成「原文 + 提示」，
  // 绝不能因为它让整个请求失败 —— 用户至少要能拿到原文字幕。
  if (tlang && tlang !== track.lang) {
    try {
      const r = await withTimeout(
        fetchTrack(track.baseUrl, { tlang, ua: trackUa, rounds: 3, maxAttempts: 2 }),
        translateBudget(deadline),
        '翻译耗时过长'
      );
      segments = r.segments;
      translatedTo = r.usedTlang || tlang;
    } catch (e) {
      warn = `翻译到「${tlang}」失败：${e.message} 已返回原文字幕。`;
    }
  }

  const meta = await fetchVideoMeta(videoId, rec.pr);
  const plain = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();

  const data = {
    videoId,
    meta,
    lang: track.lang,
    langName: track.name,
    isAuto: track.isAuto,
    translatedTo,
    source: rec.source,
    warning: warn,
    tracks: tracks.map(({ baseUrl, ...rest }) => rest),
    translationLanguages,
    segments,
    plain,
    stats: {
      segments: segments.length,
      words: (plain.match(/[A-Za-z0-9'’\-]+/g) || []).length,
      chars: plain.length,
      cjk: (plain.match(/[\u4e00-\u9fff]/g) || []).length,
      duration: segments.length
        ? Math.max(...segments.map((s) => s.start + (s.dur || 0)))
        : 0,
    },
  };

  // 翻译没成功（限流 / 超时）时不写缓存，用户点一下就能立刻重试
  const translationFailed = Boolean(tlang && tlang !== track.lang && !translatedTo);
  if (!translationFailed) {
    resultCache.set(cacheKey, { data, at: Date.now() });
    // 控制缓存规模
    if (resultCache.size > 80) resultCache.delete(resultCache.keys().next().value);
  }

  return data;
}

module.exports = { extractVideoId, fetchTranscript, getPlayerResponse, listTracks, cleanText };
