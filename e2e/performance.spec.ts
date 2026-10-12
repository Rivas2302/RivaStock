import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ownerId = '00000000-0000-4000-8000-000000000001';
const primaryOwner = '00000000-0000-4000-8000-000000000002';
const today = new Date().toISOString().slice(0, 10);
const profile = { id: ownerId, email: 'owner@example.test', display_name: 'Test Owner', business_name: 'Fixture Shop', currency_symbol: '$', role: 'admin', dark_mode: false };

async function fixture(page: Page, count: number, authenticated = true, saleCount = 0) {
  const products = Array.from({ length: count }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    user_id: ownerId, name: `Product ${String(index + 1).padStart(5, '0')}`,
    category_id: 'general', category: 'General', sale_price: 200, purchase_price: 100,
    stock: 3, min_stock: 2, show_in_catalog: true, catalog_only: false,
    created_at: today, updated_at: today, inventory_owner_id: primaryOwner, images: [],
  }));
  const sales = Array.from({ length: saleCount }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    user_id: ownerId, date: today, status: 'Pagado', product_id: products[index % count].id,
    product_name: products[index % count].name, quantity: 1, unit_price: 200, total: 200,
    adjustment: 0, payment_method: 'Efectivo', client: `Customer ${index + 1}`, created_at: `${today}T12:00:00Z`,
  }));
  const catalogConfig = { id: 'config', user_id: ownerId, slug: 'fixture', enabled: true, business_name: 'Fixture Shop', show_prices: true, show_out_of_stock: true, accent_color: '#6366f1', whatsapp_number: '', layout: 'grid' };
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Isolate fixtures from external fonts, images and any accidentally live APIs.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.abort();
    requests.push(url.pathname + url.search);
    const name = url.pathname.split('/').pop()!;
    let result: unknown = [];
    if (url.pathname.includes('/rpc/')) {
      const args = route.request().postDataJSON() ?? {};
      if (name === 'get_owner_profile') result = [profile];
      if (name === 'get_public_catalog_products') result = products.map(product => ({ id: product.id, name: product.name, categoryId: 'general', category: 'General', salePrice: 200, stock: 3, images: [], availability: 'in_stock' }));
      if (name === 'get_public_catalog_product') {
        const product = products.find(product => product.id === args.p_product_id);
        result = product ? { id: product.id, name: product.name, salePrice: 200, stock: 3, images: [], availability: 'in_stock' } : null;
      }
      if (name === 'get_reseller_catalog_status') result = { enabled: false };
      if (name === 'get_sales_report') result = { kpis: {}, daily: [], byPayment: [], topProducts: [], sales: [], range: { from: today, to: today } };
    } else {
      const tables: Record<string, unknown> = {
        products, sales,
        categories: [{ id: 'general', user_id: ownerId, name: 'General' }],
        price_ranges: [], catalog_config: [catalogConfig],
        inventory_owners: [{ id: primaryOwner, user_id: ownerId, name: 'Main', is_primary: true, sort_order: 0 }],
        inventory_owner_memberships: [{ inventory_owner_id: primaryOwner, is_default: true, can_operate: true }],
        inventory_operation_settings: [{ holdings_enabled: false }],
      };
      result = tables[name] ?? [];
      if (name === 'sales' && url.searchParams.has('id')) {
        const cursor = url.searchParams.get('id')!.replace(/^gt\./, '');
        result = sales.filter(sale => sale.id > cursor);
      }
      if (route.request().headers().accept?.includes('application/vnd.pgrst.object+json')) {
        result = Array.isArray(result) ? result[0] ?? null : result;
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  if (authenticated) {
    await page.addInitScript(({ id, email }) => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      localStorage.setItem('rivastock-auth', JSON.stringify({
        access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp, role: 'authenticated' })}.fixture`,
        refresh_token: 'fixture-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer',
        user: { id, email, email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() },
      }));
    }, { id: ownerId, email: profile.email });
  }
  return { requests, errors };
}

for (const count of [100, 1_000, 10_000]) {
  test(`stock renders bounded rows and searches the full ${count}-product fixture`, async ({ page }, testInfo) => {
    const { requests, errors } = await fixture(page, count);
    const start = Date.now();
    await page.goto('/stock');
    await expect(page.getByRole('heading', { name: 'Gestión de Stock', exact: true })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(50);
    await expect(page.getByRole('navigation', { name: 'Paginación' })).toContainText(`de ${count}`);
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Paginación' })).toContainText('51–100');
    await page.getByPlaceholder(/Buscar/).first().fill(`Product ${String(count).padStart(5, '0')}`);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    expect(errors).toEqual([]);
    expect(requests.some(url => url.includes('sales') && url.includes('status=eq.Pagado') && url.includes('date=gte.'))).toBe(true);
    await testInfo.attach('fixture-render.json', { body: JSON.stringify({ count, durationMs: Date.now() - start, requests: requests.length, domNodes: await page.locator('*').count() }), contentType: 'application/json' });
  });
}

test('public detail requests a single product, never the whole catalog', async ({ page }) => {
  const { requests, errors } = await fixture(page, 10_000, false);
  await page.goto('/catalogo/fixture/10000000-0000-4000-8000-000000010000');
  await expect(page.getByRole('heading', { name: 'Product 10000' })).toBeVisible();
  expect(requests.some(url => url.includes('/rpc/get_public_catalog_product?') || url.endsWith('/rpc/get_public_catalog_product'))).toBe(true);
  expect(requests.some(url => url.includes('/rpc/get_public_catalog_products'))).toBe(false);
  expect(errors).toEqual([]);
});

test('sales pagination preserves full totals and full-file export', async ({ page }) => {
  await fixture(page, 100, true, 123);
  await page.goto('/ventas');
  await expect(page.locator('tbody > tr')).toHaveCount(50);
  const totalCard = page.locator('.operational-card').filter({ hasText: 'Total Vendido' });
  await expect(totalCard).toContainText('24.600');
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.locator('tbody > tr')).toHaveCount(23);
  await expect(totalCard).toContainText('24.600');
  await page.getByRole('button', { name: /Exportar$/, exact: false }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar Excel (.xlsx)' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^ventas-.*\.xlsx$/);
  const { read, utils } = await import('xlsx');
  const workbook = read(readFileSync((await file.path())!), { type: 'buffer' });
  const rows = utils.sheet_to_json<unknown[]>(workbook.Sheets.Ventas, { header: 1 });
  // Four summary rows + spacer + header, then all 123 sales, not 23 displayed rows.
  expect(rows).toHaveLength(129);
});

test('main operational modules load without runtime errors on a production build', async ({ page }) => {
  const { errors } = await fixture(page, 100);
  for (const path of ['/', '/ventas', '/pos', '/consulta-rapida', '/clientes', '/presupuestos', '/caja', '/pedidos', '/trazabilidad', '/reportes', '/ingresos', '/proveedores', '/config']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
    await expect(page).not.toHaveURL(/\/login$/);
  }
  expect(errors).toEqual([]);
});

test('login does not eagerly download charts, scanner, Excel or PDF tooling', async ({ page }) => {
  await fixture(page, 100, false);
  const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8')) as Record<string, { file: string; name?: string }>;
  const optionalFiles = Object.entries(manifest)
    .filter(([key, chunk]) => chunk.name === 'charts-vendor' || /node_modules\/(xlsx|jspdf|jspdf-autotable|@zxing)\//.test(key))
    .map(([, chunk]) => chunk.file);
  const downloaded: string[] = [];
  page.on('request', request => downloaded.push(request.url()));
  await page.goto('/login');
  await expect(page.locator('form')).toBeVisible();
  for (const file of optionalFiles) expect(downloaded.some(url => url.endsWith(file))).toBe(false);
});

test('mobile production fixture records cold and warm stock rendering metrics', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors, requests } = await fixture(page, 10_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 200_000, uploadThroughput: 100_000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    const metrics = { lcpMs: 0, cls: 0, longTasks: 0, longTaskMs: 0, maxObservedInteractionMs: 0 };
    let shiftWindowStart = 0;
    let shiftWindowLast = 0;
    let shiftWindowValue = 0;
    (window as unknown as { fixtureMetrics: typeof metrics }).fixtureMetrics = metrics;
    for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask', 'event']) {
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const value = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number; interactionId?: number };
            if (type === 'largest-contentful-paint') metrics.lcpMs = entry.startTime;
            if (type === 'layout-shift' && !value.hadRecentInput) {
              if (entry.startTime - shiftWindowLast < 1000 && entry.startTime - shiftWindowStart < 5000) {
                shiftWindowValue += value.value ?? 0;
              } else {
                shiftWindowStart = entry.startTime;
                shiftWindowValue = value.value ?? 0;
              }
              shiftWindowLast = entry.startTime;
              metrics.cls = Math.max(metrics.cls, shiftWindowValue);
            }
            if (type === 'longtask') { metrics.longTasks++; metrics.longTaskMs += entry.duration; }
            if (type === 'event' && value.interactionId) metrics.maxObservedInteractionMs = Math.max(metrics.maxObservedInteractionMs, entry.duration);
          }
        }).observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
      } catch { /* Unsupported metrics remain unavailable in this browser. */ }
    }
  });
  await page.goto('/stock');
  await expect(page.locator('tbody tr')).toHaveCount(50, { timeout: 20_000 });
  const coldUsefulRenderMs = await page.evaluate(() => performance.now());
  await page.getByPlaceholder(/Buscar/).first().fill('Product 10000');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.locator('main nav').getByRole('link', { name: 'Ventas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ventas', exact: true })).toBeVisible();
  const warmStart = Date.now();
  await page.locator('main nav').getByRole('link', { name: 'Stock', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(50);
  const warmUsefulRenderMs = Date.now() - warmStart;
  const metrics = await page.evaluate(() => ({
    ...(window as unknown as { fixtureMetrics: Record<string, number> }).fixtureMetrics,
    supportedMetricTypes: PerformanceObserver.supportedEntryTypes,
    fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    resources: performance.getEntriesByType('resource').map(entry => {
      const resource = entry as PerformanceResourceTiming;
      return { name: resource.name, bytes: resource.transferSize, durationMs: resource.duration };
    }),
    domNodes: document.querySelectorAll('*').length,
  }));
  const result = { environment: 'local production build, mocked Supabase, 10k products, 390x844, 100ms latency, 1.6Mbps, 4x CPU', coldUsefulRenderMs, warmUsefulRenderMs, requests: requests.length, ...metrics };
  await testInfo.attach('mobile-performance.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  console.log('Mobile fixture:', JSON.stringify({ coldUsefulRenderMs, warmUsefulRenderMs, lcpMs: metrics.lcpMs, cls: metrics.cls, domNodes: metrics.domNodes }));
  expect(errors).toEqual([]);
});
