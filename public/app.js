/* ============================================================
   YT Script · 前端逻辑
   ============================================================ */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const el = {
  urlInput: $('#urlInput'),
  goBtn: $('#goBtn'),
  pasteBtn: $('#pasteBtn'),
  statusBar: $('#statusBar'),
  result: $('#result'),
  player: $('#player'),
  playerFallback: $('#playerFallback'),
  fbThumb: $('#fbThumb'),
  fbLink: $('#fbLink'),
  vTitle: $('#vTitle'),
  vAuthor: $('#vAuthor'),
  vDuration: $('#vDuration'),
  vViews: $('#vViews'),
  tagLang: $('#tagLang'),
  tagAuto: $('#tagAuto'),
  tagSource: $('#tagSource'),
  langSel: $('#langSel'),
  tlangSel: $('#tlangSel'),
  translateBtn: $('#translateBtn'),
  viewSeg: $('#viewSeg'),
  tsToggle: $('#tsToggle'),
  searchInput: $('#searchInput'),
  searchInfo: $('#searchInfo'),
  transcript: $('#transcript'),
  trMeta: $('#trMeta'),
  stats: $('#stats'),
  backBtn: $('#backBtn'),
  historySec: $('#historySec'),
  historyList: $('#historyList'),
  clearHistory: $('#clearHistory'),
  netStatus: $('#netStatus'),
  netDot: $('#netDot'),
  netText: $('#netText'),
  netNotice: $('#netNotice'),
  heroBadge: $('#heroBadge'),
  settings: $('#settings'),
  settingsMask: $('#settingsMask'),
  settingsClose: $('#settingsClose'),
  proxyInput: $('#proxyInput'),
  proxySave: $('#proxySave'),
  proxyAuto: $('#proxyAuto'),
  proxyResult: $('#proxyResult'),
  proxyInfo: $('#proxyInfo'),
};

const state = {
  data: null,        // 当前文稿数据
  view: 'lines',     // lines | para
  showTs: true,
  query: '',
  loading: false,
  player: null,
  playerReady: false,
  playerFailed: false,
  activeIdx: -1,
  tickTimer: null,
  follow: true,
};

/* ------------------------------ 工具 ------------------------------ */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(sec, withMs = false) {
  sec = Math.max(0, Number(sec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const base = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
  if (!withMs) return base;
  const ms = Math.floor((sec % 1) * 1000);
  return `${h > 0 ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function fmtDuration(sec) {
  if (!sec) return '时长未知';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} 小时 ${m} 分` : `${m} 分 ${Math.floor(sec % 60)} 秒`;
}

function fmtNum(n) {
  if (!n) return '';
  if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿次观看';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万次观看';
  return n.toLocaleString('zh-CN') + ' 次观看';
}

function setStatus(type, title, body, detail) {
  if (!type) { el.statusBar.hidden = true; return; }
  const icons = {
    err: '⚠️', warn: '⟳', ok: '✓', info: 'ℹ️',
  };
  el.statusBar.hidden = false;
  el.statusBar.className = 'status ' + (type === 'info' ? '' : type);
  el.statusBar.innerHTML =
    `<span class="s-ico">${icons[type] || '•'}</span><div class="s-body">` +
    `<b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}` +
    (detail ? `<div class="s-detail">${esc(detail)}</div>` : '') +
    '</div>';
}

function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', left: '50%', bottom: '34px', transform: 'translateX(-50%)',
    background: '#1d2130', color: '#e9ebf2', padding: '11px 20px', borderRadius: '11px',
    border: '1px solid rgba(255,255,255,.13)', fontSize: '13.5px', zIndex: 999,
    boxShadow: '0 16px 40px -14px rgba(0,0,0,.9)', opacity: '0', transition: 'opacity .2s, transform .2s',
  });
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(-4px)'; });
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 240);
  }, 1900);
}

async function copyText(text, label = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(label); }
    catch { toast('复制失败，请手动选择文本'); }
    ta.remove();
  }
}

