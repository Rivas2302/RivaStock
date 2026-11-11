import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { extensionIdFromManifestKey } from './update-installed-facebook-extension.mjs';
import { getSupplierSiteDomain } from '../extensions/facebook/supplier-site-domain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionSource = join(root, 'extensions', 'facebook');
const allProviders = [
  { name: 'Mr Tecno', url: 'https://mrtecno.com.ar/productos/' },
  { name: 'Inova', url: 'https://inovaarg.com/tienda/page/4' },
  { name: 'Braja', url: 'https://brajamayorista.com/tienda/centro/productos' },
  { name: 'Braja categoría 31', url: 'https://brajamayorista.com/tienda/centro/productos?categoria=31', expectedProducts: 5 },
  { name: 'Mayorista Omega', url: 'https://mayoristaomega.com/#catalogo' },
  { name: 'Gorox', url: 'https://catalogo-rdo.vercel.app/' },
];
const requestedProviders = process.argv.slice(2).map(value => value.toLocaleLowerCase());
const providerList = requestedProviders.length
  ? allProviders.filter(provider => requestedProviders.includes(provider.name.toLocaleLowerCase()))
  : allProviders;
const wait = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

async function waitForWorker(context, extensionId) {
  const find = () => context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${extensionId}/worker.js`));
  const current = find();
  if (current) return current;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('No arrancó el worker local de la extensión.')), 30_000);
    context.on('serviceworker', worker => {
      if (!worker.url().startsWith(`chrome-extension://${extensionId}/worker.js`)) return;
      clearTimeout(timer);
      resolvePromise(worker);
    });
  });
}

async function readLiveState(worker) {
  return worker.evaluate(async () => (await chrome.storage.session.get('supplierCaptureLive')).supplierCaptureLive ?? null);
}

async function capturePage(worker, extensionPage, tabId, origin) {
  return extensionPage.evaluate(({ targetTabId, targetOrigin }) => new Promise(resolvePromise => {
    chrome.runtime.sendMessage({ type: 'supplier-capture-start', tabId: targetTabId, origin: targetOrigin }, resolvePromise);
  }), { targetTabId: tabId, targetOrigin: origin });
}

async function activeTabForOrigin(worker, origin) {
  return worker.evaluate(async targetOrigin => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.find(tab => {
      try { return new URL(tab.url).origin === targetOrigin; } catch { return false; }
    })?.id ?? null;
  }, origin);
}

