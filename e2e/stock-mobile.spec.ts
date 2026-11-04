import { expect, test, type Page, type Route } from '@playwright/test';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_URL = 'https://rivastock-test.invalid';
const now = new Date().toISOString();

function fixtureSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: OWNER_ID, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token',
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: OWNER_ID, email: 'mobile-stock@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: now },
  };
}

function product(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user_id: OWNER_ID,
    name: `Producto ${id}`,
    category_id: 'category-general',
    category: 'General',
    purchase_price: 100,
    sale_price: 250,
    stock: 5,
    min_stock: 2,
    show_in_catalog: true,
    barcode: null,
    image_url: null,
    images: [],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function productsFixture() {
  return [
    product('camera', { name: '[QA] Cámara WiFi 360', category: 'Cámaras', barcode: '7790070123456', stock: 1, images: [
      'https://rivastock-test.invalid/storage/v1/object/public/assets/camera-a.webp',
      'https://rivastock-test.invalid/storage/v1/object/public/assets/camera-b.webp',
    ] }),
    product('cable', { name: '[QA] Cable iPhone C', category: 'Cargadores', stock: 0 }),
    ...Array.from({ length: 32 }, (_, index) => product(`bulk-${String(index + 1).padStart(2, '0')}`, {
      name: `[QA] Producto ${String(index + 1).padStart(2, '0')}`,
    })),
  ];
}

async function mockStock(page: Page, rows = productsFixture()) {
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });

    const path = url.pathname;
    if (path === '/auth/v1/user') return route.fulfill({ json: fixtureSession().user });
    if (path.endsWith('/rpc/get_owner_profile')) return route.fulfill({ json: [{
      id: OWNER_ID,
      role: 'admin',
      business_name: 'Negocio QA',
      business_name_lower: 'negocio qa',
      display_name: 'Dueño QA',
      currency_symbol: '$',
      catalog_slug: 'qa-catalog',
      dark_mode: false,
      onboarding_completed_at: now,
      created_at: now,
    }] });
    if (path.endsWith('/rpc/is_platform_admin')) return route.fulfill({ json: false });
    if (path.endsWith('/rpc/my_business_plan')) return route.fulfill({ json: {
      plan_code: 'pro', plan_name: 'RivaStock IA', status: 'active', limits: { modules: { ai: true, knowledge: true, automation: true } },
    } });
    if (path.endsWith('/rpc/get_public_catalog_products') || path.endsWith('/rpc/get_public_inventory_owner_labels')) return route.fulfill({ json: [] });
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '');
      if (table === 'products') return route.fulfill({ json: rows });
      if (table === 'categories') return route.fulfill({ json: [
        { id: 'category-general', user_id: OWNER_ID, name: 'General' },
        { id: 'category-camera', user_id: OWNER_ID, name: 'Cámaras' },
        { id: 'category-chargers', user_id: OWNER_ID, name: 'Cargadores' },
      ] });
      if (table === 'inventory_operation_settings') return route.fulfill({ json: { holdings_enabled: false } });
      if (table === 'profiles') return route.fulfill({ json: [{ id: OWNER_ID, business_name: 'Negocio QA', onboarding_completed_at: now }] });
      return route.fulfill({ json: [] });
    }
    if (path.startsWith('/storage/v1/object/public/assets/')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVb8AAAAASUVORK5CYII=', 'base64') });
    }
    if (path.endsWith('/rpc/list_inventory_movements')) return route.fulfill({ json: [] });
    if (path.endsWith('/rpc/')) return route.fulfill({ json: null });
    return route.fulfill({ json: [] });
  });

  await page.addInitScript((session) => localStorage.setItem('rivastock-auth', JSON.stringify(session)), fixtureSession());
}

