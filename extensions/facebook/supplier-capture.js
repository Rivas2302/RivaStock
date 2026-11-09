import { getSupplierSiteDomain, isSameSupplierSiteDomain } from './supplier-site-domain.js';

const LIVE_KEY = 'supplierCaptureLive';
const CAPTURES_KEY = 'supplierProductCaptures';
const APP_URL = 'https://rivastock.vercel.app/revendedores';
const MAX_PRODUCTS = 5_000;
const PAGE_LIMIT = 150;
const CAPTURE_TTL = 24 * 60 * 60 * 1000;
const CHUNK_SIZE = 500;
const MAIN_SCRIPT_ID = 'rivastock-supplier-main';
const PAGE_SCRIPT_ID = 'rivastock-supplier-page';
const PRODUCT_CARD_PATHS = new Set(['rub', 'cat', 'categoria', 'page', 'pagina']);
const SAFE_PAGINATION_LABEL = /^(?:siguiente(?:\s+p[aá]gina)?|p[aá]gina\s+siguiente|p[aá]gina\s+\d{1,4}|next|›|»|cargar\s+m[aá]s|ver\s+m[aá]s|load\s+more)$/i;
const SAFE_IMAGE_QUERY_KEYS = new Set(['auto', 'bg', 'c', 'crop', 'dpr', 'fit', 'fm', 'format', 'h', 'height', 'ixlib', 'q', 'quality', 's', 'scale', 'size', 'v', 'w', 'width']);

function isUnsafePublicHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host.includes(':') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function safeOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase();
    if (isUnsafePublicHost(host)
      || host === 'rivastock.vercel.app' || host === 'facebook.com' || host.endsWith('.facebook.com')
      || /(?:bank|banco|bancaria|homebanking|bbva|santander|galicia|macro|icbc|brubank|hsbc|itau|supervielle|nacion|provincia)/i.test(host)) return null;
    return url.origin;
  } catch { return null; }
}

function safeHttps(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || [...url.searchParams.keys()].some(key => !SAFE_IMAGE_QUERY_KEYS.has(key.toLowerCase()))
      || isUnsafePublicHost(url.hostname)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function safePageUrl(value, origin) {
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password
      || [...url.searchParams.keys()].some(key => !['page', 'pagina', 'rub', 'cat', 'categoria'].includes(key.toLocaleLowerCase('en-US')))) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function imageOriginsForSupplier(origin) {
  try {
    const domain = getSupplierSiteDomain(origin);
    return domain ? [`https://*.${domain}/*`] : [];
  } catch { return []; }
}

function isAllowedCaptureImage(origin, imageUrl) {
  try {
    const sourceUrl = new URL(origin);
    const candidate = new URL(imageUrl);
    return candidate.protocol === 'https:' && !candidate.username && !candidate.password
      && isSameSupplierSiteDomain(sourceUrl.href, candidate.href);
  } catch { return false; }
}

function normalizeItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim().replace(/\s+/g, ' ').slice(0, 200) : '';
  if (!name) return null;
  const code = typeof value.code === 'string' ? value.code.trim().slice(0, 100) || null : null;
  const price = Number.isFinite(value.price) && value.price > 0 ? Math.round(value.price * 100) / 100 : null;
  const images = [...new Set((Array.isArray(value.images) ? value.images : []).map(safeHttps).filter(Boolean))].slice(0, 5);
  const imageUrl = safeHttps(value.imageUrl) ?? images[0] ?? null;
  const currency = ['ARS', 'USD', 'EUR', 'GBP'].includes(value.currency) ? value.currency : 'ARS';
  const category = typeof value.category === 'string' ? value.category.trim().slice(0, 120) || null : null;
  const key = code ? `code:${code.toLocaleUpperCase('es-AR')}` : `name:${name.toLocaleLowerCase('es-AR')}|${price ?? 'no-price'}`;
    return {
    key, code, altCode: typeof value.altCode === 'string' ? value.altCode.slice(0, 100) : null,
    name, price, listPrice: Number.isFinite(value.listPrice) && value.listPrice > 0 ? value.listPrice : null,
    currency, category, imageUrl, images,
    brand: typeof value.brand === 'string' ? value.brand.trim().replace(/\s+/g, ' ').slice(0, 100) || null : null,
    packSize: Number.isFinite(value.packSize) && value.packSize > 0 ? Math.floor(value.packSize) : null,
    notes: Array.isArray(value.notes) ? value.notes.map(note => String(note).slice(0, 80)).slice(0, 3) : [],
    needsPriceReview: value.needsPriceReview === true || price === null,
    priceOptions: Array.isArray(value.priceOptions) ? value.priceOptions.slice(0, 4).map(option => ({
      label: String(option?.label ?? '').slice(0, 20), price: Number(option?.price),
    })).filter(option => Number.isFinite(option.price) && option.price > 0) : null,
  };
}

