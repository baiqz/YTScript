'use strict';
/**
 * 配置层
 *
 * 两种运行形态共用同一套代码：
 *
 *  1. 本地运行（node server.js）
 *     配置文件 config.json 可读写，代理地址会自动记住，下次启动直接命中。
 *
 *  2. 云端运行（Vercel / Netlify / Lambda 等无服务器环境）
 *     文件系统只读，config.json 不可写 —— 改为全部由环境变量驱动。
 *
 * 环境变量一览（均为可选）：
 *   PROXY_URL            出口代理，如 http://user:pass@host:port。云端若被 YouTube 风控可填此项
 *   PUBLIC_MODE          1=公开部署（默认云端为 1，本地为 0）
 *   ACCESS_CODE          设置后，接口需要 ?code=xxx 或 X-Access-Code 头才能访问
 *   ALLOW_PROXY_CONFIG   1=允许访客通过接口修改服务器出口代理（仅本地调试用，公开部署务必为 0）
 *   RATE_LIMIT_MAX       单 IP 时间窗内最大请求数（公开模式默认 20，本地默认 120）
 *   RATE_LIMIT_WINDOW_MS 限流时间窗，毫秒（默认 60000）
 *   CACHE_TTL_MS         结果缓存时长，毫秒（默认 6 小时）
 *   REQUEST_TIMEOUT_MS   首次提取（不含翻译）的超时上限，毫秒（默认 25000）
 *   TRANSLATE_TIMEOUT_MS 含翻译时的整体超时上限，毫秒（默认 55000）
 *                        YouTube 按需翻译要现场生成，实测 20~46 秒，所以单独放宽。
 *                        注意不要超过部署平台的函数时长上限：
 *                        Vercel 未开 Fluid Compute 时硬上限 60 秒，开启后为 300 秒
 *   INSECURE_TLS         1=跳过 TLS 证书校验（仅在使用中间人代理时需要）
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *                        配置后启用基于 Redis 的分布式限流（多实例共享计数）
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'config.json');

/* ---------------------------- 环境判定 ---------------------------- */

/** 是否运行在无服务器 / 云托管环境 */
function isServerless() {
  return Boolean(
    process.env.VERCEL ||
      process.env.VERCEL_ENV ||
      process.env.NETLIFY ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.CF_PAGES ||
      process.env.RENDER
  );
}

function envFlag(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 是否为公开部署模式：面向任意访客，需启用防护并关闭危险接口 */
function isPublicMode() {
  // 云端环境默认即为公开模式；本地默认关闭
  return envFlag('PUBLIC_MODE', isServerless());
}

/* ---------------------------- 文件读写 ---------------------------- */

function readFileConfig() {
  if (isServerless()) return {}; // 云端不读本地文件，避免打包进去的配置被误用
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function save(patch) {
  const next = { ...readFileConfig(), ...patch };
  if (isServerless()) return next; // 只读文件系统，静默跳过
  try {
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    /* 无写入权限时静默忽略 */
  }
  return next;
}

/* ---------------------------- 有效配置 ---------------------------- */

/**
 * 返回实际生效的配置：文件配置为底，环境变量覆盖
 */
function load() {
  const file = readFileConfig();
  return {
    ...file,

    // 出口代理：环境变量优先于本地记住的地址
    proxy: process.env.PROXY_URL || process.env.YT_PROXY || file.proxy || '',
    proxySource: process.env.PROXY_URL ? '环境变量' : file.proxySource || '',

    publicMode: isPublicMode(),
    allowProxyConfig: envFlag('ALLOW_PROXY_CONFIG', !isPublicMode()),

    accessCode: process.env.ACCESS_CODE || '',

    // 公开部署按 20 次/分钟设防；本地自己用没有设防的必要，放宽到 120
    rateLimitMax: envInt('RATE_LIMIT_MAX', isPublicMode() ? 20 : 120),
    rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000),
    cacheTtlMs: envInt('CACHE_TTL_MS', 6 * 60 * 60 * 1000),
    requestTimeoutMs: envInt('REQUEST_TIMEOUT_MS', 25_000),
    translateTimeoutMs: envInt('TRANSLATE_TIMEOUT_MS', 55_000),
    insecureTls: envFlag('INSECURE_TLS', false),

    upstashUrl: process.env.UPSTASH_REDIS_REST_URL || '',
    upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  };
}

module.exports = { load, save, isServerless, isPublicMode, FILE };
