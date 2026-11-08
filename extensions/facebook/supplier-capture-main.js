(() => {
  if (window.__rivaStockSupplierNetworkCapture) return;
  window.__rivaStockSupplierNetworkCapture = true;
  const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
  const recent = new Set();
  const originalFetch = window.fetch;
  const Xhr = window.XMLHttpRequest;
  const originalOpen = Xhr?.prototype?.open;
  const originalSend = Xhr?.prototype?.send;

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  async function readBoundedText(response) {
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      return new TextEncoder().encode(text).byteLength <= MAX_RESPONSE_BYTES ? text : null;
    }
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }

  function publish(url, contentType, body) {
    if (typeof body !== 'string' || !/json/i.test(contentType || '') || new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) return;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return; }
    if (!parsed || typeof parsed !== 'object') return;
    let resolved;
    try { resolved = new URL(url, location.href); } catch { return; }
    if (resolved.origin !== location.origin) return;
    const fingerprint = `${resolved.href}:${body.length}:${hashText(body)}`;
    if (recent.has(fingerprint)) return;
    recent.add(fingerprint);
    if (recent.size > 100) recent.delete(recent.values().next().value);
    window.postMessage({
      source: 'rivastock-supplier-capture-main',
      origin: location.origin,
      url: resolved.href,
      json: body,
    }, location.origin);
  }

  if (typeof originalFetch === 'function') {
    window.fetch = function (...args) {
      const result = Reflect.apply(originalFetch, this, args);
      result.then(async response => {
        try {
          if (response.type === 'opaque' || response.status === 204) return;
          const declaredLength = Number(response.headers.get('content-length'));
          if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) return;
          const contentType = response.headers.get('content-type') || '';
          if (!/json/i.test(contentType)) return;
          void readBoundedText(response.clone()).then(body => {
            if (body !== null) publish(response.url || args[0]?.url || args[0], contentType, body);
          }).catch(() => {});
        } catch { /* Capturing supplier JSON must never change page behavior. */ }
      }).catch(() => {});
      return result;
    };
  }

  if (Xhr?.prototype && originalOpen && originalSend) {
    Xhr.prototype.open = function (method, url, ...rest) {
      this.__rivaSupplierRequest = { method: String(method || '').toUpperCase(), url: String(url || '') };
      return Reflect.apply(originalOpen, this, [method, url, ...rest]);
    };
    Xhr.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        try {
          const contentType = this.getResponseHeader('content-type') || '';
          if (!/json/i.test(contentType)) return;
          const declaredLength = Number(this.getResponseHeader('content-length'));
          if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) return;
          const response = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
          if (typeof response !== 'string' || response.length > MAX_RESPONSE_BYTES) return;
          publish(this.responseURL || this.__rivaSupplierRequest?.url, contentType, response);
        } catch { /* Unreadable or non-text XHR responses are ignored. */ }
      }, { once: true });
      return Reflect.apply(originalSend, this, args);
    };
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin
      || event.data?.source !== 'rivastock-supplier-capture-stop' || event.data?.origin !== location.origin) return;
    if (window.fetch !== originalFetch) window.fetch = originalFetch;
    if (Xhr?.prototype?.open !== originalOpen) Xhr.prototype.open = originalOpen;
    if (Xhr?.prototype?.send !== originalSend) Xhr.prototype.send = originalSend;
    window.__rivaStockSupplierNetworkCapture = false;
  });
})();