function itemScore(item) {
  return (item.name ? 4 : 0) + (item.price ? 4 : 0) + (item.imageUrl ? 3 : 0) + (item.code ? 2 : 0) + (item.category ? 1 : 0) + (item.brand ? 1 : 0);
}

function mergeItems(previous, incoming) {
  const rows = new Map((Array.isArray(previous) ? previous : []).map(item => [item.key, item]));
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const item = normalizeItem(raw);
    if (!item) continue;
    const existing = rows.get(item.key);
    if (!existing || itemScore(item) > itemScore(existing)) rows.set(item.key, item);
    if (rows.size >= MAX_PRODUCTS) break;
  }
  return [...rows.values()].slice(0, MAX_PRODUCTS);
}

function validateCategoryUrl(value, currentValue) {
  try {
    const current = new URL(currentValue);
    const candidate = new URL(value);
    if (candidate.origin !== current.origin || candidate.pathname !== current.pathname || candidate.href === current.href) return null;
    if ([...candidate.searchParams.keys()].some(key => /(?:auth|token|session|cookie|password|credential|secret|api[_-]?key)/i.test(key))) return null;
    const keys = new Set([...current.searchParams.keys(), ...candidate.searchParams.keys()]);
    const changed = [...keys].filter(key => current.searchParams.getAll(key).join('\u0000') !== candidate.searchParams.getAll(key).join('\u0000'));
    if (changed.length !== 1 || !PRODUCT_CARD_PATHS.has(changed[0])) return null;
    if ([...keys].some(key => !PRODUCT_CARD_PATHS.has(key) && current.searchParams.getAll(key).join('\u0000') !== candidate.searchParams.getAll(key).join('\u0000'))) return null;
    return candidate.href;
  } catch { return null; }
}

