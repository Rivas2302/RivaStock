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
    user: { id: OWNER_ID, email: 'mobile-stock@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Dueño QA', password_set: true }, created_at: now },
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

interface StockFixtureOptions {
  automation?: boolean;
  planStatus?: 'active' | 'suspended';
  collaboratorReadOnly?: boolean;
  holdingsEnabled?: boolean;
}

async function mockStock(page: Page, rows = productsFixture(), options: StockFixtureOptions = {}) {
  const savedHoldingDrafts: Record<string, unknown>[][] = [];
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
    if (path.endsWith('/rpc/save_product_with_holdings')) {
      const input = route.request().postDataJSON() as { p_product: Record<string, unknown>; p_holdings: Record<string, unknown>[] };
      savedHoldingDrafts.push(input.p_holdings);
      return route.fulfill({ json: {
        product: input.p_product,
        holdings: input.p_holdings.map((holding) => ({
          ...holding,
          user_id: OWNER_ID,
          product_id: input.p_product.id,
          created_at: now,
          updated_at: now,
        })),
      } });
    }
    if (path.endsWith('/rpc/my_business_plan')) return route.fulfill({ json: {
      plan_code: options.automation === false ? 'base' : 'pro',
      plan_name: options.automation === false ? 'RivaStock' : 'RivaStock IA',
      status: options.planStatus ?? 'active',
      limits: { modules: { ai: options.automation !== false, knowledge: options.automation !== false, automation: options.automation !== false } },
    } });
    if (path.endsWith('/rpc/get_public_catalog_products') || path.endsWith('/rpc/get_public_inventory_owner_labels')) return route.fulfill({ json: [] });
    if (path.endsWith('/rpc/adjust_product_stock')) {
      const input = route.request().postDataJSON() as {
        p_product_id: string; p_mode: 'add' | 'remove' | 'count'; p_quantity: number; p_reason: string; p_idempotency_key: string;
      };
      const target = rows.find((item) => item.id === input.p_product_id);
      if (!target) return route.fulfill({ status: 400, json: { message: 'Product not found' } });
      const delta = input.p_mode === 'add' ? input.p_quantity : input.p_mode === 'remove' ? -input.p_quantity : input.p_quantity - Number(target.stock);
      if (delta === 0) return route.fulfill({ json: null });
      target.stock = Number(target.stock) + delta;
      return route.fulfill({ json: {
        id: `command-${input.p_idempotency_key}`,
        user_id: OWNER_ID,
        idempotency_key: input.p_idempotency_key,
        product_id: target.id,
        product_name: target.name,
        inventory_owner_id: 'owner-default',
        inventory_owner_name: 'Depósito principal',
        actor_uid: OWNER_ID,
        delta,
        reason: `Ajuste manual · ${input.p_reason}`,
        resulting_stock: Number(target.stock),
        created_at: now,
      } });
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '');
      if (table === 'products') {
        const method = route.request().method();
        if (method === 'POST') {
          const created = route.request().postDataJSON() as Record<string, unknown>;
          rows.push(created);
          return route.fulfill({ status: 201, json: created });
        }
        if (method === 'PATCH') {
          const idFilter = url.searchParams.get('id') ?? '';
          const targetId = idFilter.replace(/^eq\./, '');
          const target = rows.find((item) => item.id === targetId);
          if (!target) return route.fulfill({ status: 404, json: { message: 'Product not found' } });
          Object.assign(target, route.request().postDataJSON());
          return route.fulfill({ json: target });
        }
        if (method === 'DELETE') {
          const idFilter = url.searchParams.get('id') ?? '';
          const targetId = idFilter.replace(/^eq\./, '');
          const index = rows.findIndex((item) => item.id === targetId);
          if (index >= 0) rows.splice(index, 1);
          return route.fulfill({ status: 204, body: '' });
        }
        return route.fulfill({ json: rows });
      }
      if (table === 'categories') return route.fulfill({ json: [
        { id: 'category-general', user_id: OWNER_ID, name: 'General' },
        { id: 'category-camera', user_id: OWNER_ID, name: 'Cámaras' },
        { id: 'category-chargers', user_id: OWNER_ID, name: 'Cargadores' },
      ] });
      if (table === 'inventory_operation_settings') return route.fulfill({ json: { holdings_enabled: options.holdingsEnabled ?? false } });
      if (table === 'inventory_owners') return route.fulfill({ json: [
        { id: 'owner-default', user_id: OWNER_ID, name: 'Depósito principal', is_primary: true, sort_order: 0 },
        { id: 'owner-secondary', user_id: OWNER_ID, name: 'Segundo titular', is_primary: false, sort_order: 1 },
      ] });
      if (table === 'inventory_owner_memberships') return route.fulfill({ json: [
        { id: 'membership-default', user_id: OWNER_ID, actor_uid: OWNER_ID, inventory_owner_id: 'owner-default', is_default: true, can_operate: true },
        { id: 'membership-secondary', user_id: OWNER_ID, actor_uid: OWNER_ID, inventory_owner_id: 'owner-secondary', is_default: false, can_operate: true },
      ] });
      if (table === 'inventory_holdings') return route.fulfill({ json: rows.flatMap((row) => [
        { id: `${row.id}-holding-default`, user_id: OWNER_ID, product_id: row.id, inventory_owner_id: 'owner-default', stock: 1, purchase_cost: 100, min_stock: 0, active: true, created_at: now, updated_at: now },
        { id: `${row.id}-holding-secondary`, user_id: OWNER_ID, product_id: row.id, inventory_owner_id: 'owner-secondary', stock: Math.max(0, Number(row.stock) - 1), purchase_cost: 120, min_stock: 0, active: true, created_at: now, updated_at: now },
      ]) });
      if (table === 'profiles') return route.fulfill({ json: [{ id: OWNER_ID, business_name: 'Negocio QA', onboarding_completed_at: now }] });
      if (table === 'collaborators') return route.fulfill({ json: options.collaboratorReadOnly ? [{
        id: 'collaborator-read-only', owner_uid: OWNER_ID,
        permissions: { stock: { read: true, write: false, delete: false } },
      }] : [] });
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
  return { savedHoldingDrafts };
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

test('mobile stock and product form fit a 360×740 phone viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Mobile layout checks run in Android and iPhone projects.');
  await mockStock(page, []);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/stock');
  await expect(page.getByRole('region', { name: 'Stock móvil' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await page.getByRole('button', { name: 'Agregar producto', exact: true }).first().click();
  const form = page.getByTestId('mobile-product-form');
  await expect(form).toBeVisible();
  const saveButton = form.getByRole('button', { name: 'Guardar producto' });
  await expect(saveButton).toBeVisible();
  const bounds = await saveButton.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(740);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await testInfo.attach(`${testInfo.project.name}-stock-form-360x740`, { body: await page.screenshot(), contentType: 'image/png' });
});

test('mobile stock hides write actions for a read-only collaborator', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock permission checks run in Android and iPhone projects.');
  await mockStock(page, productsFixture(), { collaboratorReadOnly: true });
  await page.goto('/stock');
  await expect(page.getByRole('button', { name: 'Agregar producto', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir ficha de [QA] Cámara WiFi 360' }).click();
  await expect(page.getByRole('region', { name: 'Ficha de [QA] Cámara WiFi 360' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajustar stock', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Más acciones del producto' }).click();
  await expect(page.getByRole('button', { name: 'Eliminar producto', exact: true })).toHaveCount(0);
});

test('mobile Stock is fully blocked for a suspended business', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock permission checks run in Android and iPhone projects.');
  await mockStock(page, productsFixture(), { planStatus: 'suspended' });
  await page.goto('/stock');
  await expect(page.getByRole('heading', { name: 'Tu cuenta está suspendida' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Escribir por WhatsApp' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir ficha de [QA] Cámara WiFi 360' })).toHaveCount(0);
});

test('mobile Stock hides Facebook publication without the automation module', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock module checks run in Android and iPhone projects.');
  await mockStock(page, productsFixture(), { automation: false });
  await page.goto('/stock?producto=camera');
  await page.getByRole('button', { name: 'Más acciones del producto' }).click();
  await expect(page.getByRole('button', { name: 'Publicar en Facebook', exact: true })).toHaveCount(0);
});

test('mobile product form creates a product and opens its detail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock touch flows run in Android and iPhone projects.');
  await mockStock(page, []);
  await page.goto('/stock?nuevo=1');
  const form = page.getByTestId('mobile-product-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Nombre').fill('[QA] Producto celular');
  await form.getByLabel('Categoría').selectOption('category-general');
  await form.getByLabel('Precio de compra').fill('1200');
  await form.getByLabel('Precio de venta').fill('2400');
  await form.getByLabel('Stock inicial').fill('3');
  await form.getByRole('button', { name: 'Guardar producto' }).click();

  await expect(page).toHaveURL(/\/stock\?producto=/);
  await expect(page.getByRole('region', { name: 'Ficha de [QA] Producto celular' })).toBeVisible();
  await expect(page.getByText('3 unidades', { exact: true })).toBeVisible();
});

test('mobile product form edits the product and asks before discarding changes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock touch flows run in Android and iPhone projects.');
  await mockStock(page);
  await page.goto('/stock?editar=cable');
  const form = page.getByTestId('mobile-product-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Nombre').fill('[QA] Cable editado');
  await form.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page).toHaveURL(/\/stock\?producto=cable$/);
  await expect(page.getByRole('region', { name: 'Ficha de [QA] Cable editado' })).toBeVisible();

  await page.goto('/stock');
  await page.getByRole('button', { name: 'Agregar producto', exact: true }).first().click();
  const newForm = page.getByTestId('mobile-product-form');
  await expect(newForm).toBeVisible();
  await expect(page).toHaveURL(/nuevo=1/);
  await newForm.getByLabel('Nombre').fill('[QA] Borrador sin guardar');
  await newForm.getByRole('button', { name: 'Cerrar editor' }).click();
  const discard = page.getByRole('alertdialog', { name: '¿Descartar los cambios?' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(newForm).toBeVisible();
  await newForm.getByRole('button', { name: 'Cerrar editor' }).click();
  await page.getByRole('alertdialog', { name: '¿Descartar los cambios?' }).getByRole('button', { name: 'Descartar' }).click();
  await expect(page).toHaveURL(/\/stock$/);
  await expect(page.getByTestId('mobile-product-form')).toHaveCount(0);
});