async function compareVisiblePrices(page, items, pageUrl, bodyTextSnapshot = '') {
  const bodyText = bodyTextSnapshot || await page.evaluate(() => document.body?.innerText ?? '');
  const normalizedText = bodyText.toLocaleLowerCase();
  const snippets = items.slice(0, 8).map(item => {
    const terms = [item.name, item.code].filter(Boolean).map(value => value.toLocaleLowerCase());
    const index = terms.map(term => normalizedText.indexOf(term)).filter(value => value >= 0).sort((a, b) => a - b)[0] ?? -1;
    const visible = index < 0 ? null : bodyText.slice(Math.max(0, index - 180), index + 360).replace(/\s+/g, ' ').trim();
    return { name: item.name, code: item.code ?? null, price: item.price, currency: item.currency, visible };
  });
  const parser = globalThis.RivaStockProductExtract;
  return snippets.map(entry => {
    if (!entry.visible || entry.price === null) return { ...entry, matched: false, pagePrice: null };
    const formattedPrices = entry.visible.match(/(?:U\$S|US\$|USD|ARS|\$|€|£)\s*[\d.,]+|\b\d[\d.,]{2,}\b/gi) ?? [];
    const values = formattedPrices.map(raw => parser?.parsePrice(raw, { pageUrl })?.price ?? null).filter(Number.isFinite);
    const matched = values.some(value => Math.abs(value - entry.price) < 0.01);
    return { ...entry, matched, pagePrice: values.find(value => Math.abs(value - entry.price) < 0.01) ?? values[0] ?? null };
  });
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'rivastock-i37-readonly-'));
const extensionPath = join(temporaryRoot, 'extension');
const profilePath = join(temporaryRoot, 'profile');
let context;
try {
  await cp(extensionSource, extensionPath, { recursive: true });
  await mkdir(join(extensionPath, 'shared'), { recursive: true });
  await cp(join(root, 'extensions', 'shared', 'product-extract.js'), join(extensionPath, 'shared', 'product-extract.js'));

  const manifestPath = join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const extensionId = extensionIdFromManifestKey(manifest.key);
  manifest.host_permissions = providerList.flatMap(provider => {
    const origin = new URL(provider.url).origin;
    const domain = getSupplierSiteDomain(origin);
    return [
      `${origin}/*`,
      ...(domain ? [`https://*.${domain}/*`] : []),
      ...(provider.name === 'Gorox' ? ['https://res.cloudinary.com/*'] : []),
    ];
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  const worker = await waitForWorker(context, extensionId);
  const extensionPage = await context.newPage();
  await extensionPage.setViewportSize({ width: 390, height: 760 });
  await extensionPage.goto(`chrome-extension://${extensionId}/connect.html`);

  const results = [];
  for (const provider of providerList) {
    const page = await context.newPage();
    const parsedUrl = new URL(provider.url);
    const origin = parsedUrl.origin;
    await page.goto(provider.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2_500);
    const initialVisibleText = await page.evaluate(() => document.body?.innerText ?? '');
    const tabId = await activeTabForOrigin(worker, origin);
    if (!Number.isSafeInteger(tabId)) throw new Error(`No encontré la pestaña de ${provider.name}.`);

    await extensionPage.reload();
    await page.bringToFront();
    const popupIdleScreenshot = join(root, 'test-results', `i37-extension-popup-idle-${provider.name.toLowerCase().replace(/\s+/g, '-')}.png`);
    await mkdir(dirname(popupIdleScreenshot), { recursive: true });
    await extensionPage.screenshot({ path: popupIdleScreenshot, fullPage: true });

    const started = await capturePage(worker, extensionPage, tabId, origin);
    if (started?.error) throw new Error(`${provider.name}: ${started.error}`);
    const timeoutAt = Date.now() + 180_000;
    let state = null;
    while (Date.now() < timeoutAt) {
      state = await readLiveState(worker);
      if (state?.tabId === tabId && ['complete', 'categories-available'].includes(state.status)) break;
      await wait(1_000);
    }
    if (!state || state.tabId !== tabId || !['complete', 'categories-available'].includes(state.status)) {
      throw new Error(`${provider.name}: la lectura excedió tres minutos.`);
    }

    // The category-31 check must validate the filtered page itself, not expand
    // every category and accidentally report the entire supplier catalog.
    if (provider.name !== 'Braja categoría 31' && state.status === 'categories-available' && state.categoryUrls?.length) {
      const readAll = await extensionPage.evaluate(targetTabId => new Promise(resolvePromise => {
        chrome.runtime.sendMessage({ type: 'supplier-capture-read-categories', tabId: targetTabId }, resolvePromise);
      }), tabId);
      if (readAll?.error) throw new Error(`${provider.name}: ${readAll.error}`);
      const categoriesDeadline = Date.now() + 180_000;
      while (Date.now() < categoriesDeadline) {
        state = await readLiveState(worker);
        if (state?.tabId === tabId && state.status === 'complete') break;
        await wait(1_000);
      }
    }

    const items = Array.isArray(state?.items) ? state.items : [];
    if (provider.expectedProducts && items.length !== provider.expectedProducts) {
      throw new Error(`${provider.name}: se esperaban ${provider.expectedProducts} productos filtrados y se leyeron ${items.length}.`);
    }
    if (provider.name === 'Gorox' && (!Number.isSafeInteger(state.reportedTotal) || state.reportedTotal < 400 || items.length !== state.reportedTotal
      || !items.every(item => item.currency === 'ARS' && Number.isFinite(item.price) && item.price > 0
        && item.imageUrl && new URL(item.imageUrl).hostname === 'res.cloudinary.com'))) {
      const diagnostics = await page.evaluate(stateSummary => {
        const cards = [...document.querySelectorAll('article.prod[data-sku]')];
        const codes = cards.map(card => card.getAttribute('data-sku') || '').filter(Boolean);
        return {
          visibleCards: cards.length,
          uniqueVisibleCodes: new Set(codes).size,
          categoryLabels: [...document.querySelectorAll('button.rubro')].map(button => (button.innerText || '').trim()).slice(0, 20),
          stateWithArs: stateSummary.withArs,
          stateWithPhotos: stateSummary.withPhotos,
          nonArsCurrency: stateSummary.nonArsCurrency,
          invalidPrice: stateSummary.invalidPrice,
          photoHosts: stateSummary.photoHosts,
          photoSamples: stateSummary.photoSamples,
          repeatedCodes: codes.length - new Set(codes).size,
          pagesVisited: stateSummary.pages,
          actions: stateSummary.actions,
        };
      }, { withArs: items.filter(item => item.currency === 'ARS' && Number.isFinite(item.price)).length,
        withPhotos: items.filter(item => Boolean(item.imageUrl)).length,
        nonArsCurrency: items.filter(item => item.currency !== 'ARS').length,
        invalidPrice: items.filter(item => !Number.isFinite(item.price) || item.price <= 0).length,
        photoHosts: Object.fromEntries([...items.reduce((counts, item) => {
          const host = item.imageUrl ? new URL(item.imageUrl).hostname : '(none)';
          counts.set(host, (counts.get(host) ?? 0) + 1);
          return counts;
        }, new Map())]),
        photoSamples: items.slice(0, 5).map(item => item.imageUrl ? `${new URL(item.imageUrl).hostname}${new URL(item.imageUrl).pathname.slice(0, 70)}` : '(none)'),
        pages: state.pagesVisited?.length ?? 0, actions: state.clicksUsed ?? 0 })
        .catch(() => ({ pagesVisited: state.pagesVisited?.length ?? 0, actions: state.clicksUsed ?? 0 }));
      throw new Error(`Gorox: se esperaba leer el total informado (alrededor de 450), todos con precio ARS y foto de producto (total informado ${state.reportedTotal}, leídos ${items.length}; diagnóstico ${JSON.stringify(diagnostics)}).`);
    }
    if (provider.name === 'Braja categoría 31' && !items.every(item => item.imageUrl || item.images?.length)) {
      throw new Error('Braja categoría 31: hay productos sin foto capturada.');
    }
    const withoutPrice = items.filter(item => !Number.isFinite(item.price) || item.price <= 0);
    const withoutPriceWithMoneyText = withoutPrice.filter(item => /(?:ARS|USD|U\$S|\$)\s*[\d.,]+/i.test(String(item.raw ?? ''))).length;
    const withoutPriceConsultText = withoutPrice.filter(item => /\bconsultar\b|\ba consultar\b/i.test(String(item.raw ?? ''))).length;
    if (!globalThis.RivaStockProductExtract) await import(new URL('../extensions/shared/product-extract.js', import.meta.url));
    const finalVisibleText = await page.evaluate(() => document.body?.innerText ?? '');
    const visibleText = `${initialVisibleText}\n${finalVisibleText}`;
    const normalizedVisibleText = visibleText.toLocaleLowerCase();
    const samples = items.filter(item => Number.isFinite(item.price) && item.price > 0
      && [item.name, item.code].filter(Boolean).some(value => normalizedVisibleText.includes(value.toLocaleLowerCase()))).slice(0, 3);
    const prices = provider.name === 'Gorox'
      ? await page.evaluate(entries => entries.map(item => {
        const card = [...document.querySelectorAll('article.prod[data-sku]')].find(candidate => candidate.getAttribute('data-sku') === item.code);
        return { name: item.name, code: item.code, price: item.price, currency: item.currency, pagePriceText: card?.querySelector('.precio .ars')?.textContent?.trim() ?? null };
      }), samples).then(entries => entries.map(entry => {
        const parsed = entry.pagePriceText ? globalThis.RivaStockProductExtract.parsePrice(entry.pagePriceText, { pageUrl: provider.url }) : null;
        const pagePrice = parsed?.price ?? null;
        return { name: entry.name, code: entry.code, price: entry.price, currency: entry.currency,
          visible: entry.pagePriceText, matched: parsed?.currency === 'ARS' && pagePrice !== null && Math.abs(pagePrice - entry.price) < 0.01, pagePrice };
      }))
      : await compareVisiblePrices(null, samples, provider.url, visibleText);
    if (provider.name === 'Gorox' && (prices.length < 3 || prices.slice(0, 3).some(entry => !entry.matched))) {
      throw new Error(`Gorox: al menos tres precios ARS leídos no coinciden con la página: ${JSON.stringify(prices)}.`);
    }

    const popupScreenshot = join(root, 'test-results', `i37-extension-popup-${provider.name.toLowerCase().replace(/\s+/g, '-')}.png`);
    await extensionPage.reload().catch(() => {});
    await page.bringToFront();
    await wait(300);
    await extensionPage.screenshot({ path: popupScreenshot, fullPage: true });
    results.push({
      provider: provider.name,
      products: items.length,
      reportedTotal: state.reportedTotal ?? null,
      withPhoto: items.filter(item => item.imageUrl || item.images?.length).length,
      allPricesARS: items.every(item => item.currency === 'ARS' && Number.isFinite(item.price) && item.price > 0),
      withCode: items.filter(item => typeof item.code === 'string' && item.code.trim()).length,
      withoutPrice: withoutPrice.length,
      withoutPriceWithMoneyText,
      withoutPriceConsultText,
      samplePriceComparisons: prices.slice(0, 3),
      popupScreenshot,
    });

    await extensionPage.evaluate(targetTabId => new Promise(resolvePromise => {
      chrome.runtime.sendMessage({ type: 'supplier-capture-cancel', tabId: targetTabId }, resolvePromise);
    }), tabId).catch(() => {});
    await page.close();
    await wait(500);
  }

  console.log(JSON.stringify({ profile: 'temporary, unauthenticated', productionWrites: 0, results }, null, 2));
} finally {
  await context?.close().catch(() => {});
  await rm(temporaryRoot, { recursive: true, force: true });
}
