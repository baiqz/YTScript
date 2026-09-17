'use strict';
/**
 * POST /api/proxy  { "proxy": "http://127.0.0.1:7890" }
 *
 * 运行时切换出口代理。**仅本地运行可用。**
 *
 * 安全说明：公开部署下这个接口是一个 SSRF 面 —— 任何访客都能把服务器出口
 * 指向自己控制的代理，借你的函数实例发起任意请求。因此在无服务器环境下
 * 一律拒绝，云端要换出口代理请设置环境变量 PROXY_URL 后重新部署。
 */

const config = require('../lib/config');
const { json } = require('../lib/api-respond');
const { setProxy, ensureTransport, getProxyInfo } = require('../lib/http-client');

function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return Promise.resolve(
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    );
  }
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) return req.destroy();
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, undefined);

  if (config.isServerless()) {
    return json(res, 403, {
      ok: false,
      error: '云端部署下不支持运行时修改出口代理。',
      code: 'FORBIDDEN',
      hint: '请在部署平台配置环境变量 PROXY_URL 后重新部署。',
    });
  }

  const cfg = config.load();
  if (!cfg.allowProxyConfig) {
    return json(res, 403, {
      ok: false,
      error: '当前配置禁止通过接口修改代理。',
      code: 'FORBIDDEN',
      hint: '若确需开启，请设置环境变量 ALLOW_PROXY_CONFIG=1。',
    });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: '仅支持 POST 请求', code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    setProxy(body.proxy || '');
    const transport = await ensureTransport(true);
    return json(res, 200, { ok: true, transport, ...getProxyInfo() });
  } catch (e) {
    return json(res, 400, { ok: false, error: e.message || '请求体解析失败', code: 'BAD_REQUEST' });
  }
};
