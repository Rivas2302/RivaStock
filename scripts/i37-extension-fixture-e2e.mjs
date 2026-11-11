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
  manifest.host_permissions = [
    `${origin}/*`,
    'https://*.example.test/*',
    'https://brajamayorista.com/*',
    'https://*.brajamayorista.com/*',
    'https://res.cloudinary.com/*',
  ];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const extensionId = extensionIdFromManifestKey(manifest.key);
  const catalog = JSON.parse(await readFile(join(fixtures, 'spa-json.json'), 'utf8'));
  const infiniteFixture = await readFile(join(fixtures, 'infinite-scroll.html'), 'utf8');
  const wooFixture = await readFile(join(fixtures, 'woocommerce-dom.html'), 'utf8');
  const brajaFixture = await readFile(join(fixtures, 'braja-cross-subdomain-webp.html'), 'utf8');
  const genericProduct = index => `<article class="prod" data-sku="RDO-${String(index).padStart(4, '0')}"><span class="ceja">Iluminación</span><p class="nombre">Lámpara de demostración ${index}</p><div class="meta">Cód. RDO-${String(index).padStart(4, '0')} · Bulto x30</div><div class="precio"><span class="usd">USD 7,90 c/u</span><span class="ars">ARG $ 12.443 c/u</span></div><div class="bulto-precio">ARG $ 373.290 por bulto</div><div class="foto"><img width="320" height="240" src="https://res.cloudinary.com/demo/image/upload/f_auto,w_640/lamp-${index}.webp"><img class="mark" width="22" height="22" src="https://res.cloudinary.com/demo/image/upload/mark.png"></div></article>`;
  const genericProductTemplate = JSON.stringify(genericProduct(0));
  const genericCatalogHtml = `<!doctype html><html lang="es"><meta charset="utf-8"><body><nav class="rubros"><button type="button" data-category="all">Todos 450</button><button type="button" data-category="lighting">Iluminación</button><button type="button" data-category="audio">Audio</button></nav><main id="products">${Array.from({length:27},(_,index)=>genericProduct(index+1)).join('')}</main><button id="mas" type="button" style="display:none">Ver más productos</button><script>
    const template=${genericProductTemplate};
    const makeProduct=index=>template.replaceAll('RDO-0000','RDO-'+String(index).padStart(4,'0')).replaceAll('lamp-0','lamp-'+index).replaceAll('demostración 0','demostración '+index);
    const products=Array.from({length:450},(_,index)=>({index:index+1,html:makeProduct(index+1),category:index%2?'audio':'lighting'}));
    let shown=27,activeCategory='all';window.fixtureClicks={filters:0,loadMore:0,add:0,detail:0,carousel:0};
    const render=()=>{const visible=products.slice(0,shown).filter(item=>activeCategory==='all'||item.category===activeCategory);document.querySelector('#products').innerHTML=visible.map(item=>item.html.replaceAll('RDO-0000','RDO-'+String(item.index).padStart(4,'0')).replaceAll('lamp-0','lamp-'+item.index).replaceAll('demostración 0','demostración '+item.index)).join('');document.querySelector('#mas').style.display=activeCategory==='all'&&shown<450?'block':'none'};
    document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{window.fixtureClicks.filters++;activeCategory=button.dataset.category;render()}));
    document.querySelector('#mas').addEventListener('click',()=>{window.fixtureClicks.loadMore++;shown=Math.min(450,shown+60);render()});
    document.addEventListener('click',event=>{if(event.target.closest('form'))window.fixtureClicks.add++});
    </script></body></html>`;
  let allowLiveBrajaRequests = false;

  context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run', '--no-default-browser-check'],
  });
  await context.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname === 'brajamayorista.com' || (requestUrl.hostname === 'api.brajamayorista.com' && allowLiveBrajaRequests)) return route.continue();
    if (requestUrl.hostname === 'images.example.test' || requestUrl.hostname === 'api.brajamayorista.com') {
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
    if (requestUrl.pathname === '/braja/category-31') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: brajaFixture });
    }
    if (requestUrl.pathname === '/generic-hidden-load-more') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: genericCatalogHtml });
    }
    if (requestUrl.pathname === '/mayori/electrobh/index.php') {
      const productCard = (pageNumber, itemNumber) => {
        const code = `EHB-${String(pageNumber).padStart(2,'0')}-${String(itemNumber).padStart(3,'0')}`;
        return `<div class="item open_detail" data-id="qa-${pageNumber}-${itemNumber}"><a class="image"><img loading="lazy" src="/images/${code}.webp" alt=""></a><div class="content"><div class="header">Producto demostración ${pageNumber}-${itemNumber}</div><div class="meta"><span class="category">Accesorios</span><span class="brand">Marca Demo</span><span><i class="code icon"></i>${code}</span></div><div class="list_description">Texto fijo de demostración</div><div class="ui labeled button"><div class="ui basic right pointing label">$ 4.043,07</div><button class="ui add_to_cart button" type="button">Agregar</button></div></div></div>`;
      };
      const pageMarkup = pageNumber => Array.from({length:50},(_,index)=>productCard(pageNumber,index+1)).join('');
      const pageLinks = Array.from({length:14},(_,index)=>`<a class="item" rel="${index+1}" href="#productos_page-${index+1}">${index+1}</a>`).join('');
      const pages = JSON.stringify(Object.fromEntries(Array.from({length:14},(_,index)=>[index+1,pageMarkup(index+1)])));
      const html = `<!doctype html><html lang="es"><body><main class="ui items">${pageMarkup(1)}</main><nav class="ui pagination menu">${pageLinks}</nav><script>
        const productPages=${pages};
        window.fixtureClicks={add:0,detail:0,pagination:0};
        document.addEventListener('click',event=>{
          if(event.target.closest('.add_to_cart'))window.fixtureClicks.add++;
          if(event.target.closest('.item.open_detail'))window.fixtureClicks.detail++;
          if(event.target.closest('.ui.pagination.menu a[rel]'))window.fixtureClicks.pagination++;
        },true);
        let currentPage=1;
        document.querySelectorAll('.ui.pagination.menu a.item[rel]').forEach(anchor=>anchor.addEventListener('click',event=>{
          const targetPage=Number(anchor.rel);
          if(targetPage!==currentPage+1)return;
          event.preventDefault();location.hash='productos_page-'+targetPage;currentPage=targetPage;
          document.querySelector('.ui.items').innerHTML=productPages[targetPage];
        }));
      </script></body></html>`;
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    if (requestUrl.pathname.startsWith('/images/')) {
      return route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.from('fixture-image') });
    }
    return route.fulfill({ status: 404, body: 'Not found' });
  });

  const worker = await waitForWorker(context, extensionId);
  const extensionPage = await context.newPage();
  await extensionPage.setViewportSize({ width: 390, height: 760 });
  await extensionPage.goto(`chrome-extension://${extensionId}/connect.html`);
  await extensionPage.locator('#supplier-start').waitFor({ state: 'visible' });
  await extensionPage.waitForFunction(() => document.querySelector('#version')?.textContent?.startsWith('Versión 0.6.5 · actualizada automáticamente'));
  if (!(await extensionPage.locator('.brand p').innerText()).includes('Importar listas de proveedores')) {
    throw new Error('The supplier import popup title is missing.');
  }
  const screenshotPath = join(root, 'test-results', 'i37-fixture-extension-popup.png');
  await mkdir(dirname(screenshotPath), { recursive: true });
  await extensionPage.locator('section.supplier-import').screenshot({ path: screenshotPath });

  const cases = [
    { name: 'spa-json', path: '/spa-json', expected: 44, source: 'network-json' },
    { name: 'infinite-scroll', path: '/infinite-scroll', expected: 4, source: 'dom-cards' },
    { name: 'generic-hidden-load-more', path: '/generic-hidden-load-more', expected: 450, source: 'dom-cards' },
    { name: 'woocommerce-dom', path: '/woocommerce-dom', expected: 3, source: 'dom-cards' },
    { name: 'braja-cross-subdomain-webp', path: '/braja/category-31', expected: 5, source: 'dom-cards' },
    { name: 'braja-live-category-31', origin: 'https://brajamayorista.com', path: '/tienda/centro/productos?categoria=31', expected: 5, source: 'dom-cards' },
    { name: 'mayori-electrobh-14-pages', path: '/mayori/electrobh/index.php#productos_page-1', expected: 700, source: 'dom-cards' },
  ];
  const requestedCase = process.env.RIVASTOCK_EXTENSION_E2E_CASE;
  const activeCases = requestedCase ? cases.filter(testCase => testCase.name === requestedCase) : cases;
  if (requestedCase && activeCases.length === 0) throw new Error('Unknown extension fixture case.');
  const results = [];
  for (const testCase of activeCases) {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
    const testOrigin = testCase.origin ?? origin;
    allowLiveBrajaRequests = testCase.name === 'braja-live-category-31';
    const pageUrl = `${testOrigin}${testCase.path}`;
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    if (testCase.name === 'generic-hidden-load-more') {
      await page.addScriptTag({ content: await readFile(join(root, 'extensions', 'shared', 'product-extract.js'), 'utf8') });
      const parsedPage = await page.evaluate(() => ({ result: globalThis.RivaStockProductExtract.readPage(document), direct: globalThis.RivaStockProductExtract.extractSupplierProducts({ pageText: Array.from(document.querySelectorAll('button')).map(button => button.textContent).join(' ') }).reportedTotal, texts: Array.from(document.querySelectorAll('button')).map(button => button.textContent) }));
      if (parsedPage.result.reportedTotal !== 450) throw new Error(`generic-hidden-load-more: extractor reported total ${parsedPage.result.reportedTotal}; direct=${parsedPage.direct}; texts=${JSON.stringify(parsedPage.texts)}.`);
    }
    const tabId = await worker.evaluate(async targetUrl => (await chrome.tabs.query({})).find(tab => tab.url === targetUrl)?.id ?? null, pageUrl);
    if (!Number.isSafeInteger(tabId)) throw new Error(`${testCase.name}: supplier tab not found.`);
    await page.bringToFront();
    const started = await extensionPage.evaluate(({ targetTabId, targetOrigin }) => new Promise(resolvePromise => {
      chrome.runtime.sendMessage({ type: 'supplier-capture-start', tabId: targetTabId, origin: targetOrigin }, resolvePromise);
    }), { targetTabId: tabId, targetOrigin: testOrigin });
    if (started?.error) throw new Error(`${testCase.name}: ${started.error}`);

    const readyStatuses = testCase.name === 'braja-live-category-31' ? ['complete', 'categories-available'] : ['complete'];
    const deadline = Date.now() + (testCase.name === 'mayori-electrobh-14-pages' ? 180_000
      : testCase.name.startsWith('braja-') ? 45_000 : 90_000);
    let state = null;
    while (Date.now() < deadline) {
      state = await readLiveState(worker);
      if (state?.tabId === tabId && readyStatuses.includes(state.status)) break;
      await wait(250);
    }
    if (!state || !readyStatuses.includes(state.status)) {
      const scrollState = await page.evaluate(() => ({
        y: window.scrollY, height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
        viewport: window.innerHeight, cards: document.querySelectorAll('.product-card').length,
      })).catch(() => null);
      throw new Error(`${testCase.name}: capture did not complete (status=${state?.status ?? 'none'}, products=${state?.items?.length ?? 0}, pages=${state?.pagesVisited?.length ?? 0}, scroll=${JSON.stringify(scrollState)}, pageErrors=${JSON.stringify(pageErrors)}).`);
    }
    if (state.items.length !== testCase.expected) {
      const fixtureState = testCase.name === 'generic-hidden-load-more'
        ? await page.evaluate(() => ({ clicks: window.fixtureClicks, visibleCards: document.querySelectorAll('[data-sku]').length, moreDisplay: getComputedStyle(document.querySelector('#mas')).display, controls: Array.from(document.querySelectorAll('button')).map(button=>button.textContent) }))
        : testCase.name === 'mayori-electrobh-14-pages'
          ? await page.evaluate(() => ({ clicks: window.fixtureClicks, hash: location.hash, visibleCards: document.querySelectorAll('.item.open_detail[data-id]').length, sample: [...document.querySelectorAll('.item.open_detail[data-id] .header')].slice(0, 3).map(node => node.textContent) })) : null;
      throw new Error(`${testCase.name}: expected ${testCase.expected} items, received ${state.items.length}; total=${state.reportedTotal}; clicks=${state.clicksUsed}; pages=${JSON.stringify(state.pagesVisited)}; last=${state.lastPageUrl}; sample=${JSON.stringify(state.items.slice(0, 3).map(item => ({ code: item.code, name: item.name, key: item.key })))}; warnings=${JSON.stringify(state.warnings)}; fixture=${JSON.stringify(fixtureState)}.`);
    }
    if (!state.source.includes(testCase.source)) throw new Error(`${testCase.name}: expected source ${testCase.source}.`);
    if (!state.items.every(item => item.name && item.imageUrl && item.code)) throw new Error(`${testCase.name}: incomplete fixture item.`);
    if (testCase.name === 'generic-hidden-load-more' && (!state.items.every(item => item.currency === 'ARS' && item.price === 12443
      && item.imageUrl.startsWith('https://res.cloudinary.com/') && !item.imageUrl.includes('mark.png') && item.packSize === 30 && item.packPrice === 373290)
      || state.reportedTotal !== 450)) {
      throw new Error(`${testCase.name}: price, photo, category, pack, or reported total was misread.`);
    }
    if (testCase.name === 'braja-live-category-31' && !state.items.every(item => item.imageUrl.startsWith('https://api.brajamayorista.com/uploads/derivados/') && item.imageUrl.endsWith('.webp'))) {
      throw new Error(`${testCase.name}: captured images do not point to the HTTPS WebP subdomain.`);
    }
    if (testCase.name === 'mayori-electrobh-14-pages'
      && !state.items.every(item => item.brand && item.category && item.price === 4043.07)) {
      throw new Error(`${testCase.name}: an item is missing brand/category or its unit price was misread.`);
    }
    const pageSafety = testCase.name === 'infinite-scroll'
      ? await page.evaluate(() => window.fixtureClicks)
      : testCase.name === 'generic-hidden-load-more'
        ? await page.evaluate(() => window.fixtureClicks)
      : testCase.name === 'mayori-electrobh-14-pages'
        ? await page.evaluate(() => window.fixtureClicks)
      : { loadMore: 0, add: 0, carousel: 0 };
    if (pageSafety.add !== 0 || (pageSafety.carousel ?? 0) !== 0 || (pageSafety.detail ?? 0) !== 0
      || (testCase.name === 'generic-hidden-load-more' && (pageSafety.loadMore < 7 || pageSafety.filters < 2))
      || (testCase.name === 'mayori-electrobh-14-pages' && pageSafety.pagination !== 13)) {
      throw new Error(`${testCase.name}: a prohibited control was clicked or safe pagination did not advance.`);
    }
    let liveImageReads = 0;
    if (testCase.name === 'braja-live-category-31') {
      const captureId = 'a1b2c3d4-e5f6-4789-a012-123456789abc';
      await worker.evaluate(({ id, capture }) => chrome.storage.local.set({ supplierProductCaptures: {
        [id]: { origin: capture.origin, capturedAt: new Date().toISOString(), expiresAt: Date.now() + 60_000,
          source: capture.source, warnings: capture.warnings, items: capture.items },
      } }), { id: captureId, capture: state });
      const imageResults = await extensionPage.evaluate(({ id, imageUrls }) => Promise.all(imageUrls.map(imageUrl => new Promise(resolvePromise => {
        chrome.runtime.sendMessage({ type: 'supplier-capture-read-image', captureId: id, imageUrl }, resolvePromise);
      }))), { id: captureId, imageUrls: state.items.map(item => item.imageUrl) });
      if (imageResults.length !== 5 || imageResults.some(result => result.error || result.mimeType !== 'image/webp' || !Number.isSafeInteger(result.size) || result.size < 1)) {
        throw new Error(`${testCase.name}: the extension could not read every real WebP image (${JSON.stringify(imageResults.map(result => result.error ?? { mimeType: result.mimeType, size: result.size }))}).`);
      }
      liveImageReads = imageResults.length;
      await worker.evaluate(async id => {
        const stored = await chrome.storage.local.get('supplierProductCaptures');
        const captures = stored.supplierProductCaptures ?? {};
        delete captures[id];
        await chrome.storage.local.set({ supplierProductCaptures: captures });
      }, captureId);
    }
    results.push({ name: testCase.name, products: state.items.length, source: state.source, liveImageReads,
      prohibitedClicks: pageSafety.add + (pageSafety.carousel ?? 0) + (pageSafety.detail ?? 0),
      paginationClicks: pageSafety.pagination ?? 0 });

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
