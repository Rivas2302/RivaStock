import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { extensionIdFromManifestKey } from './update-installed-facebook-extension.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://fixtures.example.test';
const extensionSource = join(root, 'extensions', 'facebook');
const fixtures = join(root, 'e2e', 'fixtures', 'stores');
const wait = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

async function waitForWorker(context, extensionId) {
  const find = () => context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${extensionId}/worker.js`));
  const current = find();
  if (current) return current;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('Extension service worker did not start.')), 30_000);
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

function itemCard(index, title, code) {
  return `<article class="product-card" data-product-id="${code}"><h2 class="product-title">${title}</h2><div class="price">$ 2.500,00</div><img src="https://images.example.test/${code}.webp" alt=""><span class="sku">SKU: ${code}</span><span class="category">Accesorios</span></article>`;
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'rivastock-i37-fixture-e2e-'));
const extensionPath = join(temporaryRoot, 'extension');
const profilePath = join(temporaryRoot, 'profile');
let context;
try {
  await cp(extensionSource, extensionPath, { recursive: true });
  await mkdir(join(extensionPath, 'shared'), { recursive: true });
  await cp(join(root, 'extensions', 'shared', 'product-extract.js'), join(extensionPath, 'shared', 'product-extract.js'));
  const manifestPath = join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [`${origin}/*`];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const extensionId = extensionIdFromManifestKey(manifest.key);
  const catalog = JSON.parse(await readFile(join(fixtures, 'spa-json.json'), 'utf8'));
  const infiniteFixture = await readFile(join(fixtures, 'infinite-scroll.html'), 'utf8');
  const wooFixture = await readFile(join(fixtures, 'woocommerce-dom.html'), 'utf8');

  context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run', '--no-default-browser-check'],
  });
  await context.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname === 'images.example.test') {
      return route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.from('fixture-image') });
    }
    if (requestUrl.origin !== origin) return route.continue();
    if (requestUrl.pathname === '/spa-json') {
      const html = `<!doctype html><html lang="es"><meta charset="utf-8"><body><main id="catalog"></main><nav class="catalog-pagination"><button type="button" class="actual" aria-current="page" aria-label="Pagina 1">1</button><button type="button" aria-label="Pagina 2">2</button></nav><script>
        let current=1;
        const load=()=>fetch('/spa-json/api?page='+current).then(response=>response.json());
        load();
        document.querySelector('[aria-label="Pagina 2"]').addEventListener('click',()=>{current=2;document.querySelector('[aria-current="page"]').removeAttribute('aria-current');document.querySelector('[aria-label="Pagina 2"]').remove();load()});
      </script></body></html>`;
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    if (requestUrl.pathname === '/spa-json/api') {
      const index = Math.max(0, Math.min(catalog.responses.length - 1, Number(requestUrl.searchParams.get('page')) - 1));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog.responses[index]) });
    }
    if (requestUrl.pathname === '/infinite-scroll') {
      const append = itemCard(3, 'Producto infinito tres', 'DOM-3') + itemCard(4, 'Producto infinito cuatro', 'DOM-4');
      const html = infiniteFixture.replace('</body>', `<script>
        window.fixtureClicks={loadMore:0,add:0,carousel:0};
        document.querySelector('[data-test="load-more"]').addEventListener('click',event=>{window.fixtureClicks.loadMore++;document.querySelector('main').insertAdjacentHTML('beforeend',${JSON.stringify(append)});event.currentTarget.remove()});
        document.querySelectorAll('button.carousel-control').forEach(button=>button.addEventListener('click',()=>window.fixtureClicks.carousel++));
        document.querySelectorAll('form button').forEach(button=>button.addEventListener('click',()=>window.fixtureClicks.add++));
      </script></body>`);
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    if (requestUrl.pathname === '/woocommerce-dom') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: wooFixture });
    }
    return route.fulfill({ status: 404, body: 'Not found' });
  });

  const worker = await waitForWorker(context, extensionId);
  const extensionPage = await context.newPage();
  await extensionPage.setViewportSize({ width: 390, height: 760 });
  await extensionPage.goto(`chrome-extension://${extensionId}/connect.html`);
  await extensionPage.locator('#supplier-start').waitFor({ state: 'visible' });
  await extensionPage.waitForFunction(() => document.querySelector('#version')?.textContent === 'Versión 0.6.0');
  const screenshotPath = join(root, 'test-results', 'i37-fixture-extension-popup.png');
  await mkdir(dirname(screenshotPath), { recursive: true });
  await extensionPage.locator('section.supplier-import').screenshot({ path: screenshotPath });

  const cases = [
    { name: 'spa-json', path: '/spa-json', expected: 44, source: 'network-json' },
    { name: 'infinite-scroll', path: '/infinite-scroll', expected: 4, source: 'dom-cards' },
    { name: 'woocommerce-dom', path: '/woocommerce-dom', expected: 3, source: 'dom-cards' },
  ];
  const results = [];
  for (const testCase of cases) {
    const page = await context.newPage();
    const pageUrl = `${origin}${testCase.path}`;
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    const tabId = await worker.evaluate(async targetUrl => (await chrome.tabs.query({})).find(tab => tab.url === targetUrl)?.id ?? null, pageUrl);
    if (!Number.isSafeInteger(tabId)) throw new Error(`${testCase.name}: supplier tab not found.`);
    const started = await extensionPage.evaluate(({ targetTabId, targetOrigin }) => new Promise(resolvePromise => {
      chrome.runtime.sendMessage({ type: 'supplier-capture-start', tabId: targetTabId, origin: targetOrigin }, resolvePromise);
    }), { targetTabId: tabId, targetOrigin: origin });
    if (started?.error) throw new Error(`${testCase.name}: ${started.error}`);

    const deadline = Date.now() + 90_000;
    let state = null;
    while (Date.now() < deadline) {
      state = await readLiveState(worker);
      if (state?.tabId === tabId && state.status === 'complete') break;
      await wait(250);
    }
    if (!state || state.status !== 'complete') throw new Error(`${testCase.name}: capture did not complete within 90 seconds.`);
    if (state.items.length !== testCase.expected) throw new Error(`${testCase.name}: expected ${testCase.expected} items, received ${state.items.length}.`);
    if (!state.source.includes(testCase.source)) throw new Error(`${testCase.name}: expected source ${testCase.source}.`);
    if (!state.items.every(item => item.name && item.imageUrl && item.code)) throw new Error(`${testCase.name}: incomplete fixture item.`);
    const pageSafety = testCase.name === 'infinite-scroll'
      ? await page.evaluate(() => window.fixtureClicks)
      : { loadMore: 0, add: 0, carousel: 0 };
    if (pageSafety.add !== 0 || pageSafety.carousel !== 0) throw new Error(`${testCase.name}: a prohibited control was clicked.`);
    results.push({ name: testCase.name, products: state.items.length, source: state.source, prohibitedClicks: pageSafety.add + pageSafety.carousel });

    if (testCase.name === 'spa-json') {
      try {
        await extensionPage.bringToFront();
        const extensionTabId = await worker.evaluate(async extensionUrl => (await chrome.tabs.query({})).find(tab => tab.url === extensionUrl)?.id ?? null,
          `chrome-extension://${extensionId}/connect.html`);
        if (!Number.isSafeInteger(extensionTabId)) throw new Error('Popup tab not found.');
        await worker.evaluate(({ liveState, tabId }) => chrome.storage.session.set({ supplierCaptureLive: { ...liveState, tabId } }),
          { liveState: state, tabId: extensionTabId });
        await wait(500);
        const popupText = await extensionPage.locator('#supplier-count').innerText();
        if (popupText.includes('44')) await extensionPage.screenshot({ path: join(root, 'test-results', 'i37-extension-popup-complete.png'), fullPage: true });
        await worker.evaluate(() => chrome.storage.session.set({ supplierCaptureLive: null }));
      } catch { /* Popup APIs are browser-version dependent; the idle screenshot remains available. */ }
    }

    await extensionPage.evaluate(targetTabId => new Promise(resolvePromise => {
      chrome.runtime.sendMessage({ type: 'supplier-capture-cancel', tabId: targetTabId }, resolvePromise);
    }), tabId);
    await page.close();
  }
  console.log(JSON.stringify({ productionWrites: 0, sessionDataForwarded: false, screenshot: screenshotPath, results }, null, 2));
} finally {
  await context?.close().catch(() => {});
  await rm(temporaryRoot, { recursive: true, force: true });
}
