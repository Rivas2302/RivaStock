import { expect, test, type Page, type Route } from '@playwright/test';

const OWNER_ID = '10000000-0000-4000-8000-000000000081';
const PROJECT_URL = 'https://rivastock-test.invalid';
const CATEGORY_ID = 'category-photo-test';
const CREATED_AT = '2026-11-10T00:00:00.000Z';
const TINY_WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64');

function fixtureSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = {
    id: OWNER_ID,
    email: 'new-owner@example.test',
    email_confirmed_at: CREATED_AT,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: { display_name: 'Dueño QA', password_set: true },
    created_at: CREATED_AT,
  };
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: OWNER_ID, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token',
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  };
}

async function photoFile(page: Page, name: string) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo crear la foto de prueba.');
    const gradient = context.createLinearGradient(0, 0, 256, 256);
    gradient.addColorStop(0, '#365fad');
    gradient.addColorStop(1, '#f3b55b');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(128, 128, 58, 0, Math.PI * 2);
    context.fill();
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('No se pudo preparar la foto.')), 'image/jpeg', 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(bytes) };
}

async function mountNewBusinessStock(page: Page, options: { failUpload?: boolean; unsupportedHeic?: boolean; deferPlanRefresh?: boolean } = {}) {
  const rows: Record<string, unknown>[] = [];
  const uploads: Array<{ path: string; imageType: string; sizeBytes: number }> = [];
  const pageErrors: string[] = [];
  let planRequestCount = 0;
  let stockModuleEnabled = true;
  let signalPlanRefreshStarted!: () => void;
  let releaseDeferredPlanRefresh!: () => void;
  const planRefreshStarted = new Promise<void>((resolve) => { signalPlanRefreshStarted = resolve; });
  const deferredPlanRefresh = new Promise<void>((resolve) => { releaseDeferredPlanRefresh = resolve; });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (options.unsupportedHeic) {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'createImageBitmap', {
        configurable: true,
        value: async () => { throw new DOMException('Unsupported image format', 'NotSupportedError'); },
      });
    });
  }

  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.abort();

    const path = url.pathname;
    if (path === '/auth/v1/user') return route.fulfill({ json: fixtureSession().user });
    if (path === '/auth/v1/logout') return route.fulfill({ json: {} });
    if (path.endsWith('/rpc/get_owner_profile')) return route.fulfill({ json: [{
      id: OWNER_ID, role: 'admin', business_name: 'Negocio QA', business_name_lower: 'negocio qa',
      display_name: 'Dueño QA', currency_symbol: '$', catalog_slug: 'photo-upload-qa', dark_mode: false,
      onboarding_completed_at: CREATED_AT, created_at: CREATED_AT,
    }] });
    if (path.endsWith('/rpc/is_platform_admin')) return route.fulfill({ json: false });
    if (path.endsWith('/rpc/my_business_plan')) {
      planRequestCount += 1;
      if (options.deferPlanRefresh && planRequestCount >= 2) {
        signalPlanRefreshStarted();
        await deferredPlanRefresh;
      }
      return route.fulfill({ json: {
        plan_code: 'base', plan_name: 'RivaStock', status: 'active',
        limits: { modules: { stock: stockModuleEnabled, sendPhotos: true, sales: true } },
      } });
    }
    if (path.endsWith('/rpc/storage_upload_check')) return route.fulfill({ json: { allowed: true, reason: null } });
    if (path.endsWith('/rpc/get_public_inventory_owner_labels')) return route.fulfill({ json: [] });
    if (path.endsWith('/rpc/get_reseller_catalog_status')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/rpc/get_public_catalog_products')) return route.fulfill({ json: rows.map((row) => ({
      id: row.id,
      name: row.name,
      categoryId: row.category_id,
      category: 'General',
      salePrice: row.sale_price,
      stock: row.stock,
      imageUrl: row.image_url,
      images: row.images,
      description: row.description,
      availability: 'in_stock',
    })) });
    if (path.endsWith('/rpc/resolve_public_catalog_slug')) return route.fulfill({ json: null });

    if (path.startsWith('/storage/v1/object/public/assets/')) {
      return route.fulfill({ status: 200, contentType: 'image/webp', body: TINY_WEBP });
    }
    if (path.startsWith('/storage/v1/object/assets/')) {
      if (options.failUpload) return route.fulfill({ status: 403, json: {
        statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy',
      } });
      uploads.push({
        path: path.replace('/storage/v1/object/assets/', ''),
        imageType: route.request().postDataBuffer()?.toString('latin1').match(/Content-Type:\s*(image\/[a-z0-9.+-]+)/i)?.[1] ?? '',
        sizeBytes: route.request().postDataBuffer()?.byteLength ?? 0,
      });
      return route.fulfill({ status: 200, json: { Key: path.replace('/storage/v1/object/', ''), Id: `storage-${uploads.length}` } });
    }
    if (path === '/functions/v1/product-upload-diagnostics') return route.fulfill({ status: 202, json: { recorded: true } });

    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '');
      if (table === 'products') {
        const method = route.request().method();
        if (method === 'POST') {
          const row = { ...route.request().postDataJSON() as Record<string, unknown>, created_at: CREATED_AT, updated_at: CREATED_AT };
          rows.push(row);
          return route.fulfill({ status: 201, json: row });
        }
        return route.fulfill({ json: rows });
      }
      if (table === 'categories') return route.fulfill({ json: [{ id: CATEGORY_ID, user_id: OWNER_ID, name: 'General' }] });
      if (table === 'inventory_owners') return route.fulfill({ json: [{ id: 'inventory-owner', user_id: OWNER_ID, name: 'Principal', is_primary: true, sort_order: 0 }] });
      if (table === 'inventory_owner_memberships') return route.fulfill({ json: [{ inventory_owner_id: 'inventory-owner', is_default: true, can_operate: true }] });
      if (table === 'inventory_operation_settings') return route.fulfill({ json: [{ holdings_enabled: false }] });
      if (table === 'profiles') return route.fulfill({ json: [{ id: OWNER_ID, business_name: 'Negocio QA', onboarding_completed_at: CREATED_AT }] });
      if (table === 'collaborators') return route.fulfill({ json: [] });
      if (table === 'catalog_config') return route.fulfill({ json: [{
        id: 'catalog-config-qa', user_id: OWNER_ID, business_name: 'Negocio QA', slug: 'photo-upload-qa', enabled: true,
        show_prices: true, show_out_of_stock: true, show_stock: false, show_stock_quantity: false,
        category_photos_enabled: true, category_photo_overrides: {}, welcome_message: 'Catálogo de prueba',
        primary_color: '#3156a6', accent_color: '#3156a6', allow_orders: false, layout: 'Grid', font_style: 'Modern',
        whatsapp_number: null,
        presentation: { theme: 'normal', schedules: [], heroTitle: 'Catálogo QA', heroDescription: '', sections: [{ id: 'all', visible: true }], featuredProductIds: [], offerProductIds: [], showProductsWithoutPhoto: true, ambience: { announcementText: '' } },
      }] });
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ status: 200, json: [] });
  });

  await page.addInitScript((session) => localStorage.setItem('rivastock-auth', JSON.stringify(session)), fixtureSession());
  await page.goto('/stock');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await expect(page.getByRole('region', { name: 'Stock móvil' })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Agregar Producto' })).toBeVisible();
  }
  return {
    rows,
    uploads,
    pageErrors,
    planRefreshStarted,
    releasePlanRefresh: releaseDeferredPlanRefresh,
    setStockModuleEnabled: (enabled: boolean) => { stockModuleEnabled = enabled; },
  };
}