function download(filename, text, mime = 'text/plain;charset=utf-8') {
  // JSON 不加 BOM，避免解析器报错
  const withBom = !/json/i.test(mime);
  const blob = new Blob([withBom ? '\ufeff' + text : text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
  toast('已导出 ' + filename);
}

function safeName(s) {
  return (s || 'transcript').replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 70).trim() || 'transcript';
}

/* ------------------------------ 网络状态 ------------------------------ */

/**
 * 运行模式。
 * local  —— 本机运行，访客可以修改服务器出口代理
 * public —— 公开部署，代理相关入口必须隐藏（改动会 SSRF，且只对部署者有影响）
 */
const RUNTIME = { mode: 'local', canConfigProxy: true, transport: '', loaded: false };

function isPublicMode() {
  return RUNTIME.mode === 'public';
}

function applyRuntimeMode() {
  document.documentElement.dataset.mode = RUNTIME.mode;
  el.netStatus.classList.toggle('is-readonly', isPublicMode());
  el.netStatus.title = isPublicMode() ? '服务运行状态' : '网络设置';

  if (isPublicMode()) {
    el.settings.hidden = true;
    el.settingsMask.hidden = true;
  }

  // 使用说明里的网络提示：公开模式下不该让访客去填「本机代理」
  if (el.netNotice) {
    el.netNotice.innerHTML = isPublicMode()
      ? '<strong>关于网络：</strong>本站字幕提取在服务端完成，你所在网络的限制不影响提取结果。' +
        '内嵌播放器若无法加载，可点视频卡片在新窗口打开。'
      : '<strong>关于网络：</strong>YouTube 在中国大陆不可直接访问。若提取失败，请先在右上角「网络状态」中填写本机代理地址' +
        '（如 <code>http://127.0.0.1:7890</code>），或使用 <code>--proxy</code> 参数启动服务。';
  }

  if (el.heroBadge) {
    el.heroBadge.textContent = isPublicMode()
      ? '完全免费 · 无需登录 · 打开即用'
      : '完全免费 · 无需登录 · 本地运行';
  }
}

async function refreshHealth(force = false) {
  el.netDot.className = 'dot loading';
  el.netText.textContent = '检测中';
  try {
    const r = await fetch('/api/health');
    const j = await r.json();

    RUNTIME.mode = j.mode || 'local';
    RUNTIME.canConfigProxy = !!j.allowProxyConfig;
    RUNTIME.transport = j.transport || '';
    RUNTIME.loaded = true;
    applyRuntimeMode();

    // 健康检查只代表「后端可用」——服务端是否真能访问 YouTube 属于另一回事，
    // 不在页面加载时反复探测（那要跑一轮代理测试，很慢）
    const ok = r.ok;
    el.netDot.className = 'dot ' + (ok ? 'ok' : 'bad');
    el.netText.textContent = isPublicMode()
      ? (ok ? '服务正常' : '服务异常')
      : (j.transport === 'proxy' ? '代理已连接' : '直连模式');

    if (!isPublicMode()) el.proxyInfo.textContent = JSON.stringify(j, null, 2);
    return j;
  } catch (e) {
    el.netDot.className = 'dot bad';
    el.netText.textContent = '服务不可用';
    return null;
  }
}

function openSettings() {
  if (!RUNTIME.canConfigProxy) {
    toast('这是公开服务，服务器网络设置不可修改');
    return;
  }
  el.settings.hidden = false;
  el.settingsMask.hidden = false;
  refreshHealth().then((j) => { if (j && j.activeProxy) el.proxyInput.value = j.activeProxy; });
}
function closeSettings() {
  el.settings.hidden = true;
  el.settingsMask.hidden = true;
}

/* ------------------------------ 提取流程 ------------------------------ */

/* 链接预检（本地）
 * 与服务端 lib/url.js 用同一套判定标准。目的是把「链接少复制了一位」这类
 * 高频低级错误在浏览器里就地拦下——否则用户要白等一次请求，还只能收到
 * 一句笼统的「无法识别链接」，完全不知道错在哪一位。 */
const ID_LEN = 11;

/* 正向提取规则：与服务端 lib/url.js 的 PATTERNS 必须逐条一致，
 * 否则会出现「前端拦下合法链接、服务端却认」的不一致。 */
const ID_PATTERNS = [
  /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/i,
  /youtu\.be\/([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com|youtube-nocookie\.com)\/(?:embed|v|e)\/([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com|youtube-nocookie\.com)\/shorts\/([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com|youtube-nocookie\.com)\/live\/([A-Za-z0-9_-]{11})/i,
  /[?&]v=([A-Za-z0-9_-]{11})/,
];

function preflight(raw) {
  const compact = String(raw || '').replace(/\s/g, '');
  if (!compact) {
    return {
      ok: false,
      title: '请先填写视频链接',
      body: `支持 youtube.com/watch、youtu.be、shorts、live 等链接，或直接填 ${ID_LEN} 位视频 ID。`,
    };
  }

  // 正向：能解析出 11 位 ID 就直接放行
  if (new RegExp(`^[A-Za-z0-9_-]{${ID_LEN}}$`).test(compact)) return { ok: true, id: compact };
  for (const re of ID_PATTERNS) {
    const m = compact.match(re);
    if (m) return { ok: true, id: m[1] };
  }

  // 反向：解析不出来时，尽量说清是哪里不对
  const byQuery = /[?&]v=([A-Za-z0-9_-]+)/.exec(compact);
  if (byQuery && byQuery[1].length !== ID_LEN) {
    return {
      ok: false,
      title: `链接里的视频 ID 是 ${byQuery[1].length} 位，YouTube 固定 ${ID_LEN} 位。`,
      body: `解析到「${byQuery[1]}」。多半是复制时漏了字符，请重新完整复制链接。`,
    };
  }

  const byPath = /(?:youtu\.be\/|shorts\/|live\/|embed\/|youtube\.com\/v\/)([A-Za-z0-9_-]+)/i.exec(compact);
  if (byPath && byPath[1].length !== ID_LEN) {
    return {
      ok: false,
      title: `链接里的视频 ID 是 ${byPath[1].length} 位，应为 ${ID_LEN} 位。`,
      body: `解析到「${byPath[1]}」。请重新完整复制链接，或直接填 ${ID_LEN} 位视频 ID。`,
    };
  }

  if (/^[A-Za-z0-9_-]+$/.test(compact) && compact.length !== ID_LEN) {
    return {
      ok: false,
      title: `视频 ID 应为 ${ID_LEN} 位，当前是 ${compact.length} 位。`,
      body: `收到「${compact}」。请检查是否漏了字符（ID 区分大小写）。`,
    };
  }

  if (/(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(compact)) {
    return {
      ok: false,
      title: `链接里没有找到 ${ID_LEN} 位的视频 ID。`,
      body: '请确认链接是视频页（watch / youtu.be / shorts / live），而不是频道页或播放列表页。',
    };
  }

  return {
    ok: false,
    title: '无法识别视频链接',
    body: `请粘贴完整的 YouTube 视频地址，或直接填 ${ID_LEN} 位视频 ID。`,
  };
}

async function extract(url, opts = {}) {
  if (state.loading) return;
  const target = (url !== undefined ? url : el.urlInput.value).trim();
  if (!target) {
    setStatus('err', '请先填写视频链接', `支持 youtube.com/watch、youtu.be、shorts、live 等链接，或直接填 ${ID_LEN} 位视频 ID。`);
    el.urlInput.focus();
    return;
  }

  const pre = preflight(target);
  if (!pre.ok) {
    setStatus('err', pre.title, pre.body);
    el.urlInput.focus();
    return;
  }

  state.loading = true;
  el.goBtn.disabled = true;
  el.goBtn.querySelector('.btn-label').textContent = opts.tlang ? '翻译中…' : '提取中…';
  el.goBtn.querySelector('.spinner').hidden = false;
  if (!opts.keepStatus) {
    setStatus('warn', opts.tlang ? '正在获取译文…' : '正在提取文稿…',
      '首次请求需要解析播放器信息，翻译轨道按需生成，可能需要十几秒。');
  }

  const lang = opts.lang !== undefined ? opts.lang : (state.data?.lang || '');
  const tlang = opts.tlang !== undefined ? opts.tlang : '';

  try {
    const qs = new URLSearchParams({ url: target });
    if (lang) qs.set('lang', lang);
    if (tlang) qs.set('tlang', tlang);
    const r = await fetch('/api/transcript?' + qs.toString());
    const j = await r.json();

    if (!j.ok) {
      setStatus('err', j.error || '提取失败', j.hint || '', j.detail || '');
      return;
    }

    state.data = j;
    state.activeIdx = -1;
    if (opts.tlang) {
      setStatus(j.translatedTo ? 'ok' : 'warn',
        j.translatedTo ? `已翻译为 ${j.translatedTo}` : '翻译未成功',
        j.warning || '', '');
      setTimeout(() => setStatus(null), 4000);
    } else if (j.warning) {
      setStatus('warn', '部分内容未完成', j.warning, '');
    } else {
      setStatus(null);
    }

    renderResult(j);
    saveHistory(j);
    el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    setStatus('err', '请求本地服务失败', '请确认服务进程仍在运行。', e.message);
  } finally {
    state.loading = false;
    el.goBtn.disabled = false;
    el.goBtn.querySelector('.btn-label').textContent = '提取文稿';
    el.goBtn.querySelector('.spinner').hidden = true;
  }
}

/* ------------------------------ 渲染 ------------------------------ */

function renderResult(d) {
  el.result.hidden = false;

  // 视频信息
  el.vTitle.textContent = d.meta.title || '未命名视频';
  el.vAuthor.textContent = d.meta.author || '未知作者';
  el.vDuration.textContent = fmtDuration(d.meta.lengthSeconds || d.stats.duration);
  el.vViews.textContent = fmtNum(d.meta.viewCount);
  el.tagLang.textContent = `轨道：${d.lang}（${d.langName}）`;
  el.tagAuto.textContent = d.isAuto ? '自动字幕' : '人工字幕';
  el.tagAuto.className = 'tag' + (d.isAuto ? '' : ' tag-ok');
  el.tagSource.textContent = '来源：' + (d.translatedTo ? `译文 ${d.translatedTo}` : d.source || '未知');

  // 播放器
  renderPlayer(d);

  // 语言下拉
  el.langSel.innerHTML = d.tracks.map((t) =>
    `<option value="${esc(t.lang)}"${t.lang === d.lang && t.isAuto === d.isAuto ? ' selected' : ''}>` +
    `${esc(t.name)}${t.isAuto ? ' · 自动' : ''}</option>`).join('');

  // 翻译下拉
  const cur = d.translatedTo || '';
  el.tlangSel.innerHTML = '<option value="">不翻译（保留原文）</option>' +
    (d.translationLanguages || []).map((l) =>
      `<option value="${esc(l.code)}"${l.code === cur ? ' selected' : ''}>${esc(l.name)} (${esc(l.code)})</option>`
    ).join('');

  // 统计
  const s = d.stats || {};
  el.stats.innerHTML = [
    ['片段', (s.segments || 0).toLocaleString('zh-CN')],
    ['词数', (s.words || 0).toLocaleString('zh-CN')],
    ['字符', (s.chars || 0).toLocaleString('zh-CN')],
    ['覆盖时长', fmtTime(s.duration || 0)],
  ].map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');

  el.trMeta.textContent = d.translatedTo
    ? `文稿 · ${d.translatedTo} 译文`
    : `文稿 · ${d.langName}`;

  el.searchInput.value = '';
  state.query = '';
  el.searchInfo.textContent = '';
  renderTranscript();
}

function renderTranscript() {
  const d = state.data;
  if (!d) return;
  const segs = d.segments || [];
  const q = state.query.trim().toLowerCase();

  if (!segs.length) {
    el.transcript.innerHTML = '<div class="empty-state">没有可显示的文稿片段</div>';
    return;
  }

  if (state.view === 'para') {
    el.transcript.innerHTML = buildParagraphs(segs, q);
    bindLineClicks();
    return;
  }

  const rows = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const hit = q && seg.text.toLowerCase().includes(q);
    if (q && !hit) continue;
    rows.push(
      `<div class="line${state.showTs ? '' : ' no-ts'}" data-i="${i}" data-t="${seg.start}">` +
      (state.showTs ? `<span class="ts">${fmtTime(seg.start)}</span>` : '') +
      `<span class="txt">${highlight(seg.text, q)}</span></div>`
    );
  }
  el.transcript.innerHTML = rows.length
    ? rows.join('')
    : '<div class="empty-state">没有匹配的片段，换个关键词试试</div>';
  bindLineClicks();
  if (q) el.searchInfo.textContent = `命中 ${rows.length} 行`;
}

function buildParagraphs(segs, q) {
  const paras = [];
  let buf = null;
  for (const seg of segs) {
    const gap = buf ? seg.start - (buf.start + buf.dur) : 0;
    if (!buf || gap > 1.1 || buf.text.length > 260) {
      if (buf) paras.push(buf);
      buf = { start: seg.start, dur: seg.dur, text: seg.text };
    } else {
      buf.text += (/[\u4e00-\u9fff]$/.test(buf.text) ? '' : ' ') + seg.text;
      buf.dur = seg.start + seg.dur - buf.start;
    }
  }
  if (buf) paras.push(buf);

  return paras
    .filter((p) => !q || p.text.toLowerCase().includes(q))
    .map((p) =>
      `<div class="para" data-t="${p.start}">` +
      `<span class="para-ts">${fmtTime(p.start)} – ${fmtTime(p.start + p.dur)}</span>` +
      `<div class="para-txt">${highlight(p.text, q)}</div></div>`
    ).join('') || '<div class="empty-state">没有匹配的段落</div>';
}

function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  try {
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  } catch {
    return safe;
  }
}

function bindLineClicks() {
  $$('#transcript .line, #transcript .para').forEach((node) => {
    node.addEventListener('click', () => {
      const t = parseFloat(node.dataset.t || '0');
      seekTo(t);
    });
  });
}

/* ------------------------------ 播放器 ------------------------------ */

let ytApiPromise = null;
function loadYouTubeAPI() {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
    const timer = setTimeout(() => resolve(window.YT || null), 9000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(window.YT); };
  });
  return ytApiPromise;
}

function renderPlayer(d) {
  const vid = d.videoId;
  el.fbThumb.src = d.meta.thumbnail || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  el.fbLink.href = `https://www.youtube.com/watch?v=${vid}`;
  el.playerFallback.hidden = false;

  destroyPlayer();
  el.player.innerHTML = '';

  loadYouTubeAPI().then((YT) => {
    if (!YT || !YT.Player) {
      state.playerFailed = true;
      return;
    }
    try {
      state.player = new YT.Player(el.player, {
        videoId: vid,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin },
        events: {
          onReady: () => {
            state.playerReady = true;
            el.playerFallback.hidden = true;
            startTick();
          },
          onError: () => { state.playerFailed = true; el.playerFallback.hidden = false; },
        },
      });
    } catch {
      state.playerFailed = true;
    }
  });
}

