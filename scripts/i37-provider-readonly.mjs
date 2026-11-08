import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { extensionIdFromManifestKey } from './update-installed-facebook-extension.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionSource = join(root, 'extensions', 'facebook');
const allProviders = [
  { name: 'Mr Tecno', url: 'https://mrtecno.com.ar/productos/' },
  { name: 'Inova', url: 'https://inovaarg.com/tienda/page/4' },
  { name: 'Braja', url: 'https://brajamayorista.com/tienda/centro/productos' },
  { name: 'Mayorista Omega', url: 'https://mayoristaomega.com/#catalogo' },
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
  manifest.host_permissions = providerList.map(provider => `${new URL(provider.url).origin}/*`);
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

    if (state.status === 'categories-available' && state.categoryUrls?.length) {
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
    const withoutPrice = items.filter(item => !Number.isFinite(item.price) || item.price <= 0);
    const withoutPriceWithMoneyText = withoutPrice.filter(item => /(?:ARS|USD|U\$S|\$)\s*[\d.,]+/i.test(String(item.raw ?? ''))).length;
    const withoutPriceConsultText = withoutPrice.filter(item => /\bconsultar\b|\ba consultar\b/i.test(String(item.raw ?? ''))).length;
    if (!globalThis.RivaStockProductExtract) await import(new URL('../extensions/shared/product-extract.js', import.meta.url));
    const finalVisibleText = await page.evaluate(() => document.body?.innerText ?? '');
    const visibleText = `${initialVisibleText}\n${finalVisibleText}`;
    const normalizedVisibleText = visibleText.toLocaleLowerCase();
    const samples = items.filter(item => Number.isFinite(item.price) && item.price > 0
      && [item.name, item.code].filter(Boolean).some(value => normalizedVisibleText.includes(value.toLocaleLowerCase()))).slice(0, 3);
    const prices = await compareVisiblePrices(null, samples, provider.url, visibleText);

    const popupScreenshot = join(root, 'test-results', `i37-extension-popup-${provider.name.toLowerCase().replace(/\s+/g, '-')}.png`);
    await extensionPage.reload().catch(() => {});
    await page.bringToFront();
    await wait(300);
    await extensionPage.screenshot({ path: popupScreenshot, fullPage: true });
    results.push({
      provider: provider.name,
      products: items.length,
      withPhoto: items.filter(item => item.imageUrl || item.images?.length).length,
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
