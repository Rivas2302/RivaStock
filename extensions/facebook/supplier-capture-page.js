(() => {
  const extractor = globalThis.RivaStockProductExtract;
  if (!extractor || !chrome?.runtime?.id || window.__rivaStockSupplierPageReader) return;
  window.__rivaStockSupplierPageReader = true;
  const MAX_PAGES = 150;
  const MAX_PRODUCTS = 5_000;
  const BLOCKED = /^(?:agregar|a[nñ]adir|comprar|ver\s+pedido|carrito|pedido|enviar|whats?app|consultar)$/i;
  const PAGINATION = /^(?:siguiente(?:\s+p[aá]gina)?|p[aá]gina\s+siguiente|next|›|»|cargar\s+m[aá]s|ver\s+m[aá]s|load\s+more)$/i;
  const SAFE_IMAGE_QUERY_KEYS = new Set(['auto', 'bg', 'c', 'crop', 'dpr', 'fit', 'fm', 'format', 'h', 'height', 'ixlib', 'q', 'quality', 's', 'scale', 'size', 'v', 'w', 'width']);
  const CARDS = '.caja_producto,div.item.open_detail[data-id],[data-product],[data-product-id],article.product,article.product-card,li.product,.product-card,.product-item,.wd-product,.product-grid-item,.js-item-product,.item-product,[class*="product-card"]';
  let timer = null;
  let crawlStarted = false;
  let pageFinished = false;
  let active = true;

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function isExcluded(node) {
    return !node || Boolean(node.closest(`form,${CARDS},.carousel-control,[data-slide],.swiper-button-next,.swiper-button-prev,[aria-label*="slide" i]`));
  }
  function safePageUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin || url.username || url.password) return null;
      if ([...url.searchParams.keys()].some(key => /(?:auth|token|session|cookie|password|credential|secret|api[_-]?key)/i.test(key))) return null;
      url.hash = '';
      return url.href;
    } catch { return null; }
  }
  function candidateLabel(element) {
    return String(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  function isNextNumberedPage(element) {
    if (!element.closest('.pagination,[class*="pagination"],nav[aria-label*="pagin" i]')) return false;
    const current = document.querySelector('[aria-current="page"],.catalog-pagination-numero.actual,.pagination .current,[class*="pagination"] .current');
    const currentLabel = String(current?.getAttribute('aria-label') || current?.textContent || '').trim();
    const currentNumber = Number(currentLabel.match(/(?:p[aá]gina\s+)?(\d{1,4})/i)?.[1]);
    const candidateNumber = Number(candidateLabel(element).match(/^p[aá]gina\s+(\d{1,4})$/i)?.[1]
      ?? candidateLabel(element).match(/^(\d{1,4})$/)?.[1]);
    return Number.isSafeInteger(currentNumber) && currentNumber > 0 && candidateNumber === currentNumber + 1;
  }
  function currentHashPage() {
    return Number(location.hash.match(/^#productos_page-(\d+)$/i)?.[1] || 0);
  }
  function findSafeMayoriHashPage() {
    const current = currentHashPage();
    if (!current) return null;
    const targetPage = current + 1;
    const target = [...document.querySelectorAll('.ui.pagination.menu a.item[rel]')].find(anchor => {
      if (isExcluded(anchor) || anchor.closest(CARDS) || anchor.rel !== String(targetPage)) return false;
      return anchor.getAttribute('href') === `#productos_page-${targetPage}`;
    });
    return target ? { kind: 'hash-page', page: targetPage, label: `Página ${targetPage}` } : null;
  }
  function productListSignature() {
    const cards = [...document.querySelectorAll(CARDS)];
    return `${cards.length}:${cards.map(card => card.getAttribute('data-id') || '').join('|')}`;
  }
  function waitForProductListChange(previous, timeoutMs = 15_000) {
    return new Promise(resolve => {
      let settled = false;
      const finish = changed => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(changed);
      };
      const observer = new MutationObserver(() => {
        if (productListSignature() !== previous) finish(true);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-id'] });
      const timer = setTimeout(() => finish(productListSignature() !== previous), timeoutMs);
      if (productListSignature() !== previous) finish(true);
    });
  }
  function findSafeNext() {
    const hashPage = findSafeMayoriHashPage();
    if (hashPage) return hashPage;
    for (const element of document.querySelectorAll('a[rel~="next"],.pagination a,nav[aria-label*="pagin" i] a,a,button[type="button"]')) {
      if (isExcluded(element) || element.disabled || element.getAttribute('aria-disabled') === 'true') continue;
      const label = candidateLabel(element);
      if (BLOCKED.test(label)) continue;
      const url = element.tagName === 'A' ? safePageUrl(element.href) : null;
      const numericPage = isNextNumberedPage(element);
      if (element.rel?.toLowerCase().split(/\s+/).includes('next') || PAGINATION.test(label) || numericPage) {
        if (element.tagName === 'A' && url && url !== location.href) return { kind: 'url', url, label };
        if (element.tagName === 'BUTTON' && (PAGINATION.test(label) || numericPage)) return { kind: 'button', label };
      }
    }
    return null;
  }
  function collectCategoryUrls() {
    const current = new URL(location.href);
    const allowed = new Set(['rub', 'cat', 'categoria', 'page', 'pagina']);
    const results = new Set();
    for (const anchor of document.querySelectorAll('a[href]')) {
      if (isExcluded(anchor)) continue;
      const url = safePageUrl(anchor.href);
      if (!url) continue;
      const candidate = new URL(url);
      if (candidate.pathname !== current.pathname || candidate.href === current.href) continue;
      const keys = new Set([...current.searchParams.keys(), ...candidate.searchParams.keys()]);
      const changed = [...keys].filter(key => current.searchParams.getAll(key).join('\u0000') !== candidate.searchParams.getAll(key).join('\u0000'));
      if (changed.length !== 1 || !allowed.has(changed[0])) continue;
      if ([...keys].some(key => !allowed.has(key) && current.searchParams.getAll(key).join('\u0000') !== candidate.searchParams.getAll(key).join('\u0000'))) continue;
      results.add(candidate.href);
    }
    return [...results].slice(0, MAX_PAGES);
  }
  function sanitizeItem(item) {
    return {
      key: String(item.key || '').slice(0, 260), code: typeof item.code === 'string' ? item.code.slice(0, 100) : null,
      altCode: typeof item.altCode === 'string' ? item.altCode.slice(0, 100) : null,
      name: String(item.name || '').slice(0, 200), price: Number.isFinite(item.price) && item.price > 0 ? item.price : null,
      listPrice: Number.isFinite(item.listPrice) && item.listPrice > 0 ? item.listPrice : null,
      currency: item.currency === 'USD' || item.currency === 'EUR' || item.currency === 'GBP' ? item.currency : 'ARS',
      category: typeof item.category === 'string' ? item.category.slice(0, 120) : null,
      brand: typeof item.brand === 'string' ? item.brand.slice(0, 100) : null,
      imageUrl: safeImageUrl(item.imageUrl), images: [...new Set((Array.isArray(item.images) ? item.images : []).map(safeImageUrl).filter(Boolean))].slice(0, 5),
      url: safePageUrl(item.url || location.href), packSize: Number.isFinite(item.packSize) && item.packSize > 0 ? item.packSize : null,
      notes: Array.isArray(item.notes) ? item.notes.map(note => String(note).slice(0, 80)).slice(0, 3) : [],
      needsPriceReview: item.needsPriceReview === true,
      priceOptions: Array.isArray(item.priceOptions) ? item.priceOptions.slice(0, 4).map(option => ({ label: String(option.label).slice(0, 20), price: Number(option.price) })).filter(option => Number.isFinite(option.price) && option.price > 0) : null,
    };
  }
  function safeImageUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== 'https:' || url.username || url.password
        || [...url.searchParams.keys()].some(key => !SAFE_IMAGE_QUERY_KEYS.has(key.toLowerCase()))) return null;
      url.hash = '';
      return url.href.slice(0, 2048);
    }
    catch { return null; }
  }
  async function sendEvidence(jsonResponses = []) {
    if (!active) return;
    try {
      const result = extractor.readPage(document, jsonResponses);
      const items = result.items.slice(0, MAX_PRODUCTS).map(sanitizeItem).filter(item => item.name);
      await chrome.runtime.sendMessage({
        type: 'supplier-capture-evidence', url: location.href, items,
        source: result.source.slice(0, 3), warnings: result.warnings.slice(0, 6),
        categoryUrls: collectCategoryUrls(), productCount: items.length,
      });
    } catch { /* An unsupported page must not disturb the supplier site. */ }
  }
  function scheduleEvidence() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void sendEvidence(); }, 300);
  }
  function onPageMessage(event) {
    if (!active || event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'rivastock-supplier-capture-main' || data.origin !== location.origin || typeof data.json !== 'string') return;
    void sendEvidence([data.json]);
  }
  function begin() {
    void sendEvidence();
    if (crawlStarted) return;
    crawlStarted = true;
    void autoReadPage();
  }
  async function autoReadPage() {
    let unchangedAtBottom = 0;
    for (let step = 0; step < 180 && active; step += 1) {
      window.scrollBy({ top: Math.max(360, Math.floor(window.innerHeight * 0.8)), left: 0, behavior: 'instant' });
      await delay(350);
      const afterHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
      const atBottom = window.scrollY + window.innerHeight >= afterHeight - 4;
      if (atBottom) unchangedAtBottom += 1;
      else unchangedAtBottom = 0;
      if (!atBottom) continue;
      const next = findSafeNext();
      if (next) { finishPage({ next }); return; }
      if (unchangedAtBottom >= 3) break;
      await delay(350);
    }
    await sendEvidence();
    finishPage({ categoryUrls: collectCategoryUrls() });
  }
  function finishPage(navigation) {
    if (!active || pageFinished) return;
    pageFinished = true;
    void chrome.runtime.sendMessage({ type: 'supplier-capture-page-finished', url: location.href, navigation });
  }

  window.addEventListener('message', onPageMessage);
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'supplier-capture-stop') {
      active = false;
      if (timer) clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('message', onPageMessage);
      window.postMessage({ source: 'rivastock-supplier-capture-stop', origin: location.origin }, location.origin);
      reply({ stopped: true });
      return;
    }
    if (!active) return;
    if (message?.type === 'supplier-capture-click-next') {
      const next = findSafeNext();
      if (!next || next.kind !== 'button' || next.label !== message.label) { reply({ done: false }); return; }
      // Revalidate the exact, allowlisted pagination control immediately before clicking.
      const target = [...document.querySelectorAll('button[type="button"]')].find(button => !isExcluded(button)
        && candidateLabel(button) === message.label && !BLOCKED.test(candidateLabel(button))
        && (PAGINATION.test(candidateLabel(button)) || isNextNumberedPage(button)));
      if (!target) { reply({ done: false }); return; }
      pageFinished = false;
      target.click();
      setTimeout(() => { void autoReadPage(); }, 700);
      reply({ done: true });
      return;
    }
    if (message?.type === 'supplier-capture-click-hash-page') {
      const page = Number(message.page);
      const current = currentHashPage();
      const expected = current + 1;
      const target = Number.isSafeInteger(page) && page === expected
        ? [...document.querySelectorAll('.ui.pagination.menu a.item[rel]')].find(anchor =>
          !isExcluded(anchor) && !anchor.closest(CARDS) && anchor.rel === String(expected)
          && anchor.getAttribute('href') === `#productos_page-${expected}`)
        : null;
      if (!target) { reply({ done: false }); return; }
      const before = productListSignature();
      const changed = waitForProductListChange(before);
      target.click();
      void changed.then(done => {
        reply({ done });
        if (done && active) {
          pageFinished = false;
          void autoReadPage();
        }
      });
      return true;
    }
    if (message?.type === 'supplier-capture-resume-read') { pageFinished = false; void autoReadPage(); reply({ done: true }); }
  });
  const observer = new MutationObserver(scheduleEvidence);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src', 'srcset'] });
  document.addEventListener('DOMContentLoaded', begin, { once: true });
  if (document.readyState !== 'loading') begin();
})();