function destroyPlayer() {
  stopTick();
  try { state.player?.destroy?.(); } catch { /* ignore */ }
  state.player = null;
  state.playerReady = false;
  state.activeIdx = -1;
}

function seekTo(t) {
  if (state.player && state.playerReady) {
    try {
      state.player.seekTo(Math.max(0, t), true);
      state.player.playVideo();
    } catch { /* ignore */ }
  }
  jumpActive(t, false);
}

function jumpActive(time, scroll = true) {
  const segs = state.data?.segments || [];
  if (!segs.length) return;
  // 二分查找，长视频下依然流畅
  let lo = 0, hi = segs.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= time) { idx = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (idx === state.activeIdx) return;
  state.activeIdx = idx;

  $$('#transcript .line.active').forEach((n) => n.classList.remove('active'));
  if (idx < 0) return;
  const node = el.transcript.querySelector(`.line[data-i="${idx}"]`);
  if (node) {
    node.classList.add('active');
    if (scroll && state.follow) {
      const top = node.offsetTop - el.transcript.clientHeight / 2 + node.offsetHeight / 2;
      el.transcript.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }
}

function startTick() {
  stopTick();
  state.tickTimer = setInterval(() => {
    if (!state.player || !state.playerReady) return;
    try {
      const t = state.player.getCurrentTime?.();
      if (typeof t === 'number') jumpActive(t, true);
    } catch { /* ignore */ }
  }, 320);
}
function stopTick() {
  if (state.tickTimer) clearInterval(state.tickTimer);
  state.tickTimer = null;
}

/* ------------------------------ 导出 ------------------------------ */

function plainText(d) {
  return (d.segments || []).map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
}
function stampedText(d) {
  return (d.segments || []).map((s) => `[${fmtTime(s.start)}] ${s.text}`).join('\n');
}

/** SRT 时间码：HH:MM:SS,mmm */
function srtTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/** WebVTT 时间码：HH:MM:SS.mmm */
function vttTime(sec) {
  return srtTime(sec).replace(',', '.');
}

function srtText(d) {
  return (d.segments || []).map((s, i) => {
    const end = s.start + (s.dur || 0);
    return `${i + 1}\n${srtTime(s.start)} --> ${srtTime(end)}\n${s.text}\n`;
  }).join('\n');
}
function vttText(d) {
  const head = 'WEBVTT\n\n' + (d.meta.title ? `NOTE ${d.meta.title}\n\n` : '');
  return head + (d.segments || []).map((s) => {
    const end = s.start + (s.dur || 0);
    return `${vttTime(s.start)} --> ${vttTime(end)}\n${s.text}\n`;
  }).join('\n');
}

function baseName(d) {
  return safeName(`${d.meta.title || d.videoId}${d.translatedTo ? '-' + d.translatedTo : ''}`);
}

/* ------------------------------ 历史记录 ------------------------------ */

const HKEY = 'ytscript.history.v1';

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; }
}
function saveHistory(d) {
  const list = loadHistory().filter((x) => x.videoId !== d.videoId);
  list.unshift({
    videoId: d.videoId,
    title: d.meta.title,
    author: d.meta.author,
    thumb: d.meta.thumbnail,
    lang: d.lang,
    at: Date.now(),
  });
  localStorage.setItem(HKEY, JSON.stringify(list.slice(0, 12)));
  renderHistory();
}
function renderHistory() {
  const list = loadHistory();
  if (!list.length) { el.historySec.hidden = true; return; }
  el.historySec.hidden = false;
  el.historyList.innerHTML = list.map((x) =>
    `<button class="history-item" data-vid="${esc(x.videoId)}" data-lang="${esc(x.lang || '')}">` +
    `<img src="${esc(x.thumb)}" alt="" loading="lazy">` +
    `<div class="hi-body"><div class="hi-title">${esc(x.title)}</div>` +
    `<div class="hi-sub">${esc(x.author || '')}</div></div></button>`
  ).join('');
  $$('#historyList .history-item').forEach((b) => {
    b.addEventListener('click', () => {
      el.urlInput.value = `https://www.youtube.com/watch?v=${b.dataset.vid}`;
      extract(el.urlInput.value, { lang: '' });
    });
  });
}

