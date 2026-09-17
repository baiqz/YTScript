'use strict';
/** 通用小工具 */

/**
 * 给 Promise 加一个超时上限。
 *
 * 注意：超时只是让调用方尽早拿到失败结果，并不会中断底层请求
 * （Node 的 socket 无法从外部强制取消）。因此内部还挂着 no-op catch，
 * 避免超时后原 Promise 再 reject 变成未处理异常。
 */
function withTimeout(promise, ms, message) {
  let timer;
  const p = Promise.resolve(promise);
  p.catch(() => {});

  return Promise.race([
    p,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error(message), { code: 'TIMEOUT' })),
        Math.max(1, ms)
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
