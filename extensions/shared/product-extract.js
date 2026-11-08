(() => {
  const MAX_PRODUCTS = 5_000;
  const MAX_NAME_LENGTH = 200;
  const MAX_TEXT_LENGTH = 1_000;
  const PRICE_RE = /(?:ARS|USD|U\$S|US\$|\$|€|£)?\s*\d[\d.,\s]*/i;
  const PRODUCT_NAMES = ['name', 'nombre', 'title', 'titulo', 'description', 'descripcion', 'product_name'];
  const PRICE_NAMES = ['price', 'precio', 'amount', 'importe', 'valor', 'current_price', 'sale_price', 'precio_actual'];
  const IMAGE_NAMES = ['image', 'imagen', 'images', 'imagenes', 'photo', 'foto', 'thumbnail', 'picture', 'featured_image'];
  const CODE_NAMES = ['sku', 'code', 'codigo', 'product_code', 'barcode', 'id', 'permalink'];
  const CATEGORY_NAMES = ['category', 'categoria', 'rubro', 'product_category'];
  const UNSAFE_DOM = 'form,button,input,select,textarea,[contenteditable="true"],.video_centrado,.carousel-control,.swiper-button-next,.swiper-button-prev,[aria-label*="slide" i]';

  function decodeHtmlEntities(value) {
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
    return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token) => {
      if (token[0] === '#') {
        const radix = token[1]?.toLowerCase() === 'x' ? 16 : 10;
        const digits = radix === 16 ? token.slice(2) : token.slice(1);
        const point = Number.parseInt(digits, radix);
        return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
      }
      return named[token.toLowerCase()] ?? entity;
    });
  }

  function normalizeName(value) {
    let name = decodeHtmlEntities(value).replace(/\s+/g, ' ').replace(/[_\s]+$/g, '').trim();
    const notes = [];
    const noteMatch = name.match(/^\((sin\s+cambio|sin\s+devoluci[oó]n)\)\s*/i);
    if (noteMatch) {
      notes.push(noteMatch[1].replace(/\s+/g, ' ').toLocaleLowerCase('es-AR').replace(/(^|\s)\p{L}/gu, match => match.toLocaleUpperCase('es-AR')));
      name = name.slice(noteMatch[0].length);
    }
    let altCode = null;
    const parenthetical = name.match(/^\(([A-Z0-9._/-]+)\)\s*[–—-]?\s*/i);
    if (parenthetical && /\d/.test(parenthetical[1]) && !/\s/.test(parenthetical[1])) {
      altCode = parenthetical[1];
      name = name.slice(parenthetical[0].length);
    } else {
      const separatedCode = name.match(/^([A-Z0-9][A-Z0-9._/-]{1,})\s+[–—-]\s+/i);
      if (separatedCode && /\d/.test(separatedCode[1])) {
        altCode = separatedCode[1];
        name = name.slice(separatedCode[0].length);
      }
    }
    name = name.replace(/[_\s]+$/g, '').replace(/\s+/g, ' ').trim();
    if (name && !/[a-záéíóúñü]/.test(name)) {
      name = name.toLocaleLowerCase('es-AR').replace(/(^|[\s/(-])([\p{L}])/gu, (_, lead, letter) => `${lead}${letter.toLocaleUpperCase('es-AR')}`);
    }
    return { name: name.slice(0, MAX_NAME_LENGTH), altCode, notes };
  }

  function normalizeCurrency(value, pageUrl = '') {
    const currency = String(value ?? '').toUpperCase();
    if (/\bUSD\b|U\$S|US\$/.test(currency)) return 'USD';
    if (/\bARS\b|\$/.test(currency)) return 'ARS';
    if (/€/.test(currency)) return 'EUR';
    if (/£/.test(currency)) return 'GBP';
    try { if (/\.com\.ar$|\.ar$/.test(new URL(pageUrl).hostname)) return 'ARS'; } catch { /* A relative or missing source URL is common in fixtures. */ }
    return 'ARS';
  }

  function parsePrice(value, options = {}) {
    if (value === null || value === undefined || value === '') return { price: null, currency: normalizeCurrency(options.currency, options.pageUrl), needsReview: true };
    const minorUnit = Number.isInteger(options.minorUnit) && options.minorUnit >= 0 && options.minorUnit <= 4 ? options.minorUnit : null;
    if (typeof value === 'number' || (typeof value === 'string' && /^\s*\d+\s*$/.test(value) && minorUnit !== null)) {
      const numeric = Number(value);
      const amount = minorUnit !== null && Number.isInteger(numeric) ? numeric / (10 ** minorUnit) : numeric;
      return finishPrice(amount, options.currency, options.pageUrl);
    }
    if (typeof value === 'object') {
      const amount = value.amount ?? value.value ?? value.price ?? value.precio;
      return parsePrice(amount, { ...options, currency: value.currency ?? value.currency_code ?? options.currency, minorUnit: value.minor_unit ?? value.currency_minor_unit ?? options.minorUnit });
    }
    let text = decodeHtmlEntities(String(value)).replace(/\u00a0/g, ' ').trim();
    if (!/\d/.test(text) || /consultar|sin\s+precio|a\s+convenir/i.test(text)) return { price: null, currency: normalizeCurrency(text || options.currency, options.pageUrl), needsReview: true };
    const currency = normalizeCurrency(text || options.currency, options.pageUrl);
    text = text.replace(/[^\d.,]/g, '');
    if (!text) return { price: null, currency, needsReview: true };
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    const lastSeparator = Math.max(lastDot, lastComma);
    if (lastSeparator >= 0) {
      const trailingDigits = text.slice(lastSeparator + 1).replace(/\D/g, '').length;
      if (trailingDigits === 2) {
        const integer = text.slice(0, lastSeparator).replace(/[.,]/g, '');
        const decimal = text.slice(lastSeparator + 1).replace(/[.,]/g, '');
        return finishPrice(Number(`${integer || '0'}.${decimal}`), currency, options.pageUrl);
      }
      if (trailingDigits === 3) return finishPrice(Number(text.replace(/[.,]/g, '')), currency, options.pageUrl);
    }
    return finishPrice(Number(text.replace(/[.,]/g, '')), currency, options.pageUrl);
  }

  function parseLabeledPrices(value, options = {}) {
    const text = safeText(value);
    const labeled = [...text.matchAll(/(mayorista|minorista|mayor|minor)\s*:?\s*((?:ARS|USD|U\$S|US\$|\$)?\s*\d[\d.,\s]*)/gi)];
    if (labeled.length < 2) return null;
    const prices = labeled.map(match => ({
      label: /mayor/i.test(match[1]) ? 'mayorista' : 'minorista',
      price: parsePrice(match[2], options).price,
    })).filter(option => option.price !== null);
    if (!prices.length) return null;
    return { wholesale: prices.find(option => option.label === 'mayorista')?.price ?? null, retail: prices.find(option => option.label === 'minorista')?.price ?? null, options: prices };
  }

  function finishPrice(amount, currency, pageUrl) {
    const normalizedCurrency = normalizeCurrency(currency, pageUrl);
    if (!Number.isFinite(amount) || amount <= 0) return { price: null, currency: normalizedCurrency, needsReview: true };
    const rounded = Math.round(amount * 100) / 100;
    return { price: rounded, currency: normalizedCurrency, needsReview: rounded > 5_000_000 };
  }

  function lookup(object, paths) {
    for (const path of paths) {
      let value = object;
      for (const segment of path.split('.')) value = value && typeof value === 'object' ? value[segment] : undefined;
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  function firstNonEmpty(values) {
    return values.find(value => value !== undefined && value !== null && value !== '') ?? null;
  }

  function imageValues(value) {
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    return values.flatMap(item => {
      if (typeof item === 'string') return [item];
      if (item && typeof item === 'object') {
        const candidate = firstNonEmpty([item.url, item.src, item.image, item.href, item.contentUrl]);
        return candidate ? [candidate] : [];
      }
      return [];
    }).slice(0, 5);
  }

  function normalizeImage(value, pageUrl = '') {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim(), pageUrl || undefined);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      url.protocol = 'https:';
      return url.href;
    } catch { return null; }
  }

  function normalizeCategory(value) {
    let category = decodeHtmlEntities(value).replace(/[＊*]/g, '').replace(/\s+/g, ' ').trim();
    if (category && !/[a-záéíóúñü]/.test(category)) category = category.toLocaleLowerCase('es-AR');
    return category.replace(/(^|\s)\p{L}/gu, match => match.toLocaleUpperCase('es-AR')) || null;
  }

  function getProductRecord(object, pageUrl, evidence = {}) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return null;
    const titleRaw = firstNonEmpty([lookup(object, PRODUCT_NAMES), lookup(object, ['product.name', 'product.title', 'item.name', 'item.title'])]);
    const priceRaw = firstNonEmpty([
      lookup(object, ['price', 'precio', 'current_price', 'currentPrice', 'sale_price', 'salePrice', 'precio_actual', 'prices.price', 'prices.sale_price', 'offers.price', 'offers.0.price', 'offer.price']),
      lookup(object, ['amount', 'importe', 'valor']),
    ]);
    if (typeof titleRaw !== 'string' || priceRaw === null || priceRaw === undefined || priceRaw === '') return null;
    const priceContainer = firstNonEmpty([object.prices, object.price, object.offers?.[0], object.offer, object]);
    const currencyRaw = firstNonEmpty([
      lookup(object, ['currency_code', 'currency', 'priceCurrency', 'moneda', 'prices.currency_code', 'prices.currency']),
      lookup(priceContainer, ['currency_code', 'currency', 'priceCurrency', 'moneda']),
    ]);
    const minorUnit = firstNonEmpty([
      lookup(object, ['currency_minor_unit', 'minor_unit', 'minorUnit', 'prices.currency_minor_unit']),
      lookup(priceContainer, ['currency_minor_unit', 'minor_unit', 'minorUnit']),
    ]);
    const parsedPrice = parsePrice(priceRaw, { currency: currencyRaw, minorUnit: Number(minorUnit), pageUrl });
    const comparePrice = firstNonEmpty([
      lookup(object, ['regular_price', 'regularPrice', 'compare_at_price', 'compareAtPrice', 'list_price', 'listPrice', 'original_price', 'precio_original', 'price.regular_price', 'prices.regular_price']),
    ]);
    const parsedListPrice = comparePrice ? parsePrice(comparePrice, { currency: currencyRaw, minorUnit: Number(minorUnit), pageUrl }).price : null;
    const normalizedName = normalizeName(titleRaw);
    if (!normalizedName.name) return null;
    let code = firstNonEmpty([lookup(object, CODE_NAMES), lookup(object, ['product.sku', 'product.id'])]);
    if (typeof code === 'object') code = code.value ?? code.id ?? code.code ?? null;
    code = code == null ? normalizedName.altCode : String(code).trim() || normalizedName.altCode;
    const images = imageValues(lookup(object, IMAGE_NAMES)).map(image => normalizeImage(image, pageUrl)).filter(Boolean);
    const category = lookup(object, CATEGORY_NAMES);
    const row = {
      key: '', code: code ? String(code).slice(0, 100) : null, altCode: normalizedName.altCode,
      name: normalizedName.name, price: parsedPrice.price, listPrice: parsedListPrice,
      currency: parsedPrice.currency, category: category ? normalizeCategory(String(category)) : null,
      imageUrl: images[0] ?? null, images, url: normalizeImage(lookup(object, ['permalink', 'url', 'link', 'product_url']), pageUrl),
      packSize: parsePackSize(firstNonEmpty([lookup(object, ['pack_size', 'packSize', 'quantity_per_pack', 'units_per_pack', 'minimum_quantity', 'min_quantity'])])),
      notes: normalizedName.notes, needsPriceReview: parsedPrice.needsReview, raw: null,
    };
    row.key = buildKey(row);
    if (evidence.priceLabels && /mayorista/i.test(evidence.priceLabels) && /minorista/i.test(evidence.priceLabels)) row.priceLabels = ['mayorista', 'minorista'];
    return row;
  }

  function parsePackSize(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    const match = String(value ?? '').match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  function buildKey(row) {
    return row.code ? `code:${row.code.trim().toLocaleUpperCase('es-AR')}` : `name:${row.name.toLocaleLowerCase('es-AR')}|${row.price ?? 'no-price'}`;
  }

  function extractObjects(value, pageUrl, output, depth = 0) {
    if (!value || depth > 14 || output.length >= MAX_PRODUCTS * 4) return;
    if (Array.isArray(value)) {
      for (const item of value) extractObjects(item, pageUrl, output, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const record = getProductRecord(value, pageUrl);
    if (record) output.push(record);
    for (const [key, child] of Object.entries(value)) {
      if (/token|cookie|session|auth|credential|password|email|user|customer|profile|headers/i.test(key)) continue;
      extractObjects(child, pageUrl, output, depth + 1);
    }
  }

  function collectDomEvidence(document) {
    const candidates = new Set();
    const selectors = [
      '.caja_producto', '[data-product]', '[data-product-id]', '[itemtype*="Product" i]',
      'article.product', 'article.product-card', 'li.product', '.product-card', '.product-item',
      '.js-item-product', '.item-product', '.grid-item.product', '[class*="product-card"]',
    ];
    for (const selector of selectors) for (const node of document.querySelectorAll(selector)) candidates.add(node);
    const all = [...candidates].filter(node => node && !node.closest(UNSAFE_DOM));
    const cards = [];
    for (const node of all) {
      if (!visible(node)) continue;
      const title = node.querySelector('.descrip h1, h1, h2, h3, [itemprop="name"], .product-title, .woocommerce-loop-product__title, .js-item-name, [class*="title"]');
      const priceNode = node.querySelector('p.datos strong, strong.caja_precio_noimptk, [itemprop="price"], .price-current, .sale-price, .woocommerce-Price-amount, .price, [class*="precio"]')
        ?? [...node.querySelectorAll('[class*="price"]')].find(candidate => !candidate.matches('del,[class*="original"],[class*="regular"],[data-list-price]'));
      const imageNodes = [...node.querySelectorAll('.carousel-inner .item img, img')].filter(image => !image.closest(UNSAFE_DOM));
      if (!title || !priceNode || imageNodes.length === 0) continue;
      const safeTexts = collectSafeText(node);
      const titleText = safeText(title.textContent);
      const codeLine = safeTexts.find(text => /(?:sku|c[oó]d(?:igo)?|codigo)\s*[:#]/i.test(text)) ?? '';
      const codeMatch = codeLine.match(/(?:sku|c[oó]d(?:igo)?|codigo)\s*\.?\s*[:#]\s*([\w./-]+)/i);
      const fallbackCode = imageNodes.find(image => image.getAttribute('data-codigo'))?.getAttribute('data-codigo')
        ?? node.querySelector('a[name]')?.getAttribute('name')
        ?? node.getAttribute('data-product-id')
        ?? node.getAttribute('data-product');
      const categoryNode = node.querySelector('p.rubro_centrado, [itemprop="category"], [class*="category"], [class*="categoria"], [class*="rubro"]');
      const priceText = safeText(priceNode.textContent);
      const imageUrls = imageNodes.map(image => image.getAttribute('data-src') || image.getAttribute('data-lazy') || image.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] || image.getAttribute('src')).filter(Boolean);
      const allText = safeTexts.join(' ');
      const listPriceNode = node.querySelector('del,.price-original,[class*="original"],[class*="regular"],[data-list-price]');
      const productAnchor = node.querySelector('a.woocommerce-LoopProduct-link,a.product-link,a.js-item-name,[itemprop="url"]');
      cards.push({
        title: titleText, text: allText.slice(0, MAX_TEXT_LENGTH), priceText,
        code: codeMatch?.[1] ?? fallbackCode ?? null,
        category: categoryNode ? safeText(categoryNode.textContent) : safeTexts.find(text => /^rubro\s*:/i.test(text))?.replace(/^rubro\s*:\s*/i, '') ?? null,
        imageUrls: imageUrls.slice(0, 5), url: productAnchor?.href ?? document.location?.href ?? null,
        packText: safeTexts.find(text => /(?:p\/bulto|por\s+bulto|x\s*bulto|m[ií]nimo)/i.test(text)) ?? null,
        listPriceText: listPriceNode ? safeText(listPriceNode.textContent) : safeTexts.find(text => /(?:antes|lista|minorista|regular)/i.test(text)) ?? null,
      });
    }
    return cards;
  }

  function visible(node) {
    if (!node || node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    const view = node.ownerDocument?.defaultView;
    if (view?.getComputedStyle) {
      const style = view.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  function safeText(value) {
    return decodeHtmlEntities(String(value ?? '')).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
  }

  function collectSafeText(node) {
    const view = node.ownerDocument?.defaultView;
    const walker = node.ownerDocument.createTreeWalker(node, view?.NodeFilter?.SHOW_TEXT ?? 4);
    const values = [];
    let current;
    while ((current = walker.nextNode())) {
      const parent = current.parentElement;
      if (!parent || parent.closest(UNSAFE_DOM) || !visible(parent)) continue;
      const text = safeText(current.nodeValue);
      if (text) values.push(text);
    }
    return values;
  }

  function deduplicateCards(cards) {
    const found = new Map();
    for (const card of cards) {
      const normalized = normalizeName(card.title);
      const labeledPrices = parseLabeledPrices(card.priceText, { currency: card.currency, pageUrl: card.url });
      const parsed = parsePrice(labeledPrices?.wholesale ?? card.priceText, { currency: card.currency, pageUrl: card.url });
      const explicitCode = card.code ? String(card.code).trim() : null;
      const code = explicitCode || normalized.altCode;
      const row = {
        key: '', code: code ? code.slice(0, 100) : null, altCode: normalized.altCode,
        name: normalized.name, price: parsed.price,
        listPrice: labeledPrices?.retail ?? (card.listPriceText ? parsePrice(card.listPriceText, { currency: card.currency, pageUrl: card.url }).price : null),
        currency: parsed.currency, category: card.category ? normalizeCategory(card.category) : null,
        imageUrl: (card.imageUrls ?? []).map(image => normalizeImage(image, card.url)).find(Boolean) ?? null,
        images: [...new Set((card.imageUrls ?? []).map(image => normalizeImage(image, card.url)).filter(Boolean))].slice(0, 5),
        url: normalizeImage(card.url, card.url), packSize: parsePackSize(card.packText), notes: normalized.notes,
        priceOptions: labeledPrices?.options ?? null,
        needsPriceReview: parsed.needsReview, raw: safeText([card.title, card.priceText, card.code, card.category].filter(Boolean).join(' | ')),
      };
      if (!row.name) continue;
      row.key = buildKey(row);
      const previous = found.get(row.key);
      if (!previous || productScore(row) > productScore(previous)) found.set(row.key, row);
    }
    return [...found.values()];
  }

  function productScore(row) {
    return (row.name ? 4 : 0) + (row.price ? 4 : 0) + (row.imageUrl ? 3 : 0) + (row.code ? 2 : 0) + (row.category ? 1 : 0);
  }

  function extractStructured(document) {
    const values = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"],script#__NEXT_DATA__,script#__NUXT_DATA__,script[type="application/json"]')) {
      try { values.push(JSON.parse(script.textContent ?? '')); } catch { /* Ignore incomplete application state. */ }
    }
    for (const script of document.querySelectorAll('script:not([src])')) {
      const text = script.textContent ?? '';
      if (!/(?:__INITIAL_STATE__|__NEXT_DATA__|__NUXT__|__APOLLO_STATE__)/.test(text)) continue;
      const match = text.match(/(?:window\.)?(?:__INITIAL_STATE__|__NEXT_DATA__|__NUXT__|__APOLLO_STATE__)\s*=\s*({[\s\S]*?});?\s*$/);
      if (match) { try { values.push(JSON.parse(match[1])); } catch { /* Source state is not necessarily JSON. */ } }
    }
    const microdata = [...document.querySelectorAll('[itemtype*="Product" i]')].map(node => ({
      name: node.querySelector('[itemprop="name"]')?.textContent,
      sku: node.querySelector('[itemprop="sku"]')?.textContent,
      category: node.querySelector('[itemprop="category"]')?.textContent,
      image: node.querySelector('[itemprop="image"]')?.getAttribute('content') || node.querySelector('[itemprop="image"]')?.getAttribute('src'),
      offers: { price: node.querySelector('[itemprop="price"]')?.getAttribute('content') || node.querySelector('[itemprop="price"]')?.textContent, priceCurrency: node.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') },
      url: node.querySelector('[itemprop="url"]')?.getAttribute('href'),
    }));
    if (microdata.length) values.push(microdata);
    return values;
  }

  function extractSupplierProducts(evidence = {}) {
    const pageUrl = typeof evidence.url === 'string' ? evidence.url : '';
    const dom = Array.isArray(evidence.cards) ? deduplicateCards(evidence.cards) : [];
    const sources = [];
    const jsonProducts = [];
    for (const response of evidence.jsonResponses ?? []) {
      const payload = typeof response === 'string' ? parseJson(response) : response?.body ?? response?.json ?? response;
      if (payload) extractObjects(payload, pageUrl, jsonProducts);
    }
    const structuredProducts = [];
    for (const payload of evidence.structuredData ?? []) extractObjects(payload, pageUrl, structuredProducts);
    const byKey = new Map();
    for (const product of [...jsonProducts, ...structuredProducts, ...dom]) {
      if (product.price === null) product.needsPriceReview = true;
      if (!product.key) product.key = buildKey(product);
      const previous = byKey.get(product.key);
      if (!previous || productScore(product) > productScore(previous)) byKey.set(product.key, product);
    }
    const items = [...byKey.values()].slice(0, MAX_PRODUCTS);
    if (jsonProducts.length) sources.push('network-json');
    if (structuredProducts.length) sources.push('structured-data');
    if (dom.length) sources.push('dom-cards');
    const warnings = [];
    if (!items.length) warnings.push('No encontramos productos en esta página. Si requiere clave o JavaScript, iniciá sesión en el proveedor y volvé a leer desde su página.');
    if (items.some(item => item.price === null)) warnings.push('Hay productos sin precio; quedaron marcados para revisar y no se importan como costo cero.');
    if (items.some(item => item.needsPriceReview && item.price !== null)) warnings.push('Hay precios superiores a $5.000.000 o que necesitan revisión.');
    if (/mayorista/i.test(evidence.pageText ?? '') && /minorista/i.test(evidence.pageText ?? '')) warnings.push('La página muestra precios mayoristas y minoristas; revisá cuál corresponde antes de continuar.');
    return { items, source: [...new Set(sources)], warnings };
  }

  function parseJson(value) { try { return JSON.parse(value); } catch { return null; } }

  function readPage(document, jsonResponses = []) {
    const cards = collectDomEvidence(document);
    const structuredData = extractStructured(document);
    return extractSupplierProducts({ url: document.location?.href ?? '', cards, structuredData, jsonResponses, pageText: document.body ? collectSafeText(document.body).join(' ') : '' });
  }

  const api = { MAX_PRODUCTS, collectDomEvidence, decodeHtmlEntities, extractSupplierProducts, normalizeName, normalizeImage, normalizeCategory, normalizeCurrency, parseLabeledPrices, parsePrice, readPage };
  globalThis.RivaStockProductExtract = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