/* ------------------------------ 事件绑定 ------------------------------ */

el.goBtn.addEventListener('click', () => extract());
el.urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') extract(); });

el.pasteBtn.addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t) { el.urlInput.value = t.trim(); el.urlInput.focus(); }
    else toast('剪贴板是空的');
  } catch {
    toast('浏览器未授权读取剪贴板，请手动粘贴');
  }
});

$$('.chip').forEach((c) => c.addEventListener('click', () => {
  el.urlInput.value = c.dataset.url;
  extract();
}));

el.langSel.addEventListener('change', () => {
  if (!state.data) return;
  extract(`https://www.youtube.com/watch?v=${state.data.videoId}`, { lang: el.langSel.value });
});

el.translateBtn.addEventListener('click', () => {
  if (!state.data) return;
  const tlang = el.tlangSel.value;
  extract(`https://www.youtube.com/watch?v=${state.data.videoId}`, {
    lang: state.data.lang, tlang, keepStatus: false,
  });
});

el.tlangSel.addEventListener('change', () => {
  if (state.data && !el.tlangSel.value && state.data.translatedTo) {
    extract(`https://www.youtube.com/watch?v=${state.data.videoId}`, { lang: state.data.lang });
  }
});

el.viewSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  $$('#viewSeg .seg-btn').forEach((b) => b.classList.toggle('is-on', b === btn));
  state.view = btn.dataset.view;
  renderTranscript();
});

