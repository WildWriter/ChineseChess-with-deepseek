// One model operation at a time. Ownership belongs to the HTTP response,
// so reloading/closing a page releases its slot and aborts upstream fetches.
export function createModelRequestGate(fetchImpl) {
  let active = null;
  return {
    busy() { return Boolean(active); },
    async run(req, res, route, task) {
      if (active) throw Object.assign(new Error('另一个模型请求仍在执行，请稍后重试；刷新页面不会加快分析。'), {status:429, code:'MODEL_BUSY'});
      const controller = new AbortController(), operation = {controller};
      active = operation;
      let onAbort;
      const cancelled = new Promise((resolve, reject) => { onAbort = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', onAbort, {once:true}); });
      const timeout = route === '/api/compare' ? 290000 : route === '/api/model/test' ? 15000 : route === '/api/import/locate' ? 65000 : route === '/api/import/recognize' ? 125000 : 145000;
      const release = () => { if (active === operation) active = null; };
      const cancel = () => { if (!res.writableEnded) { controller.abort(new DOMException('页面连接已断开。', 'AbortError')); release(); } };
      const timer = setTimeout(() => { controller.abort(Object.assign(new Error('本次模型请求超时，请手动重试；局面仍保留。'), {status:504, code:'MODEL_REQUEST_TIMEOUT'})); release(); }, timeout);
      timer.unref?.();
      req.once('aborted', cancel); res.once('close', cancel);
      const requestFetch = async (url, options = {}) => {
        controller.signal.throwIfAborted();
        const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
        const response = await fetchImpl(url, {...options, signal});
        controller.signal.throwIfAborted();
        return response;
      };
      try {
        if (req.aborted || res.destroyed) cancel();
        const result = await Promise.race([cancelled, Promise.resolve().then(() => { controller.signal.throwIfAborted(); return task(requestFetch); })]);
        controller.signal.throwIfAborted();
        return result;
      } finally {
        clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); req.off('aborted', cancel); res.off('close', cancel); release();
      }
    }
  };
}