export function createSupplierCaptureController(api = chrome) {
  const hasSession = Boolean(api.storage.session);
  async function readLive() {
    const result = hasSession ? await api.storage.session.get(LIVE_KEY) : await api.storage.local.get(LIVE_KEY);
    return result[LIVE_KEY] ?? null;
  }
  async function writeLive(value) {
    if (hasSession) await api.storage.session.set({ [LIVE_KEY]: value });
    else await api.storage.local.set({ [LIVE_KEY]: value });
    await api.action.setBadgeText({ text: value ? String(Math.min(value.items?.length ?? 0, 999)) : '' });
    if (value) await api.action.setBadgeBackgroundColor({ color: '#527ce5' });
  }
  async function unregisterScripts() {
    await api.scripting.unregisterContentScripts({ ids: [MAIN_SCRIPT_ID, PAGE_SCRIPT_ID] }).catch(() => {});
  }
  async function stopScripts(tabId) {
    await unregisterScripts();
    if (Number.isSafeInteger(tabId)) {
      await api.tabs.sendMessage(tabId, { type: 'supplier-capture-stop' }).catch(() => {});
    }
  }
  async function registerScripts(origin) {
    await unregisterScripts();
    const match = `${origin}/*`;
    await api.scripting.registerContentScripts([
      { id: MAIN_SCRIPT_ID, matches: [match], js: ['supplier-capture-main.js'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: false },
      { id: PAGE_SCRIPT_ID, matches: [match], js: ['shared/product-extract.js', 'supplier-capture-page.js'], runAt: 'document_start', persistAcrossSessions: false },
    ]);
  }
  async function clearExpiredCaptures() {
    const stored = await api.storage.local.get(CAPTURES_KEY);
    const captures = stored[CAPTURES_KEY] && typeof stored[CAPTURES_KEY] === 'object' ? stored[CAPTURES_KEY] : {};
    const now = Date.now();
    for (const [id, capture] of Object.entries(captures)) if (!capture || capture.expiresAt <= now) delete captures[id];
    await api.storage.local.set({ [CAPTURES_KEY]: captures });
    return captures;
  }
  async function start(tabId, requestedOrigin) {
    const origin = safeOrigin(requestedOrigin);
    if (!origin || !Number.isSafeInteger(tabId)) throw new Error('Abrí una tienda de productos para empezar la lectura.');
    const tab = await api.tabs.get(tabId);
    let tabOrigin = null;
    try { tabOrigin = new URL(tab.url).origin; } catch { /* Browser-owned tabs are not supplier pages. */ }
    if (tabOrigin !== origin) throw new Error('La pestaña activa cambió. Volvé a la tienda e intentá de nuevo.');
    const imageOrigins = imageOriginsForSupplier(origin);
    if (!await api.permissions.contains({ origins: [`${origin}/*`, ...imageOrigins] })) throw new Error('Chrome todavía no dio permiso para leer esta tienda y sus fotos.');
    const current = await readLive();
    if (current?.status === 'reading' && current.tabId !== tabId) throw new Error('Ya hay una lectura en curso en otra pestaña.');
    await registerScripts(origin);
    const state = {
      tabId, origin, startedAt: Date.now(), status: 'reading', items: [], source: [], warnings: [],
      pageStartingProductCount: 0, stagnantPages: 0,
      pagesVisited: [], categoryUrls: [], readAllCategories: false, lastPageUrl: tab.url,
    };
    await writeLive(state);
    await api.tabs.reload(tabId);
    return { started: true, origin };
  }
  async function cancel(tabId) {
    const state = await readLive();
    if (!state || (Number.isSafeInteger(tabId) && state.tabId !== tabId)) return { cancelled: true };
    await stopScripts(state.tabId);
    await writeLive(null);
    return { cancelled: true };
  }
  async function beginAllCategories(tabId) {
    const state = await readLive();
    if (!state || state.tabId !== tabId || !state.categoryUrls.length) throw new Error('No encontramos categorías para recorrer.');
    state.readAllCategories = true;
    state.status = 'reading';
    await writeLive(state);
    await navigateNext(state, null);
    return { readingAllCategories: true };
  }
  async function navigateNext(state, pagination) {
    if (state.pagesVisited.length >= PAGE_LIMIT) {
      state.status = 'complete';
      await writeLive(state);
      return;
    }
    const nextUrl = pagination?.kind === 'url' ? pagination.url : null;
    if (nextUrl) {
      const safe = safePageUrl(nextUrl, state.origin);
      if (safe && !state.pagesVisited.includes(safe)) {
        state.pagesVisited.push(safe);
        state.lastPageUrl = safe;
        state.pageStartingProductCount = state.items.length;
        await writeLive(state);
        await api.tabs.update(state.tabId, { url: safe });
        return;
      }
    }
    if (pagination?.kind === 'hash-page' && Number.isSafeInteger(pagination.page)) {
      let currentPage = 0;
      try {
        const current = new URL(state.lastPageUrl);
        currentPage = Number(current.hash.match(/^#productos_page-(\d+)$/i)?.[1] || 0);
      } catch { /* Non-hash pages use the existing pagination paths. */ }
      if (currentPage > 0 && pagination.page === currentPage + 1 && pagination.page <= PAGE_LIMIT) {
        state.pageStartingProductCount = state.items.length;
        await writeLive(state);
        const result = await api.tabs.sendMessage(state.tabId, {
          type: 'supplier-capture-click-hash-page', page: pagination.page,
        }).catch(() => null);
        if (result?.done) return;
      }
    }
    if (pagination?.kind === 'button' && typeof pagination.label === 'string' && pagination.label.length <= 80 && SAFE_PAGINATION_LABEL.test(pagination.label)) {
      state.pageStartingProductCount = state.items.length;
      await writeLive(state);
      const result = await api.tabs.sendMessage(state.tabId, { type: 'supplier-capture-click-next', label: pagination.label }).catch(() => null);
      if (result?.done) return;
    }
    if (state.readAllCategories) {
      const candidate = state.categoryUrls.find(url => !state.pagesVisited.includes(url));
      if (candidate && validateCategoryUrl(candidate, state.lastPageUrl)) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        state.pagesVisited.push(candidate);
        state.lastPageUrl = candidate;
        state.pageStartingProductCount = state.items.length;
        await writeLive(state);
        await api.tabs.update(state.tabId, { url: candidate });
        return;
      }
    }
    state.status = !state.readAllCategories && state.categoryUrls.some(url => !state.pagesVisited.includes(url)) ? 'categories-available' : 'complete';
    await writeLive(state);
    if (state.status === 'complete') await stopScripts(state.tabId);
  }
  async function handleEvidence(message, sender) {
    const state = await readLive();
    if (!state || state.status !== 'reading' || sender.tab?.id !== state.tabId) return;
    let url;
    try {
      url = new URL(typeof message.url === 'string' ? message.url : sender.url);
      if (sender.url && new URL(sender.url).origin !== state.origin) return;
    } catch { return; }
    if (url.origin !== state.origin) return;
    state.lastPageUrl = url.href;
    state.items = mergeItems(state.items, message.items);
    state.source = [...new Set([...state.source, ...(Array.isArray(message.source) ? message.source.filter(item => ['network-json', 'structured-data', 'dom-cards'].includes(item)) : [])])].slice(0, 3);
    const safeWarnings = [
      'No encontramos productos en esta página. Si requiere clave o JavaScript, iniciá sesión en el proveedor y volvé a leer desde su página.',
      'Hay productos sin precio; quedaron marcados para revisar y no se importan como costo cero.',
      'Hay precios superiores a $5.000.000 o que necesitan revisión.',
      'La página muestra precios mayoristas y minoristas; revisá cuál corresponde antes de continuar.',
    ];
    state.warnings = [...new Set([...state.warnings, ...(Array.isArray(message.warnings) ? message.warnings.filter(item => safeWarnings.includes(item)) : [])])].slice(0, 8);
    if (Array.isArray(message.categoryUrls)) {
      const valid = message.categoryUrls.map(value => validateCategoryUrl(value, url.href)).filter(Boolean);
      state.categoryUrls = [...new Set([...state.categoryUrls, ...valid])].slice(0, PAGE_LIMIT);
    }
    await writeLive(state);
  }
  async function handlePageFinished(message, sender) {
    const state = await readLive();
    if (!state || state.status !== 'reading' || sender.tab?.id !== state.tabId) return;
    let url;
    try {
      url = new URL(typeof message.url === 'string' ? message.url : sender.url);
      if (sender.url && new URL(sender.url).origin !== state.origin) return;
    } catch { return; }
    if (url.origin !== state.origin) return;
    state.lastPageUrl = url.href;
    if (!state.pagesVisited.includes(url.href)) state.pagesVisited.push(url.href);
    state.stagnantPages = state.items.length <= state.pageStartingProductCount ? state.stagnantPages + 1 : 0;
    state.pageStartingProductCount = state.items.length;
    await writeLive(state);
    if (state.stagnantPages >= 3) {
      state.status = 'complete';
      await writeLive(state);
      await stopScripts(state.tabId);
      return;
    }
    await navigateNext(state, message.navigation?.next);
  }
  async function finish(tabId) {
    const state = await readLive();
    if (!state || state.tabId !== tabId || !state.items.length) throw new Error('Todavía no encontramos productos para llevar a RivaStock.');
    const captures = await clearExpiredCaptures();
    const captureId = api.crypto?.randomUUID?.() ?? crypto.randomUUID();
    captures[captureId] = {
      origin: state.origin, capturedAt: new Date().toISOString(), expiresAt: Date.now() + CAPTURE_TTL,
      source: state.source, warnings: state.warnings, items: state.items.slice(0, MAX_PRODUCTS),
    };
    await api.storage.local.set({ [CAPTURES_KEY]: captures });
    await stopScripts(state.tabId);
    await writeLive(null);
    await api.tabs.create({ url: `${APP_URL}?importar=extension&captura=${encodeURIComponent(captureId)}`, active: true });
    return { done: true, count: state.items.length };
  }
  async function readCapture(captureId, offset = 0) {
    if (typeof captureId !== 'string' || !/^[0-9a-f-]{36}$/i.test(captureId) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('La captura no es válida.');
    const captures = await clearExpiredCaptures();
    const capture = captures[captureId];
    if (!capture) throw new Error('La captura venció o ya fue recibida. Volvé a la tienda para leerla otra vez.');
    const items = capture.items.slice(offset, offset + CHUNK_SIZE);
    return { captureId, offset, nextOffset: offset + items.length, total: capture.items.length, done: offset + items.length >= capture.items.length, items, source: capture.source, warnings: capture.warnings, origin: capture.origin, capturedAt: capture.capturedAt };
  }
  async function acknowledgeCapture(captureId) {
    const captures = await clearExpiredCaptures();
    if (typeof captureId === 'string') delete captures[captureId];
    await api.storage.local.set({ [CAPTURES_KEY]: captures });
    return { received: true };
  }
  async function readCaptureImage(captureId, rawImageUrl) {
    if (typeof captureId !== 'string' || !/^[0-9a-f-]{36}$/i.test(captureId)) throw new Error('La captura no es válida.');
    const captures = await clearExpiredCaptures();
    const capture = captures[captureId];
    if (!capture) throw new Error('La captura venció o ya fue recibida. Volvé a leer la tienda.');
    const imageUrl = safeHttps(rawImageUrl);
    if (!imageUrl || !isAllowedCaptureImage(capture.origin, imageUrl)) throw new Error('La foto no pertenece al sitio leído.');
    if (!capture.items.some(item => item.imageUrl === imageUrl || item.images?.includes(imageUrl))) {
      throw new Error('La foto no pertenece a un producto de la captura.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(imageUrl, {
        credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      if (!response.ok) throw new Error('La foto no está disponible sin sesión.');
      const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error('El formato de la foto no está permitido.');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No se pudo leer la foto.');
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 400 * 1024) {
            await reader.cancel();
            throw new Error('La foto supera 400 KB.');
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { mimeType, base64: btoa(binary), size };
    } finally { clearTimeout(timer); }
  }
  function registerInternalMessages() {
    api.runtime.onMessage.addListener((message, sender, reply) => {
      const isOwnPage = sender.id === api.runtime.id && sender.url === api.runtime.getURL('connect.html');
      if (isOwnPage && message?.type === 'supplier-capture-state') {
        void readLive().then(state => reply({ state: Number.isSafeInteger(message.tabId) ? (state?.tabId === message.tabId ? state : null) : state }));
        return true;
      }
      if (isOwnPage && message?.type === 'supplier-capture-start') {
        void start(message.tabId, message.origin).then(reply).catch(error => reply({ error: error.message }));
        return true;
      }
      if (isOwnPage && message?.type === 'supplier-capture-finish') {
        void finish(message.tabId).then(reply).catch(error => reply({ error: error.message }));
        return true;
      }
      if (isOwnPage && message?.type === 'supplier-capture-cancel') {
        void cancel(message.tabId).then(reply).catch(error => reply({ error: error.message }));
        return true;
      }
      if (isOwnPage && message?.type === 'supplier-capture-read-categories') {
        void beginAllCategories(message.tabId).then(reply).catch(error => reply({ error: error.message }));
        return true;
      }
      if (isOwnPage && message?.type === 'supplier-capture-read-image') {
        void readCaptureImage(message.captureId, message.imageUrl).then(reply).catch(error => reply({ error: error.message }));
        return true;
      }
      if (sender.id === api.runtime.id && sender.tab?.id !== undefined && message?.type === 'supplier-capture-evidence') {
        void handleEvidence(message, sender).then(() => reply({ accepted: true })).catch(() => reply({ accepted: false }));
        return true;
      }
      if (sender.id === api.runtime.id && sender.tab?.id !== undefined && message?.type === 'supplier-capture-page-finished') {
        void handlePageFinished(message, sender).then(() => reply({ accepted: true })).catch(() => reply({ accepted: false }));
        return true;
      }
    });
    api.tabs?.onRemoved?.addListener(tabId => { void readLive().then(state => state?.tabId === tabId ? cancel(tabId) : null); });
  }
  return { acknowledgeCapture, beginAllCategories, cancel, finish, handleEvidence, handlePageFinished, readCapture, readCaptureImage, readLive, registerInternalMessages, start };
}

export const supplierCaptureLimits = { CHUNK_SIZE, CAPTURE_TTL, MAX_PRODUCTS, PAGE_LIMIT };
export const supplierCaptureImagePermissions = { imageOriginsForSupplier, isAllowedCaptureImage };