el.tsToggle.addEventListener('change', () => {
  state.showTs = el.tsToggle.checked;
  renderTranscript();
});

let searchTimer = null;
el.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = el.searchInput.value;
    renderTranscript();
  }, 180);
});

$$('[data-copy]').forEach((b) => b.addEventListener('click', () => {
  const d = state.data;
  if (!d) return;
  if (b.dataset.copy === 'plain') copyText(plainText(d), '已复制纯文本');
  else copyText(stampedText(d), '已复制带时间戳文稿');
}));

$$('[data-dl]').forEach((b) => b.addEventListener('click', () => {
  const d = state.data;
  if (!d) return;
  const name = baseName(d);
  const kind = b.dataset.dl;
  if (kind === 'txt') download(name + '.txt', stampedText(d));
  if (kind === 'srt') download(name + '.srt', srtText(d), 'application/x-subrip;charset=utf-8');
  if (kind === 'vtt') download(name + '.vtt', vttText(d), 'text/vtt;charset=utf-8');
  if (kind === 'json') download(name + '.json', JSON.stringify(d, null, 2), 'application/json;charset=utf-8');
}));

el.backBtn.addEventListener('click', () => {
  destroyPlayer();
  el.result.hidden = true;
  el.urlInput.value = '';
  setStatus(null);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  el.urlInput.focus();
});

