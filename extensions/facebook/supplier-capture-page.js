(() => {
  const extractor = globalThis.RivaStockProductExtract;
  if (!extractor || !chrome?.runtime?.id || window.__rivaStockSupplierPageReader) return;
  window.__rivaStockSupplierPageReader = true;
  const MAX_PAGES = 150;
  const MAX_PRODUCTS = 5_000;
  const BLOCKED = /^(?:agregar|a[nñ]adir|comprar|ver\s+pedido|carrito|pedido|enviar|whats?app|consultar)$/i;
  const PAGINATION = /^(?:siguiente(?:\s+p[aá]gina)?|p[aá]gina\s+siguiente|next|cargar\s+m[aá]s|ver\s+m[aá]s|mostrar\s+m[aá]s|(?:cargar|ver|mostrar)\s+m[aá]s\s+productos?(?:\s*\(\d+\))?|load\s+more)$/i;
  const ALL_CATEGORIES = /^(?:todos?|all)(?:\s*[([]?\s*\d+\s*[)\]]?)?$/i;
  const MAX_LOCAL_ACTIONS = 180;
  const MAX_LOCAL_READ_MS = 160_000;
  const SAFE_IMAGE_QUERY_KEYS = new Set(['auto', 'bg', 'c', 'crop', 'dpr', 'fit', 'fm', 'format', 'h', 'height', 'ixlib', 'q', 'quality', 's', 'scale', 'size', 'v', 'w', 'width']);
  const CARDS = '.caja_producto,div[data-id],article[data-sku],[data-sku],[data-product],[data-product-id],article.product,article.product-card,li.product,.product-card,.product-item,.wd-product,.product-grid-item,.js-item-product,.item-product,[class*="product-card"]';
  let timer = null;
  let crawlStarted = false;
  let pageFinished = false;
  let active = true;
  let actionsUsed = 0;
  const seenProductKeys = new Set();

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
    return Number(location.hash.match(/(?:^|[-_])(?:page|pagina)[-_]?(\d+)(?:$|[-_])/i)?.[1] || 0);
  }
  function currentHashPageFromUrl(value) {
    try { return Number(new URL(value).hash.match(/(?:^|[-_])(?:page|pagina)[-_]?(\d+)(?:$|[-_])/i)?.[1] || 0); }
    catch { return 0; }
  }
  function findSafeHashPage() {
    const current = currentHashPage();
    if (!current) return null;
    const targetPage = current + 1;
    const target = [...document.querySelectorAll('a[rel],a[href^="#"]')].find(anchor => {
      if (isExcluded(anchor) || anchor.closest(CARDS) || !anchor.closest('nav,[class*="pagination"],[aria-label*="pagin" i]')) return false;
      if (anchor.rel && /^\d+$/.test(anchor.rel) && anchor.rel !== String(targetPage)) return false;
      return currentHashPageFromUrl(new URL(anchor.href, location.href).href) === targetPage;
    });
    return target ? { kind: 'hash-page', page: targetPage, label: `Página ${targetPage}` } : null;
  }
  function productListSignature() {
    const cards = [...document.querySelectorAll(CARDS)];
    return `${cards.length}:${cards.map(card => card.getAttribute('data-sku') || card.getAttribute('data-id') || card.getAttribute('data-product-id') || card.querySelector('[itemprop="sku"]')?.textContent || '').join('|')}`;
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
    const hashPage = findSafeHashPage();
    if (hashPage) return hashPage;
    for (const element of document.querySelectorAll('a[rel~="next"],.pagination a,nav[aria-label*="pagin" i] a,a,button:not([type="submit"]),[role="button"],[role="tab"]')) {
      if (isExcluded(element) || element.disabled || element.getAttribute('aria-disabled') === 'true') continue;
      if (!controlVisible(element)) continue;
      const label = candidateLabel(element);
      if (BLOCKED.test(label)) continue;
      const url = element.tagName === 'A' ? safePageUrl(element.href) : null;
      const numericPage = isNextNumberedPage(element);
      const paginationArrow = /^(?:›|»)$/.test(label) && Boolean(element.closest('.pagination,[class*="pagination"],nav[aria-label*="pagin" i]'));
      if (element.rel?.toLowerCase().split(/\s+/).includes('next') || PAGINATION.test(label) || numericPage || paginationArrow) {
        if (element.tagName === 'A' && url && url !== location.href) return { kind: 'url', url, label };
        if (['BUTTON', 'A'].includes(element.tagName) && (PAGINATION.test(label) || numericPage || paginationArrow)) return { kind: 'button', label };
      }
    }
    return null;
  }
  function findSafePaginationControl(label) {
    return [...document.querySelectorAll('button:not([type="submit"]),a,[role="button"],[role="tab"]')].find(control => {
      if (isExcluded(control) || !controlVisible(control) || control.disabled || control.getAttribute('aria-disabled') === 'true') return false;
      const currentLabel = candidateLabel(control);
      if (currentLabel !== label || BLOCKED.test(currentLabel)) return false;
      if (/^(?:›|»)$/.test(currentLabel) && !control.closest('.pagination,[class*="pagination"],nav[aria-label*="pagin" i]')) return false;
      return PAGINATION.test(currentLabel) || isNextNumberedPage(control);
    }) ?? null;
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
      packPrice: Number.isFinite(item.packPrice) && item.packPrice > 0 ? item.packPrice : null,
      packCurrency: ['ARS', 'USD', 'EUR', 'GBP'].includes(item.packCurrency) ? item.packCurrency : null,
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
      for (const item of items) seenProductKeys.add(item.key);
      await chrome.runtime.sendMessage({
        type: 'supplier-capture-evidence', url: location.href, items,
        source: result.source.slice(0, 3), warnings: result.warnings.slice(0, 6),
        categoryUrls: collectCategoryUrls(), productCount: items.length, reportedTotal: result.reportedTotal,
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
  function controlVisible(node) {
    if (!node || node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    const style = document.defaultView?.getComputedStyle?.(node);
    return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.opacity !== '0';
  }
  function getCategoryGroup() {
    const controls = [...document.querySelectorAll('button:not([type="submit"]),[role="button"],[role="tab"]')]
      .filter(control => !isExcluded(control) && !control.disabled && controlVisible(control) && !BLOCKED.test(candidateLabel(control)));
    for (const all of controls.filter(control => ALL_CATEGORIES.test(candidateLabel(control)))) {
      for (let parent = all.parentElement, depth = 0; parent && depth < 3; parent = parent.parentElement, depth += 1) {
        const members = controls.filter(control => parent.contains(control));
        const options = members.filter(control => !ALL_CATEGORIES.test(candidateLabel(control)) && candidateLabel(control).length <= 60 && !PAGINATION.test(candidateLabel(control)));
        if (options.length && members.length >= 2) return { all, options: options.slice(0, 80) };
      }
    }
    return null;
  }
  async function claimAction() {
    if (actionsUsed >= MAX_LOCAL_ACTIONS || Date.now() - readerStartedAt >= MAX_LOCAL_READ_MS) return false;
    const response = await chrome.runtime.sendMessage({ type: 'supplier-capture-action' }).catch(() => null);
    if (response?.allowed !== true) return false;
    actionsUsed += 1;
    return true;
  }
  async function clickCategory(control) {
    if (!control || isExcluded(control) || !controlVisible(control) || BLOCKED.test(candidateLabel(control)) || !await claimAction()) return false;
    const before = productListSignature();
    control.click();
    await waitForProductListChange(before, 8_000);
    await delay(450);
    await sendEvidence();
    return true;
  }
  async function scrollAndReadVisibleProducts() {
    let unchangedAtBottom = 0;
    for (let step = 0; step < 300 && active && Date.now() - readerStartedAt < MAX_LOCAL_READ_MS; step += 1) {
      window.scrollBy({ top: Math.max(720, Math.floor(window.innerHeight * 2)), left: 0, behavior: 'instant' });
      await delay(180);
      const afterHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
      const atBottom = window.scrollY + window.innerHeight >= afterHeight - 4;
      if (atBottom) unchangedAtBottom += 1;
      else unchangedAtBottom = 0;
      if (!atBottom) continue;
      const next = findSafeNext();
      if (next?.kind === 'button') {
        const target = findSafePaginationControl(next.label);
        if (!target || !await claimAction()) return null;
        const before = productListSignature();
        target.click();
        const changed = await waitForProductListChange(before, 12_000);
        await delay(500);
        await sendEvidence();
        if (changed) {
          unchangedAtBottom = 0;
          step = -1;
          continue;
        }
        return null;
      }
      if (next) return next;
      if (unchangedAtBottom >= 3) break;
      await delay(250);
    }
    await sendEvidence();
    return null;
  }
  const readerStartedAt = Date.now();
  async function autoReadPage() {
    let categoryWakeAttempted = false;
    let categoriesTraversed = false;
    while (active && Date.now() - readerStartedAt < MAX_LOCAL_READ_MS) {
      const next = await scrollAndReadVisibleProducts();
      if (next) { await sendEvidence(); finishPage({ next, actionsUsed }); return; }
      const current = extractor.readPage(document);
      const total = Number.isSafeInteger(current.reportedTotal) ? current.reportedTotal : null;
      const missing = total !== null && seenProductKeys.size < total;
      const group = missing ? getCategoryGroup() : null;
      if (group && !categoryWakeAttempted) {
        categoryWakeAttempted = true;
        const firstCategory = group.options[0];
        if (await clickCategory(firstCategory)) {
          const refreshed = getCategoryGroup();
          if (refreshed) await clickCategory(refreshed.all);
          window.scrollTo({ top: 0, behavior: 'instant' });
          continue;
        }
      }
      if (group && categoryWakeAttempted && !categoriesTraversed && seenProductKeys.size < total) {
        categoriesTraversed = true;
        const labels = group.options.map(candidateLabel);
        for (const label of labels) {
          if (Date.now() - readerStartedAt >= MAX_LOCAL_READ_MS || seenProductKeys.size >= total) break;
          const currentGroup = getCategoryGroup();
          const option = currentGroup?.options.find(control => candidateLabel(control) === label);
          if (option && await clickCategory(option)) {
            window.scrollTo({ top: 0, behavior: 'instant' });
            const categoryNext = await scrollAndReadVisibleProducts();
            if (categoryNext && categoryNext.kind !== 'button') { finishPage({ next: categoryNext }); return; }
            await sendEvidence();
          }
        }
        const currentGroup = getCategoryGroup();
        if (currentGroup) await clickCategory(currentGroup.all);
        window.scrollTo({ top: 0, behavior: 'instant' });
        continue;
      }
      break;
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
        ? [...document.querySelectorAll('a[rel],a[href^="#"]')].find(anchor => {
          if (isExcluded(anchor) || anchor.closest(CARDS) || !anchor.closest('nav,[class*="pagination"],[aria-label*="pagin" i]')) return false;
          if (anchor.rel && /^\d+$/.test(anchor.rel) && anchor.rel !== String(expected)) return false;
          return currentHashPageFromUrl(new URL(anchor.href, location.href).href) === expected;
        })
        : null;
      if (!target) { reply({ done: false }); return; }
      const before = productListSignature();
      const changed = waitForProductListChange(before);
      target.click();
      void changed.then(async done => {
        reply({ done });
        if (done && active) {
          pageFinished = false;
          await sendEvidence();
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
