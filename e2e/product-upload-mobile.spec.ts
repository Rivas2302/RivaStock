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

async function mountNewBusinessStock(page: Page, options: { failUpload?: boolean; unsupportedHeic?: boolean } = {}) {
  const rows: Record<string, unknown>[] = [];
  const uploads: Array<{ path: string; imageType: string; sizeBytes: number }> = [];
  const pageErrors: string[] = [];
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
    if (path.endsWith('/rpc/my_business_plan')) return route.fulfill({ json: {
      plan_code: 'base', plan_name: 'RivaStock', status: 'active',
      limits: { modules: { stock: true, sendPhotos: true, sales: true } },
    } });
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
  await expect(page.getByRole('region', { name: 'Stock móvil' })).toBeVisible();
  return { rows, uploads, pageErrors };
}

test('a new authenticated Android business uploads from gallery and camera, then shows photos in Stock and catalog', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-mobile-ai', 'This flow emulates Android Chrome only.');
  const fixture = await mountNewBusinessStock(page);

  await page.getByRole('button', { name: 'Agregar producto', exact: true }).first().click();
  const form = page.getByTestId('mobile-product-form');
  await expect(form).toBeVisible();
  const galleryFile = await photoFile(page, 'gallery-photo.jpg');
  const galleryChooser = page.waitForEvent('filechooser');
  await form.getByRole('button', { name: 'Galería' }).click();
  await (await galleryChooser).setFiles(galleryFile);
  await expect(form.getByRole('img', { name: 'Imagen 1' })).toBeVisible();

  const cameraFile = await photoFile(page, 'camera-photo.jpg');
  const cameraChooser = page.waitForEvent('filechooser');
  await form.getByRole('button', { name: 'Sacar foto' }).click();
  await (await cameraChooser).setFiles(cameraFile);
  await expect(form.getByRole('img', { name: 'Imagen 2' })).toBeVisible();
  await expect.poll(() => fixture.uploads.length).toBe(4);
  expect(fixture.uploads.every((upload) => upload.imageType === 'image/webp'), JSON.stringify(fixture.uploads)).toBe(true);
  expect(fixture.uploads.every((upload) => upload.path.endsWith('.webp'))).toBe(true);

  await form.getByLabel('Nombre').fill('[QA] Foto Motorola');
  await form.getByLabel('Categoría').selectOption(CATEGORY_ID);
  await form.getByLabel('Precio de venta').fill('1500');
  await form.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Ficha de [QA] Foto Motorola' })).toBeVisible();
  await expect(page.getByRole('img', { name: '[QA] Foto Motorola, foto 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Volver al stock' }).click();
  await expect(page.getByRole('button', { name: 'Abrir ficha de [QA] Foto Motorola' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir ficha de [QA] Foto Motorola' }).getByRole('img', { name: '[QA] Foto Motorola' })).toBeVisible();
  expect(fixture.rows).toHaveLength(1);
  expect(fixture.rows[0].images).toHaveLength(2);
  expect(fixture.rows[0].show_in_catalog).toBe(true);

  await page.goto('/catalogo/photo-upload-qa');
  const catalogCard = page.locator('.catalog-theme-card').filter({ hasText: '[QA] Foto Motorola' });
  await expect(catalogCard.getByRole('img', { name: '[QA] Foto Motorola' })).toBeVisible();
  expect(fixture.pageErrors).toEqual([]);
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
