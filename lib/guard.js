'use strict';
/**
 * 公开部署的轻量护栏
 *
 *  - 访问码校验（可选，设置 ACCESS_CODE 后生效）
 *  - IP 限流：默认使用进程内滑动窗口；配置 Upstash Redis 后改为分布式计数
 *  - 超时保护：避免单个请求拖垮函数实例
 *
 * 说明：进程内限流在无服务器环境下是「每实例」的，实例被回收或横向扩容后
 * 计数不共享。它的作用是挡住偶发刷量，不是精确的配额系统。要严格限制请
 * 配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 启用分布式计数。
 */

const crypto = require('node:crypto');
const config = require('./config');
const { request } = require('./http-client');
const { getParam } = require('./api-respond');

/* ------------------------------ 客户端标识 ------------------------------ */

/**
 * 取客户端 IP 用于限流。
 * Vercel 会覆写 x-real-ip / x-forwarded-for，不能由客户端伪造；
 * 这里优先使用平台注入的头，最后才回落到 socket 地址。
 */
function clientIp(req) {
  const h = req.headers || {};
  if (h['x-real-ip']) return String(h['x-real-ip']).trim();
  if (h['x-vercel-forwarded-for']) return String(h['x-vercel-forwarded-for']).split(',')[0].trim();
  if (h['cf-connecting-ip']) return String(h['cf-connecting-ip']).trim();
  if (h['x-forwarded-for']) return String(h['x-forwarded-for']).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* -------------------------------- 访问码 -------------------------------- */

function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** 未设置 ACCESS_CODE 时直接放行 */
function checkAccess(req, cfg) {
  if (!cfg.accessCode) return true;
  const given =
    getParam(req, 'code') ||
    (req.headers && req.headers['x-access-code']) ||
    '';
  return safeEqual(given, cfg.accessCode);
}

/* -------------------------------- 限流 -------------------------------- */

const buckets = new Map(); // ip -> number[]（请求时间戳，升序）

function memoryLimit(ip, max, windowMs) {
  const now = Date.now();
  let arr = buckets.get(ip);
  if (!arr) {
    arr = [];
    buckets.set(ip, arr);
  }
  while (arr.length && arr[0] <= now - windowMs) arr.shift();

  if (arr.length >= max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) };
  }
  arr.push(now);

  // 顺带回收过期键，避免长时间运行后 Map 无限膨胀
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) {
      if (!v.length || v[v.length - 1] <= now - windowMs) buckets.delete(k);
    }
  }
  return { ok: true, remaining: max - arr.length };
}

async function redisLimit(ip, max, windowMs, cfg) {
  const bucket = Math.floor(Date.now() / windowMs);
  const key = `yt2script:rl:${ip}:${bucket}`;
  const secs = Math.ceil(windowMs / 1000);

  const r = await request(`${cfg.upstashUrl.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.upstashToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, secs, 'NX'],
    ]),
    retries: 0,
    timeout: 4000,
  });

  const parsed = JSON.parse(r.text);
  const used = Number(parsed && parsed[0] && parsed[0].result) || 0;
  if (used > max) {
    const remainMs = (bucket + 1) * windowMs - Date.now();
    return { ok: false, retryAfter: Math.max(1, Math.ceil(remainMs / 1000)) };
  }
  return { ok: true, remaining: max - used };
}

async function checkRateLimit(ip, cfg) {
  const max = cfg.rateLimitMax;
  const windowMs = cfg.rateLimitWindowMs;

  if (cfg.upstashUrl && cfg.upstashToken) {
    try {
      return await redisLimit(ip, max, windowMs, cfg);
    } catch {
      // Redis 不可用时降级为进程内限流，保证服务不中断
      return memoryLimit(ip, max, windowMs);
    }
  }
  return memoryLimit(ip, max, windowMs);
}

/* ------------------------------ 超时保护 ------------------------------ */

const { withTimeout } = require('./util');

module.exports = { clientIp, checkAccess, checkRateLimit, withTimeout };