el.clearHistory.addEventListener('click', () => {
  localStorage.removeItem(HKEY);
  renderHistory();
  toast('已清空历史记录');
});

el.transcript.addEventListener('scroll', () => {
  const near = el.transcript.scrollTop + el.transcript.clientHeight >= el.transcript.scrollHeight - 40;
  state.follow = near || el.transcript.scrollTop < 40;
}, { passive: true });

/* 网络设置 */
el.netStatus.addEventListener('click', openSettings);
el.settingsClose.addEventListener('click', closeSettings);
el.settingsMask.addEventListener('click', closeSettings);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

el.proxySave.addEventListener('click', async () => {
  const proxy = el.proxyInput.value.trim();
  el.proxyResult.textContent = '正在测试…';
  try {
    const r = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy }),
    });
    const j = await r.json();
    el.proxyResult.textContent = j.transport
      ? `可用通路：${j.transport === 'proxy' ? j.activeProxy : '直连'}`
      : (j.transportError || '测试失败');
    refreshHealth(true);
  } catch (e) {
    el.proxyResult.textContent = '设置失败：' + e.message;
  }
});

el.proxyAuto.addEventListener('click', async () => {
  el.proxyInput.value = '';
  el.proxyResult.textContent = '正在重新探测…';
  try {
    const r = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: '' }),
    });
    const j = await r.json();
    el.proxyResult.textContent = j.transport === 'proxy' ? `自动选中：${j.activeProxy}` : '已回退到直连';
    refreshHealth(true);
  } catch (e) {
    el.proxyResult.textContent = '探测失败：' + e.message;
  }
});

/* ------------------------------ 初始化 ------------------------------ */

renderHistory();
refreshHealth();
el.urlInput.focus();

// 支持 ?v=xxxx 直接带上视频
const sp = new URLSearchParams(location.search);
if (sp.get('v')) {
  el.urlInput.value = `https://www.youtube.com/watch?v=${sp.get('v')}`;
  extract();
}