test('editing a product with multiple holders saves the product and every holder draft', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-mobile-ai', 'Run the holder edit regression in Android emulation.');
  const fixture = await mockStock(page, productsFixture(), { holdingsEnabled: true });
  await page.goto('/stock?editar=cable');
  const form = page.getByTestId('mobile-product-form');
  await expect(form.getByText('Existencias por titular')).toBeVisible();
  await expect(form.getByText('Depósito principal')).toBeVisible();
  await expect(form.getByText('Segundo titular')).toBeVisible();
  await form.getByLabel('Nombre').fill('[QA] Cable con titulares');
  await form.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page).toHaveURL(/\/stock\?producto=cable$/);
  expect(fixture.savedHoldingDrafts).toHaveLength(1);
  expect(fixture.savedHoldingDrafts[0].map((holding) => holding.inventoryOwnerId)).toEqual(['owner-default', 'owner-secondary']);
});

test('mobile product form asks before browser back when it has unsaved changes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock touch flows run in Android and iPhone projects.');
  await mockStock(page, []);
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Agregar producto', exact: true }).first().click();
  const form = page.getByTestId('mobile-product-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Nombre').fill('[QA] Borrador atrás');
  await page.evaluate(() => window.history.back());
  const discard = page.getByRole('alertdialog', { name: '¿Descartar los cambios?' });
  await expect(discard).toBeVisible();
  await expect(page).toHaveURL(/nuevo=1/);
  await discard.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'Cerrar editor' }).click();
  await page.getByRole('alertdialog', { name: '¿Descartar los cambios?' }).getByRole('button', { name: 'Descartar' }).click();
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
  await expect(page.getByText('[QA] Cámara WiFi 360 — Depósito principal', { exact: true })).toBeVisible();
  await expect(page.getByText('El carrito está vacío')).toHaveCount(0);

  await page.goto('/fotos?producto=camera');
  await expect(page.getByRole('dialog', { name: 'Producto [QA] Cámara WiFi 360' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar producto' }).click();
  await expect(page).toHaveURL(/\/fotos$/);
});

test('mobile stock adjustment previews limits, records the reason, and returns to the product detail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Stock touch flows run in Android and iPhone projects.');
  await mockStock(page);
  await page.goto('/stock?producto=camera');
  await page.getByRole('button', { name: 'Ajustar stock' }).click();

  await expect(page).toHaveURL(/producto=camera&ajustar=1/);
  const sheet = page.getByRole('dialog', { name: 'Ajustar stock' });
  await expect(sheet).toContainText('Stock actual: 1 unidades');
  await sheet.getByRole('button', { name: 'Restar', exact: true }).click();
  await sheet.getByRole('textbox', { name: 'Cantidad' }).fill('2');
  await expect(sheet).toContainText('Va a quedar en -1 unidades');
  await expect(sheet.getByRole('button', { name: 'Guardar ajuste' })).toBeDisabled();

  await sheet.getByRole('textbox', { name: 'Cantidad' }).fill('1');
  await sheet.getByRole('textbox', { name: 'Escribí el motivo' }).fill('Rotura durante la prueba');
  await sheet.getByRole('button', { name: 'Guardar ajuste' }).click();
  await expect(page).toHaveURL(/\/stock\?producto=camera$/);
  await expect(page.getByText('Stock actualizado: 0 unidades')).toBeVisible();
  await expect(page.getByText('0 unidades', { exact: true })).toBeVisible();
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
  await page.clock.install({ time: new Date('2026-11-04T12:00:00-03:00') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await testInfo.attach('desktop-home-1280x900', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await page.goto('/stock');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar PDF', exact: true })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Stock móvil' })).toHaveCount(0);
  await testInfo.attach('desktop-stock-1280x900', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await page.goto('/stock?producto=camera');
  await expect(page.getByRole('dialog', { name: 'Editar Producto' })).toBeVisible();
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }' });
  await testInfo.attach('desktop-stock-editor-1280x900', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Eliminar [QA] Cámara WiFi 360' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Eliminar producto' });
  await expect(deleteDialog).toContainText('Se borra el producto y sus fotos. No se puede deshacer.');
  await deleteDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(deleteDialog).toHaveCount(0);
});