test('a pending background plan refresh does not remount the new-product form or lose its photo on desktop and Android', async ({ page }, testInfo) => {
  const isAndroid = testInfo.project.name === 'android-mobile-ai';
  test.skip(!isAndroid && testInfo.project.name !== 'chromium', 'Run on Android emulation and desktop Chrome.');
  const fixture = await mountNewBusinessStock(page, { deferPlanRefresh: true });

  await page.getByRole('button', { name: /Agregar producto/i }).first().click();
  const form = isAndroid ? page.getByTestId('mobile-product-form') : page.getByRole('dialog', { name: 'Agregar Nuevo Producto' });
  await expect(form).toBeVisible();
  const formHandle = await form.elementHandle();
  const inputHandle = await form.locator('input[type="file"]').first().elementHandle();
  expect(formHandle).not.toBeNull();
  expect(inputHandle).not.toBeNull();

  const productName = isAndroid ? '[QA] Plan estable Android' : '[QA] Plan estable escritorio';
  await form.getByLabel(isAndroid ? 'Nombre' : 'Nombre del Producto').fill(productName);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await fixture.planRefreshStarted;
  expect(await formHandle!.evaluate((element) => element.isConnected)).toBe(true);
  expect(await inputHandle!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(form.getByLabel(isAndroid ? 'Nombre' : 'Nombre del Producto')).toHaveValue(productName);

  const photo = await photoFile(page, 'photo-after-background-refresh.jpg');
  const chooser = page.waitForEvent('filechooser');
  if (isAndroid) await form.getByRole('button', { name: 'Galería' }).click();
  else await form.getByText(/Agregar\s*imagen/i).click();
  await (await chooser).setFiles(photo);
  await expect(form.getByRole('img', { name: 'Imagen 1' })).toBeVisible();

  fixture.releasePlanRefresh();
  await expect(form).toBeVisible();
  await form.getByLabel('Categoría').selectOption(CATEGORY_ID);
  if (isAndroid) await form.getByLabel('Precio de venta').fill('1800');
  else await form.getByRole('textbox', { name: 'Precio de venta' }).fill('1800');
  await form.getByRole('button', { name: isAndroid ? 'Guardar producto' : 'Crear Producto' }).click();
  await expect(form).toHaveCount(0);
  expect(fixture.rows).toHaveLength(1);
  expect(fixture.rows[0].name).toBe(productName);
  expect(fixture.uploads).toHaveLength(2);
  expect(fixture.pageErrors).toEqual([]);
});

test('a module removal from Platform takes effect after the business returns to the tab', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Run the account module-change check in desktop Chrome.');
  const fixture = await mountNewBusinessStock(page, { deferPlanRefresh: true });
  fixture.setStockModuleEnabled(false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
  await fixture.planRefreshStarted;
  fixture.releasePlanRefresh();
  await expect(page.getByRole('heading', { name: 'Este módulo no está incluido en tu plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Agregar producto/i })).toHaveCount(0);
});

test('a new authenticated business uploads a photo from a new product form in Android Chrome and desktop, then shows it in Stock and catalog', async ({ page }, testInfo) => {
  const isAndroid = testInfo.project.name === 'android-mobile-ai';
  test.skip(!isAndroid && testInfo.project.name !== 'chromium', 'Run on Android emulation and desktop Chrome.');
  const fixture = await mountNewBusinessStock(page);

  await page.getByRole('button', { name: /Agregar producto/i }).first().click();
  const form = isAndroid ? page.getByTestId('mobile-product-form') : page.getByRole('dialog', { name: 'Agregar Nuevo Producto' });
  await expect(form).toBeVisible();
  const firstPhoto = await photoFile(page, isAndroid ? 'gallery-photo.jpg' : 'desktop-photo.jpg');
  const firstChooser = page.waitForEvent('filechooser');
  if (isAndroid) await form.getByRole('button', { name: 'Galería' }).click();
  else await form.getByText(/Agregar\s*imagen/i).click();
  await (await firstChooser).setFiles(firstPhoto);
  await expect(form.getByRole('img', { name: 'Imagen 1' })).toBeVisible();

  if (isAndroid) {
    const cameraFile = await photoFile(page, 'camera-photo.jpg');
    const cameraChooser = page.waitForEvent('filechooser');
    await form.getByRole('button', { name: 'Sacar foto' }).click();
    await (await cameraChooser).setFiles(cameraFile);
    await expect(form.getByRole('img', { name: 'Imagen 2' })).toBeVisible();
  }

  const expectedUploads = isAndroid ? 4 : 2;
  await expect.poll(() => fixture.uploads.length).toBe(expectedUploads);
  expect(fixture.uploads.every((upload) => upload.imageType === 'image/webp'), JSON.stringify(fixture.uploads)).toBe(true);
  expect(fixture.uploads.every((upload) => upload.path.endsWith('.webp'))).toBe(true);
  const productPaths = fixture.uploads.map((upload) => upload.path.replace(/^thumbs\//, ''));
  expect(productPaths.every((path) => path.startsWith(`${OWNER_ID}/products/`) && !path.includes('//'))).toBe(true);
  const temporaryProductId = productPaths[0].split('/')[2];
  expect(temporaryProductId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  const productName = isAndroid ? '[QA] Foto Motorola' : '[QA] Foto escritorio';
  await form.getByLabel(isAndroid ? 'Nombre' : 'Nombre del Producto').fill(productName);
  await form.getByLabel('Categoría').selectOption(CATEGORY_ID);
  if (isAndroid) await form.getByLabel('Precio de venta').fill('1500');
  else await form.getByRole('textbox', { name: 'Precio de venta' }).fill('1500');
  await form.getByRole('button', { name: isAndroid ? 'Guardar producto' : 'Crear Producto' }).click();
  if (isAndroid) {
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('region', { name: `Ficha de ${productName}` })).toBeVisible();
    await expect(page.getByRole('img', { name: `${productName}, foto 1` })).toBeVisible();
    await page.getByRole('button', { name: 'Volver al stock' }).click();
    await expect(page.getByRole('button', { name: `Abrir ficha de ${productName}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Abrir ficha de ${productName}` }).getByRole('img', { name: productName })).toBeVisible();
  } else {
    await expect(form).toHaveCount(0);
    const productRow = page.getByRole('table').getByRole('row').filter({ hasText: productName });
    await expect(productRow.getByRole('img', { name: productName })).toBeVisible();
  }
  expect(fixture.rows).toHaveLength(1);
  expect(fixture.rows[0].id).toBe(temporaryProductId);
  expect(fixture.rows[0].images).toHaveLength(isAndroid ? 2 : 1);
  expect(fixture.rows[0].show_in_catalog).toBe(true);

  await page.goto('/catalogo/photo-upload-qa');
  const catalogCard = page.locator('.catalog-theme-card').filter({ hasText: productName });
  await expect(catalogCard.getByRole('img', { name: productName })).toBeVisible();
  expect(fixture.pageErrors).toEqual([]);
});

test('Android restores a new product draft after the camera returns through a tab reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-mobile-ai', 'This flow emulates Android Chrome only.');
  await mountNewBusinessStock(page);
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Agregar producto', exact: true }).first().click();
  let form = page.getByTestId('mobile-product-form');
  await form.getByLabel('Nombre').fill('[QA] Borrador recuperado');
  await form.getByLabel('Categoría').selectOption(CATEGORY_ID);
  await form.getByLabel('Precio de venta').fill('2450');
  const cameraChooser = page.waitForEvent('filechooser');
  await form.getByRole('button', { name: 'Sacar foto' }).click();
  await cameraChooser;

  const savedDraft = await page.evaluate((ownerId) => {
    const key = `rivastock:mobile-product-draft:v1:${ownerId}`;
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as { formData: { id?: string; name?: string }; holdingDrafts: unknown[] } : null;
  }, OWNER_ID);
  expect(savedDraft?.formData.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(savedDraft?.formData.name).toBe('[QA] Borrador recuperado');

  await page.reload();
  form = page.getByTestId('mobile-product-form');
  await expect(form).toBeVisible();
  await expect(page.getByText('Recuperamos tu producto.')).toBeVisible();
  await expect(form.getByLabel('Nombre')).toHaveValue('[QA] Borrador recuperado');
  await expect(form.getByLabel('Precio de venta')).toHaveValue('2450');
});

test('Android reports an unsupported HEIC clearly and records only a safe diagnostic', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-mobile-ai', 'This flow emulates Android Chrome only.');
  const fixture = await mountNewBusinessStock(page, { unsupportedHeic: true });
  const consoleEvents: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleEvents.push(message.text()); });

  await page.getByRole('button', { name: 'Agregar producto', exact: true }).first().click();
  const form = page.getByTestId('mobile-product-form');
  const galleryChooser = page.waitForEvent('filechooser');
  await form.getByRole('button', { name: 'Galería' }).click();
  await (await galleryChooser).setFiles({ name: 'phone-photo.heic', mimeType: 'image/heic', buffer: Buffer.from('fixture-heic') });

  await expect(form.getByRole('alert')).toHaveText('Formato no soportado. Guardá la foto como JPG o PNG y volvé a probar.');
  await expect(form.getByText('Formato no soportado.', { exact: false })).toBeVisible();
  expect(fixture.uploads).toHaveLength(0);
  await expect.poll(() => consoleEvents.some((entry) => entry.includes('product-photo-upload'))).toBe(true);
  const serializedLog = consoleEvents.find((entry) => entry.includes('product-photo-upload')) ?? '';
  expect(serializedLog).not.toContain('phone-photo.heic');
  expect(serializedLog).not.toContain(OWNER_ID);
});

test('Android shows a clear permission reason when Storage rejects an authenticated upload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-mobile-ai', 'This flow emulates Android Chrome only.');
  await mountNewBusinessStock(page, { failUpload: true });
  await page.getByRole('button', { name: 'Agregar producto', exact: true }).first().click();
  const form = page.getByTestId('mobile-product-form');
  const galleryFile = await photoFile(page, 'gallery-photo.jpg');
  const galleryChooser = page.waitForEvent('filechooser');
  await form.getByRole('button', { name: 'Galería' }).click();
  await (await galleryChooser).setFiles(galleryFile);

  await expect(form.getByRole('alert')).toHaveText('Sin permiso: no se pudo guardar la foto en Stock. Revisá el acceso del negocio.');
  await expect(form.getByText(/Sin permiso/)).toBeVisible();
  await expect(form.getByText(/row-level security|Failed to fetch/i)).toHaveCount(0);
});