test('mobile stock: search, filters in URL, counts, sheet actions and 30-row pagination', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock touch flows run in Android and iPhone projects.');
  await mockStock(page);
  await page.goto('/stock');
  const list = page.getByRole('list', { name: 'Productos en stock' });
  await expect(list.getByRole('listitem')).toHaveCount(30);
  await expect(page.getByRole('button', { name: 'Ver más (4)' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver más (4)' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(34);

  const search = page.getByRole('searchbox', { name: 'Buscar por nombre, código o titular' });
  await search.fill('wifi camara');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Abrir ficha de [QA] Cámara WiFi 360' })).toBeVisible();
  await expect(page).toHaveURL(/q=wifi\+camara/);

  await search.fill('7790070123456');
  await expect(page.getByRole('button', { name: 'Abrir ficha de [QA] Cámara WiFi 360' })).toBeVisible();
  await search.fill('');

  const filters = page.getByRole('button', { name: /^Abrir filtros/ });
  await filters.click();
  const sheet = page.getByRole('dialog', { name: 'Filtros de stock' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Stock bajo' }).click();
  await expect(page).toHaveURL(/estado=bajo/);
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Ver 1 productos' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  await page.getByRole('button', { name: 'Más acciones de stock' }).click();
  const actions = page.getByRole('dialog', { name: 'Acciones de stock' });
  await expect(actions.getByRole('button', { name: /Lista revendedores/ })).toBeVisible();
  await expect(actions.getByRole('button', { name: /Historial de movimientos/ })).toBeVisible();
  await actions.getByRole('button', { name: /Historial de movimientos/ }).click();
  const movements = page.getByRole('dialog', { name: 'Historial de movimientos' });
  await expect(movements).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(movements).toHaveCount(0);
});

test('mobile stock shows a clear empty state and filters remain available', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock touch flows run in Android and iPhone projects.');
  await mockStock(page, []);
  await page.goto('/stock');
  await expect(page.getByText('Todavía no cargaste productos', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar producto' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Abrir filtros/ })).toBeVisible();
});

test('mobile stock restores the URL filters and list scroll after returning from a product', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock touch flows run in Android and iPhone projects.');
  await mockStock(page);
  await page.goto('/stock?q=producto');
  const list = page.getByRole('list', { name: 'Productos en stock' });
  await expect(list.getByRole('listitem')).toHaveCount(30);
  await page.getByRole('button', { name: 'Ver más (2)' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(32);

  const scrollContainer = page.locator('.app-content');
  await scrollContainer.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => scrollContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const savedScrollTop = await scrollContainer.evaluate((element) => element.scrollTop);

  await page.getByRole('button', { name: 'Abrir ficha de [QA] Producto 32' }).click();
  await expect(page).toHaveURL(/producto=bulk-32/);
  await page.getByRole('button', { name: 'Volver al stock' }).click();
  await expect(page).toHaveURL(/q=producto/);
  await expect(page.getByRole('button', { name: 'Abrir ficha de [QA] Producto 32' })).toBeVisible();
  await expect.poll(() => scrollContainer.evaluate((element) => element.scrollTop)).toBe(savedScrollTop);
});

test('mobile product detail opens from stock with photos, stock actions, and accessible delete confirmation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock touch flows run in Android and iPhone projects.');
  await mockStock(page);
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Abrir ficha de [QA] Cámara WiFi 360' }).click();

  await expect(page).toHaveURL(/producto=camera/);
  await expect(page.getByRole('region', { name: 'Ficha de [QA] Cámara WiFi 360' })).toBeVisible();
  await expect(page.getByText('1 / 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Foto siguiente' }).click();
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vender' })).toBeVisible();

  await page.getByRole('button', { name: 'Más acciones del producto' }).click();
  const menu = page.getByRole('dialog', { name: 'Acciones del producto' });
  await expect(menu.getByRole('button', { name: 'Copiar enlace del catálogo' })).toBeVisible();
  await menu.getByRole('button', { name: 'Eliminar producto' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Eliminar producto' });
  await expect(confirmation).toContainText('Se borra el producto y sus fotos. No se puede deshacer.');
  await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
});

test('mobile product detail routes to POS once and opens Buscar y enviar on the selected product', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock touch flows run in Android and iPhone projects.');
  await mockStock(page);
  await page.goto('/stock?producto=camera');
  await expect(page.getByRole('region', { name: 'Ficha de [QA] Cámara WiFi 360' })).toBeVisible();
  await page.getByRole('button', { name: 'Vender' }).click();
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByText('[QA] Cámara WiFi 360', { exact: true })).toBeVisible();
  await expect(page.getByText('El carrito está vacío')).toHaveCount(0);

  await page.goto('/fotos?producto=camera');
  await expect(page.getByRole('dialog', { name: 'Producto [QA] Cámara WiFi 360' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar producto' }).click();
  await expect(page).toHaveURL(/\/fotos$/);
});

test('mobile product detail shows a safe not-found state for an unknown business product', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock touch flows run in Android and iPhone projects.');
  await mockStock(page);
  await page.goto('/stock?producto=not-owned');
  await expect(page.getByRole('heading', { name: 'No encontramos ese producto' })).toBeVisible();
  await page.getByRole('button', { name: 'Volver al stock' }).click();
  await expect(page).toHaveURL(/\/stock$/);
  await page.goto('/stock?producto=cable');
  const sellButton = page.getByRole('button', { name: 'Sin stock', exact: true });
  await expect(sellButton).toBeDisabled();
  await expect(page.getByText('Cargadores · Sin código', { exact: true })).toBeVisible();
});

test('desktop Stock keeps its table and does not render the mobile list', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop Stock regression runs in Chromium only.');
  await mockStock(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/stock');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Stock móvil' })).toHaveCount(0);
  await page.goto('/stock?producto=camera');
  await expect(page.getByRole('dialog', { name: 'Editar Producto' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Eliminar [QA] Cámara WiFi 360' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Eliminar producto' });
  await expect(deleteDialog).toContainText('Se borra el producto y sus fotos. No se puede deshacer.');
  await deleteDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(deleteDialog).toHaveCount(0);
});
