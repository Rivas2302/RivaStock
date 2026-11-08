import { expect, test, type Page, type Route } from '@playwright/test';

const owner = '10000000-0000-4000-8000-000000000001';
const now = new Date().toISOString();
const priceList = { id: 'price-list-qa', user_id: owner, kind: 'reseller', default_discount_percent: 20, public_enabled: false, minimum_rule: 'none', minimum_order_amount: 0, minimum_order_quantity: 0 };
const supplier = { id: 'supplier-qa', user_id: owner, name: '[QA] Mr Tecno', name_lower: '[qa] mr tecno', is_active: true };
const secondarySupplier = { id: 'supplier-qa-secondary', user_id: owner, name: 'ZZ [QA] Otro proveedor', name_lower: 'zz [qa] otro proveedor', is_active: true };
const supplierList = { id: 'supplier-list-qa', user_id: owner, price_list_id: priceList.id, supplier_id: supplier.id, enabled: false };

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: owner, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer',
    user: { id: owner, email: 'owner@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: now },
  };
}

async function mockApp(page: Page, options: { failImageIndex?: number; removalFixture?: boolean; bulkFixture?: boolean; largeFixture?: boolean; ocrTexts?: string[]; nameCleanupFixture?: boolean; photoScanFixture?: boolean; useRealOcr?: boolean } = {}) {
  if (!options.useRealOcr) {
    await page.addInitScript(texts => {
      let index = 0;
      Object.defineProperty(window, '__RIVASTOCK_SUPPLIER_OCR_WORKER_FACTORY__', {
        configurable: false,
        value: () => ({
          recognize: async () => ({ data: { text: texts[Math.min(index++, texts.length - 1)] || '' } }),
          terminate: async () => undefined,
        }),
      });
    }, options.ocrTexts ?? ['']);
  }
  const products: Record<string, unknown>[] = options.photoScanFixture ? [
    { id: 'supplier-photo-1', user_id: owner, name: 'Cable USB C', category: 'General', category_id: 'category-general', stock: 0, sale_price: 45000, purchase_price: 30000, catalog_only: true, barcode: 'USB-1', image_url: 'https://rivastock-test.invalid/storage/v1/object/public/assets/owner/products/supplier-photo-1/supplier-hash.webp', images: ['https://rivastock-test.invalid/storage/v1/object/public/assets/owner/products/supplier-photo-1/supplier-hash.webp'] },
  ] : options.nameCleanupFixture ? [
    { id: 'supplier-name-1', user_id: owner, name: 'HM352 – HUMIFICADOR LED ESTILO FUEGO', category: 'General', category_id: 'category-general', stock: 0, sale_price: 45000, purchase_price: 30000, catalog_only: true, barcode: 'HM352', image_url: null, images: [] },
  ] : options.largeFixture ? [
    ...Array.from({ length: 2_499 }, (_, index) => ({
      id: `product-${String(index + 1).padStart(4, '0')}`,
      user_id: owner,
      name: `[QA] Fixture ${index + 1}`,
      category: 'General', category_id: 'category-general', stock: 2, sale_price: 2000,
      purchase_price: 1000, image_url: null, images: [],
    })),
    { id: 'zz-product-p47', user_id: owner, name: 'Auricular Bluetooth P47', category: 'General', category_id: 'category-general', stock: 2, sale_price: 45000, purchase_price: 30000, image_url: null, images: [] },
  ] : options.bulkFixture ? [
    { id: 'bulk-stock-included', user_id: owner, name: '[QA] Stock incluido', category: 'General', category_id: 'category-general', stock: 4, sale_price: 2000, purchase_price: 1000, barcode: 'QA-STOCK-1', image_url: 'https://fixture.invalid/stock.webp', images: ['https://fixture.invalid/stock.webp'] },
    { id: 'bulk-stock-excluded', user_id: owner, name: '[QA] Stock fuera de lista', category: 'General', category_id: 'category-general', stock: 2, sale_price: 3000, purchase_price: 1500, barcode: 'QA-STOCK-2', image_url: 'https://fixture.invalid/stock-2.webp', images: ['https://fixture.invalid/stock-2.webp'] },
    { id: 'bulk-provider-included', user_id: owner, name: '[QA] Producto proveedor', category: 'General', category_id: 'category-general', stock: 0, sale_price: 4000, catalog_only: true, catalog_cost: 2500, barcode: 'QA-PROVIDER-1', image_url: 'https://fixture.invalid/provider.webp', images: ['https://fixture.invalid/provider.webp'] },
  ] : [];
  const categories: Record<string, unknown>[] = [{ id: 'category-general', user_id: owner, name: 'General' }];
  let supplierProductIds: string[] = options.photoScanFixture ? ['supplier-photo-1'] : options.nameCleanupFixture ? ['supplier-name-1'] : options.removalFixture ? ['product-removal-1', 'product-removal-2'] : options.bulkFixture ? ['bulk-provider-included'] : [];
  const priceListItems: Record<string, unknown>[] = options.largeFixture ? [
    { id: 'item-p47', user_id: owner, price_list_id: priceList.id, product_id: 'zz-product-p47', pricing_mode: 'default', availability: 'in_stock', sort_order: 0 },
  ] : options.bulkFixture ? [
    { id: 'bulk-item-stock', user_id: owner, price_list_id: priceList.id, product_id: 'bulk-stock-included', pricing_mode: 'default', availability: 'in_stock', sort_order: 0 },
    { id: 'bulk-item-provider', user_id: owner, price_list_id: priceList.id, product_id: 'bulk-provider-included', pricing_mode: 'default', availability: 'on_order', supplier_list_id: supplierList.id, sort_order: 1 },
  ] : [];
  let changedCatalog = false;
  let failedImageIndex = options.failImageIndex;
  const sourceCosts: number[] = [];
  const pricingCalls: unknown[][] = [];
  const removalCalls: unknown[] = [];
  const bulkCalls: Array<{ method: string; productIds: string[]; body?: unknown }> = [];
  const productReadPages: string[] = [];

  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    const path = url.pathname;
    if (path === '/auth/v1/user') return route.fulfill({ json: session().user });
    if (path === '/functions/v1/fetch-url') {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': 'http://127.0.0.1:4173',
        'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
        'access-control-allow-methods': 'POST, OPTIONS',
      } });
      const requestBody = route.request().postDataJSON() as { mode?: string; url?: string };
      if (requestBody.mode === 'image') {
        const imageIndex = Number(requestBody.url?.match(/photo-(\d+)\.jpg/)?.[1] ?? 0);
        if (imageIndex === failedImageIndex) {
          return route.fulfill({ status: 422, json: { error: 'No pudimos descargar la foto del proveedor.' } });
        }
        return route.fulfill({ json: {
          mimeType: 'image/png',
          base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
        } });
      }
      sourceCosts.push(changedCatalog ? 8.75 : 7.75);
      return route.fulfill({ json: {
        source: 'woocommerce', currency: 'USD', items: [
          { code: '1015', name: 'Lámpara solar', price: changedCatalog ? 8.75 : 7.75, category: 'Iluminación', imageUrl: 'https://mrtecno.com.ar/wp-content/uploads/photo-1.jpg', url: 'https://mrtecno.com.ar/productos/1015' },
          { code: 'C91015', name: 'Cable iPhone C', price: 3.5, category: 'Cargadores', imageUrl: 'https://mrtecno.com.ar/wp-content/uploads/photo-2.jpg', url: 'https://mrtecno.com.ar/productos/c91015' },
          { code: 'YH88214N', name: 'Cargador USB', price: 2.25, category: 'Cargadores', imageUrl: 'https://mrtecno.com.ar/wp-content/uploads/photo-3.jpg', url: 'https://mrtecno.com.ar/productos/yh88214n' },
        ],
      } });
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const rpc = path.split('/').pop();
      if (rpc === 'get_owner_profile') return route.fulfill({ json: [{ id: owner, role: 'admin', business_name: 'Negocio QA', display_name: 'Dueño QA', currency_symbol: '$', dark_mode: false, onboarding_completed_at: now, created_at: now }] });
      if (rpc === 'is_platform_admin') return route.fulfill({ json: false });
      if (rpc === 'sanitize_reseller_supplier_product_names') {
        let updated = 0;
        for (const product of products) {
          if (!supplierProductIds.includes(String(product.id)) || typeof product.name !== 'string') continue;
          if (/^[A-Z\d._/-]{2,32}\s*[–—-]\s+/u.test(product.name)) {
            product.name = product.name.replace(/^[A-Z\d._/-]{2,32}\s*[–—-]\s+/u, '').toLocaleLowerCase('es-AR').replace(/^\p{L}/u, letter => letter.toLocaleUpperCase('es-AR')).replace(/\b(led|usb|hdmi|rgb)\b/gi, token => token.toLocaleUpperCase('en-US'));
            updated++;
          }
        }
        return route.fulfill({ json: updated });
      }
      if (rpc === 'my_business_plan') return route.fulfill({ json: { plan_code: 'base', plan_name: 'RivaStock', status: 'active', limits: { modules: { ai: false, knowledge: false, automation: false } } } });
      if (rpc === 'storage_upload_check') return route.fulfill({ json: { allowed: true } });
      if (rpc === 'get_public_catalog_products') return route.fulfill({ json: [] });
      if (rpc === 'get_reseller_catalog_status') {
        const enabled = priceListItems.some(item => {
          const product = products.find(row => row.id === item.product_id);
          return Boolean(product && (item.availability === 'on_order' || Number(product.stock) > 0));
        });
        return route.fulfill({ json: { enabled } });
      }
      if (rpc === 'unlock_reseller_catalog') {
        const listedProducts = priceListItems.flatMap(item => {
          const product = products.find(row => row.id === item.product_id);
          if (!product || (item.availability !== 'on_order' && Number(product.stock) <= 0)) return [];
          return [{
            id: product.id,
            name: product.name,
            categoryId: product.category_id,
            category: product.category,
            salePrice: product.sale_price,
            stock: product.stock,
            imageUrl: product.image_url,
            images: product.images,
            availability: item.availability,
          }];
        });
        return route.fulfill({ json: { enabled: true, priceListId: priceList.id, products: listedProducts } });
      }
      if (rpc === 'save_reseller_supplier_list') {
        supplierProductIds = (route.request().postDataJSON() as { p_product_ids: string[] }).p_product_ids;
        return route.fulfill({ json: supplierList });
      }
      if (rpc === 'save_reseller_supplier_list_pricing') {
        pricingCalls.push((route.request().postDataJSON() as { p_items: unknown[] }).p_items);
        return route.fulfill({ json: pricingCalls.at(-1)?.length ?? 0 });
      }
      if (rpc === 'preview_reseller_supplier_import_removal') {
        return route.fulfill({ json: { products: 2, protectedProducts: 1, deletableProducts: 1, photosToDelete: 1, emptyCategoriesToDelete: 1 } });
      }
      if (rpc === 'remove_reseller_supplier_import_batch') {
        removalCalls.push(route.request().postDataJSON());
        return route.fulfill({ json: { processed: 2, deleted: 1, protected: 1, deletedProductIds: ['product-removal-1'], protectedProductIds: ['product-removal-2'], storageUrls: [], emptyCategoriesDeleted: 1, deletedCategoryIds: ['category-removal'], remaining: 0 } });
      }
      if (rpc === 'configure_reseller_price_list' || rpc === 'ensure_reseller_price_list') return route.fulfill({ json: priceList });
      return route.fulfill({ json: [] });
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '').split('?')[0];
      const method = route.request().method();
      if (table === 'products') {
        if (method === 'POST') {
          const posted = route.request().postDataJSON() as Record<string, unknown>[];
          products.push(...posted);
          return route.fulfill({ status: 201, json: posted });
        }
        if (method === 'PATCH') {
          const id = url.searchParams.get('id')?.replace(/^eq\./, '');
          const product = products.find(row => row.id === id);
          if (product) Object.assign(product, route.request().postDataJSON());
          return route.fulfill({ json: product ?? {} });
        }
        const range = route.request().headers().range;
        const rangeMatch = range?.match(/^(\d+)-(\d+)$/);
        const cursor = url.searchParams.get('id')?.replace(/^gt\./, '');
        const pageSize = Number(url.searchParams.get('limit')) || (rangeMatch ? Number(rangeMatch[2]) - Number(rangeMatch[1]) + 1 : products.length);
        const start = rangeMatch ? Number(rangeMatch[1]) : Number(url.searchParams.get('offset')) || 0;
        const end = rangeMatch ? Number(rangeMatch[2]) : start + pageSize - 1;
        const matchingProducts = cursor ? products.filter(product => String(product.id) > cursor) : products;
        const pageRows = matchingProducts.slice(start, end + 1);
        productReadPages.push(`${cursor ?? 'start'}:${start}-${end}:${pageRows.length}`);
        return route.fulfill({
          json: pageRows,
          headers: { 'content-range': `${start}-${Math.min(end, products.length - 1)}/${products.length}` },
        });
      }
      if (table === 'categories') {
        if (method === 'POST') {
          const posted = route.request().postDataJSON() as Record<string, unknown>;
          const created = { ...posted, user_id: owner };
          categories.push(created);
          return route.fulfill({ status: 201, json: created });
        }
        return route.fulfill({ json: categories });
      }
      if (table === 'catalog_config') return route.fulfill({ json: [{
        id: 'catalog-config-qa', user_id: owner, business_name: 'Negocio QA', slug: 'qa-bulk',
        show_prices: true, show_out_of_stock: true, show_stock: false, show_stock_quantity: false,
        enabled: true, welcome_message: '', primary_color: '#4f46e5', accent_color: '#4f46e5',
        allow_orders: true, layout: 'Grid', font_style: 'Modern',
      }] });
      if (table === 'price_lists') return route.fulfill({ json: [priceList] });
      if (table === 'price_list_items') {
        const method = route.request().method();
        if (method === 'GET') return route.fulfill({ json: priceListItems });
        const queryProductIds = () => priceListItems
          .map(row => String(row.product_id))
          .filter(productId => (url.searchParams.get('product_id') ?? '').includes(productId));
        if (method === 'DELETE') {
          const productIds = queryProductIds();
          bulkCalls.push({ method, productIds });
          for (let index = priceListItems.length - 1; index >= 0; index -= 1) {
            if (productIds.includes(String(priceListItems[index].product_id))) priceListItems.splice(index, 1);
          }
          return route.fulfill({ json: [] });
        }
        if (method === 'PATCH') {
          const productIds = queryProductIds();
          const body = route.request().postDataJSON() as Record<string, unknown>;
          bulkCalls.push({ method, productIds, body });
          for (const row of priceListItems) if (productIds.includes(String(row.product_id))) Object.assign(row, body);
          return route.fulfill({ json: [] });
        }
        if (method === 'POST') {
          const rows = route.request().postDataJSON() as Record<string, unknown>[];
          const productIds = rows.map(row => String(row.product_id));
          bulkCalls.push({ method, productIds, body: rows });
          for (const row of rows) {
            const existing = priceListItems.find(item => item.product_id === row.product_id && item.price_list_id === row.price_list_id);
            if (!existing) priceListItems.push({ ...row, id: `bulk-item-${String(row.product_id)}` });
          }
          return route.fulfill({ status: 201, json: [] });
        }
      }
      if (table === 'reseller_supplier_lists') return route.fulfill({ json: [supplierList] });
      if (table === 'reseller_supplier_list_items') return route.fulfill({ json: supplierProductIds.map((product_id, sort_order) => ({ user_id: owner, supplier_list_id: supplierList.id, product_id, sort_order })) });
      if (table === 'suppliers') return route.fulfill({ json: [supplier, secondarySupplier] });
      if (table === 'inventory_operation_settings') return route.fulfill({ json: [{ holdings_enabled: false }] });
      if (table === 'inventory_owners') return route.fulfill({ json: [{ id: 'inventory-owner', user_id: owner, name: 'Principal', is_primary: true }] });
      if (table === 'inventory_owner_memberships') return route.fulfill({ json: [{ inventory_owner_id: 'inventory-owner', is_default: true, can_operate: true }] });
      if (table === 'collaborators') return route.fulfill({ json: [] });
      return route.fulfill({ json: [] });
    }
    if (path.startsWith('/storage/v1/object/assets/')) {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64') });
      }
      return route.fulfill({ status: 200, json: { Key: path } });
    }
    return route.fulfill({ json: [] });
  });

  await page.addInitScript(value => localStorage.setItem('rivastock-auth', JSON.stringify(value)), session());
  return {
    products, pricingCalls, sourceCosts, removalCalls, bulkCalls, priceListItems, productReadPages,
    changeCatalog: () => { changedCatalog = true; },
    failImagesAt: (index?: number) => { failedImageIndex = index; },
  };
}

async function openMobileSupplierImportFromStock(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Más acciones de stock' }).click();
  await page.getByRole('button', { name: /Lista revendedores/ }).click();
  await expect(page).toHaveURL(/\/revendedores$/);
  await page.getByRole('tablist', { name: 'Secciones de Revendedores' }).getByRole('tab', { name: 'Proveedores' }).click();
  const providers = page.getByRole('tabpanel', { name: 'Proveedores' });
  await providers.getByRole('button', { name: 'Importar lista' }).first().click();
  return providers.getByRole('region', { name: 'Importar lista del proveedor' });
}

async function continueSupplierImportToReview(page: Page, importRegion: ReturnType<Page['getByRole']>) {
  await expect(importRegion.getByText(/Revisamos \d+ fotos;/)).toBeVisible();
  await importRegion.getByRole('button', { name: 'Seguir: revisar' }).click();
  await expect(page.getByRole('navigation', { name: 'Pasos para importar' }).getByRole('button', { name: '3. Revisar' }))
    .toHaveAttribute('aria-current', 'step');
}

for (const viewport of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) {
  test(`existing supplier photo OCR saves a visible provider-brand flag without changing the list at ${viewport.width}px`, async ({ page }) => {
    const { products, bulkCalls } = await mockApp(page, { photoScanFixture: true, ocrTexts: ['www.mrtecno.com.ar'] });
    const pageErrors: string[] = [];
    page.on('pageerror', () => pageErrors.push('page'));
    page.on('console', message => { if (message.type() === 'error') pageErrors.push('console'); });
    await page.setViewportSize(viewport);
    await page.goto('/revendedores');
    await page.getByRole('tablist', { name: 'Secciones de Revendedores' }).getByRole('tab', { name: 'Proveedores' }).click();
    const providers = page.getByRole('tabpanel', { name: 'Proveedores' });
    const provider = providers.locator('article').filter({ hasText: '[QA] Mr Tecno' }).first();
    await provider.getByRole('button', { name: 'Importar lista' }).click();
    await providers.getByRole('button', { name: 'Analizar fotos importadas' }).click();
    await expect(providers.getByRole('status').filter({ hasText: 'Analizamos 1 fotos de la lista; 1 quedaron marcadas' })).toBeVisible();
    const brandStatus = providers.getByRole('status', { name: 'Fotos con marca del proveedor' });
    await expect(brandStatus).toContainText('1 producto con fotos marcadas del proveedor');
    await expect(brandStatus).toContainText('Cable USB C · 1 foto');
    expect(products[0].custom_fields).toMatchObject({ supplierPhotoBrandFlag: true, supplierPhotoBrandFlaggedCount: 1 });
    expect(bulkCalls).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test(`historical supplier-name cleanup preserves the internal barcode at ${viewport.width}px`, async ({ page }) => {
    const { products } = await mockApp(page, { nameCleanupFixture: true });
    await page.setViewportSize(viewport);
    await page.goto('/revendedores');
    await page.getByRole('tablist', { name: 'Secciones de Revendedores' }).getByRole('tab', { name: 'Proveedores' }).click();
    const providers = page.getByRole('tabpanel', { name: 'Proveedores' });
    await providers.getByRole('button', { name: 'Importar lista' }).first().click();
    await providers.getByRole('button', { name: 'Limpiar códigos de nombres' }).click();
    await expect(providers.getByRole('status').filter({ hasText: 'Actualizamos 1 nombre' })).toBeVisible();
    expect(products[0]).toMatchObject({ name: 'Humificador LED estilo fuego', barcode: 'HM352' });
  });

  test(`supplier photo OCR blocks provider-branded photos until explicit approval at ${viewport.width}px`, async ({ page }) => {
    const { products } = await mockApp(page, { ocrTexts: ['www.mrtecno.com.ar', '', ''] });
    await page.setViewportSize(viewport);
    page.on('dialog', dialog => dialog.accept());
    const importRegion = await openMobileSupplierImportFromStock(page);
    await importRegion.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
    await importRegion.getByRole('button', { name: 'Leer enlace' }).click();
    await importRegion.getByLabel('Cotización USD a pesos').fill('1600');
    await importRegion.getByLabel('Los precios incluyen IVA').selectOption('false');
    await continueSupplierImportToReview(page, importRegion);

    await expect(importRegion.getByText('Con marca del proveedor').first()).toBeVisible();
    await expect(importRegion.getByText('3 productos · 2 listos · 1 para revisar')).toBeVisible();
    const firstProduct = importRegion.getByLabel('Producto de fila 1');
    await firstProduct.scrollIntoViewIfNeeded();
    await importRegion.getByText('Con marca del proveedor').first().click();
    await expect(importRegion.getByRole('button', { name: 'Usar igual' }).first()).toBeVisible();
    await importRegion.getByRole('button', { name: 'Usar igual' }).first().click();
    await expect(importRegion.getByText('3 productos · 3 listos · 0 para revisar')).toBeVisible();
    await importRegion.getByRole('button', { name: 'Agregar los 3 listos con foto' }).click();
    await expect.poll(() => products.length).toBe(3);
    expect(products[0]).toMatchObject({ name: 'Lámpara solar', barcode: '1015' });
    expect(products[0].custom_fields).toMatchObject({ supplierPhotoBrandFlag: true, supplierPhotoBrandApproved: true });
  });
}

for (const viewport of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) {
  test(`supplier removal requires typed confirmation and shows exact counts at ${viewport.width}px`, async ({ page }) => {
    const { removalCalls } = await mockApp(page, { removalFixture: true });
    await page.setViewportSize(viewport);
    await page.goto('/revendedores');
    const modal = page.getByRole('region', { name: 'Lista de precios para revendedores' });
    await modal.getByRole('tab', { name: 'Proveedores' }).click();
    await modal.locator('summary[aria-label="Más acciones para [QA] Mr Tecno"]').click();
    await modal.getByRole('button', { name: 'Quitar productos importados…' }).click();

    const dialog = page.getByRole('dialog', { name: 'Quitar productos importados' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('2 productos');
    await expect(dialog).toContainText('1 se borrarán');
    await expect(dialog).toContainText('1 foto del proveedor');
    await expect(dialog.getByTestId('confirm-remove-supplier-import')).toBeDisabled();

    if (viewport.width === 360) {
      await dialog.screenshot({ path: 'test-results/i32-removal-confirmation-360.png' });
    }
    await dialog.getByLabel('Nombre del proveedor para confirmar').fill('[QA] Mr Tecno');
    await expect(dialog.getByTestId('confirm-remove-supplier-import')).toBeEnabled();
    await dialog.getByTestId('confirm-remove-supplier-import').click();
    await expect.poll(() => removalCalls.length).toBe(1);
    await expect(dialog).toBeHidden();
  });
}

test('real Spanish OCR loads its worker, core and language model from the app origin', async ({ page }) => {
  test.setTimeout(120_000);
  const { products, bulkCalls } = await mockApp(page, { photoScanFixture: true, useRealOcr: true });
  await page.setViewportSize({ width: 360, height: 800 });
  const pageErrors: string[] = [];
  const assetPaths = new Set<string>();
  page.on('pageerror', error => pageErrors.push(error.name));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/tesseract/')) assetPaths.add(url.pathname);
    if (url.hostname === 'cdn.jsdelivr.net') assetPaths.add(`external:${url.hostname}`);
  });
  await page.goto('/revendedores');
  await page.getByRole('tablist', { name: 'Secciones de Revendedores' }).getByRole('tab', { name: 'Proveedores' }).click();
  const providers = page.getByRole('tabpanel', { name: 'Proveedores' });
  const provider = providers.locator('article').filter({ hasText: '[QA] Mr Tecno' }).first();
  await provider.getByRole('button', { name: 'Importar lista' }).click();
  await providers.getByRole('button', { name: 'Analizar fotos importadas' }).click();
  await expect(providers.getByRole('status').filter({ hasText: 'Analizamos 1 fotos de la lista; 0 quedaron marcadas' })).toBeVisible({ timeout: 90_000 });
  expect(Array.from(assetPaths)).toContain('/tesseract/worker.min.js');
  expect(Array.from(assetPaths)).toContain('/tesseract/lang/4.0.0_best_int/spa.traineddata.gz');
  expect(Array.from(assetPaths).some(path => /^\/tesseract\/core\/tesseract-core-(?:simd-)?lstm\.wasm\.js$/.test(path))).toBe(true);
  expect(Array.from(assetPaths)).not.toContain('external:cdn.jsdelivr.net');
  expect(products[0].custom_fields).toBeUndefined();
  expect(bulkCalls).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('supplier catalog import reviews three fixture pages, bulk adds, then updates by SKU on reimport', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
  const { products, pricingCalls, sourceCosts, changeCatalog } = await mockApp(page);
  page.on('dialog', dialog => dialog.accept());
  const modal = await openMobileSupplierImportFromStock(page);
  await modal.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await continueSupplierImportToReview(page, modal);
  await expect(modal.getByText('3 productos · 3 listos · 0 para revisar')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Agregar los 3 listos con foto' })).toBeVisible();
  await modal.getByRole('button', { name: 'Agregar los 3 listos con foto' }).click();
  await expect.poll(() => products.length).toBe(3);
  await expect.poll(() => pricingCalls.length).toBe(1);

  changeCatalog();
  await page.getByRole('navigation', { name: 'Pasos para importar' }).getByRole('button', { name: '1. Importar' }).click();
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await continueSupplierImportToReview(page, modal);
  await expect(modal.getByText('3 productos · 0 listos · 0 para revisar')).toHaveCount(0);
  await expect(modal.getByText(/0 nuevos · 1 actualizados · 2 sin cambios/)).toBeVisible();
  await modal.getByRole('button', { name: 'Agregar los 3 listos con foto' }).click();
  await expect.poll(() => products.length).toBe(3);
  await expect.poll(() => pricingCalls.length).toBe(2);
  expect(pageErrors).toEqual([]);
  await expect(modal.getByText(/0 nuevos · 0 actualizados · 3 sin cambios/)).toBeVisible();
});

test('bulk import button confirms and creates only products matching the active search filter', async ({ page }) => {
  const { products } = await mockApp(page);
  page.on('dialog', dialog => dialog.accept());
  const modal = await openMobileSupplierImportFromStock(page);
  await modal.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await continueSupplierImportToReview(page, modal);
  await modal.getByLabel('Buscar productos importados').fill('Lámpara solar');
  await expect(modal.getByRole('button', { name: 'Agregar los 1 listos con foto de "Lámpara solar"' })).toBeVisible();
  await modal.getByRole('button', { name: 'Agregar los 1 listos con foto de "Lámpara solar"' }).click();
  await expect.poll(() => products.length).toBe(1);
  expect(products[0].name).toBe('Lámpara solar');
});

test('a failed supplier image does not block other photos or product import', async ({ page }) => {
  const { products, failImagesAt } = await mockApp(page);
  page.on('dialog', dialog => dialog.accept());
  const modal = await openMobileSupplierImportFromStock(page);
  await modal.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await continueSupplierImportToReview(page, modal);
  failImagesAt(2);
  await modal.getByRole('button', { name: 'Agregar los 3 listos con foto' }).click();
  await expect.poll(() => products.length).toBe(3);
  await expect.poll(() => products.filter(product => typeof product.image_url === 'string').length).toBe(2);
  await expect(modal.getByText(/1 foto no se pudo copiar/)).toBeVisible();
  await expect(modal.getByRole('status', { name: 'Producto sin foto' })).toBeVisible();

  failImagesAt();
  await page.getByRole('navigation', { name: 'Pasos para importar' }).getByRole('button', { name: '1. Importar' }).click();
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await continueSupplierImportToReview(page, modal);
  await expect(modal.getByRole('button', { name: 'Agregar los 3 listos con foto' })).toBeVisible();
  await modal.getByRole('button', { name: 'Agregar los 3 listos con foto' }).click();
  await expect.poll(() => products.filter(product => typeof product.image_url === 'string').length).toBe(3);
  await expect(modal.getByText(/foto no se pudo copiar/)).toHaveCount(0);
});

test('supplier import previews load through the same-origin image proxy', async ({ page }) => {
  await mockApp(page);
  const modal = await openMobileSupplierImportFromStock(page);
  await modal.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await continueSupplierImportToReview(page, modal);
  await modal.getByLabel('Buscar productos importados').waitFor();

  const preview = modal.getByTestId('supplier-import-photo-preview').first();
  await preview.scrollIntoViewIfNeeded();
  await expect.poll(async () => modal.getByTestId('supplier-import-photo-image').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(modal.getByText(/\d+ con foto · \d+ sin foto/)).toBeVisible();
});

test('reseller module separates summary, price list, providers and orders without changing stock navigation', async ({ page }) => {
  const { products } = await mockApp(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/revendedores');

  const tabs = page.getByRole('tablist', { name: 'Secciones de Revendedores' });
  await expect(page.getByRole('heading', { name: 'Revendedores', level: 1 })).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  await expect(page.getByRole('tabpanel', { name: 'Resumen de Revendedores' })).toBeVisible();
  await expect(page.getByText('0 productos · margen medio sin definir · cotización sin definir · Sin importaciones')).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await tabs.getByRole('tab', { name: 'Lista de precios' }).click();
  await expect(page.getByTestId('reseller-price-list')).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await tabs.getByRole('tab', { name: 'Proveedores' }).click();
  await expect(page.getByRole('heading', { name: 'Proveedores', level: 2 })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Proveedores' })).toBeVisible();
  await page.locator('article').filter({ hasText: '[QA] Mr Tecno' }).getByRole('button', { name: 'Importar lista' }).click();
  await expect(page.getByRole('button', { name: 'Volver a proveedores' })).toBeVisible();
  await expect(page.getByText('ZZ [QA] Otro proveedor')).toHaveCount(0);
  await page.getByRole('button', { name: 'Volver a proveedores' }).click();
  await expect(page.getByText('ZZ [QA] Otro proveedor')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Encargos' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Encargos' })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByText('Todavía no abriste una ronda para este proveedor.')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Ajustes' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Ajustes' })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Revendedores' })).toHaveCount(0);
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(360);
  expect(products).toEqual([]);
});

test('Stock no longer has reseller-list shortcuts in its desktop header', async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/stock');
  await expect(page.getByRole('heading', { name: 'Gestión de Stock' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lista revendedores' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ver lista de precios' })).toHaveCount(0);
});

test('reseller supplier import follows its three steps and adds only filtered fixture rows at 360 and 1440 px', async ({ page }) => {
  const { products } = await mockApp(page);
  page.on('dialog', dialog => dialog.accept());
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto('/revendedores');
    const tabs = page.getByRole('tablist', { name: 'Secciones de Revendedores' });
    await tabs.getByRole('tab', { name: 'Proveedores' }).click();
    await page.getByRole('button', { name: /Importar lista|Editar productos|Crear lista/ }).first().click();
    await expect(page.getByRole('button', { name: 'Crear para esta lista' })).toHaveCount(0);

    const steps = page.getByRole('navigation', { name: 'Pasos para importar' });
    await expect(steps.getByRole('button', { name: '1. Importar' })).toHaveAttribute('aria-current', 'step');
    await page.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
    await page.getByRole('button', { name: 'Leer enlace' }).click();
    await expect(steps.getByRole('button', { name: '2. Precios' })).toHaveAttribute('aria-current', 'step');
    await expect(page.getByLabel('Los precios incluyen IVA')).toBeVisible();
    await expect(page.getByLabel('Margen para revendedores')).toBeVisible();
    await page.getByLabel('Cotización USD a pesos').fill('1600');
    await page.getByLabel('Los precios incluyen IVA').selectOption('false');
    await page.getByRole('button', { name: 'Seguir: revisar' }).click();
    await expect(steps.getByRole('button', { name: '3. Revisar' })).toHaveAttribute('aria-current', 'step');
    await page.getByLabel('Buscar productos importados').fill('Lámpara solar');
    await expect(page.getByRole('button', { name: 'Agregar los 1 listos con foto de "Lámpara solar"' })).toBeVisible();
    await expect(page.getByLabel('Productos importados', { exact: true })).toBeVisible();
    if (width === 360) {
      await expect.poll(() => page.locator('.app-content').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    }
    const before = products.length;
    await page.getByTestId('supplier-import-add-filtered').click();
    await expect.poll(() => products.length).toBe(before + 1);
    expect(products.at(-1)?.name).toBe('Lámpara solar');
    expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width);
    // Each viewport run starts from the same clean fixture state, as separate smoke runs would.
    products.splice(0, products.length);
  }
});

test('bulk price-list actions use the visible Mi stock filter, support undo, and never mutate products at 360 and 1440 px', async ({ page }) => {
  const { products, bulkCalls, priceListItems } = await mockApp(page, { bulkFixture: true });
  const initialItems = priceListItems.map(item => ({ ...item }));

  for (const width of [360, 1440]) {
    priceListItems.splice(0, priceListItems.length, ...initialItems.map(item => ({ ...item })));
    bulkCalls.splice(0, bulkCalls.length);
    await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
    await page.goto('/revendedores');
    await page.getByRole('tablist', { name: 'Secciones de Revendedores' }).getByRole('tab', { name: 'Lista de precios' }).click();
    await page.getByRole('group', { name: 'Origen de los productos' }).getByRole('button', { name: 'Mi stock' }).click();

    const panel = page.getByTestId('reseller-price-bulk-panel');
    await expect(panel.getByRole('row', { name: /Stock incluido/ })).toContainText('En la lista');
    await expect(panel.getByRole('row', { name: /Stock fuera de lista/ })).toContainText('Fuera de la lista');
    await expect(panel.getByRole('row', { name: /Producto proveedor/ })).toHaveCount(0);
    await panel.getByLabel('Elegir todos los que se ven').check();

    const toolbar = page.getByRole('toolbar', { name: 'Acciones para productos elegidos' });
    await expect(toolbar).toContainText('2 elegidos');
    await toolbar.getByRole('button', { name: 'Quitar de la lista' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Confirmar cambios en la lista' });
    await expect(confirmation).toContainText('1 producto de la lista de revendedores. No se borran de tu stock.');
    await confirmation.getByRole('button', { name: 'Quitar de la lista' }).click();
    await expect.poll(() => priceListItems.some(item => item.product_id === 'bulk-stock-included')).toBe(false);
    expect(products).toHaveLength(3);
    expect(bulkCalls.at(-1)).toMatchObject({ method: 'DELETE', productIds: ['bulk-stock-included'] });

    await page.getByRole('button', { name: 'Deshacer' }).click();
    await expect.poll(() => priceListItems.some(item => item.product_id === 'bulk-stock-included')).toBe(true);
    await expect(panel.getByRole('row', { name: /Stock incluido/ })).toContainText('En la lista');

    await panel.getByLabel('Elegir todos los que se ven').check();
    await toolbar.getByRole('button', { name: 'Quitar de la lista' }).click();
    await page.getByRole('dialog', { name: 'Confirmar cambios en la lista' }).getByRole('button', { name: 'Quitar de la lista' }).click();
    await expect.poll(() => priceListItems.some(item => item.product_id === 'bulk-stock-included')).toBe(false);
    await expect(panel.getByRole('row', { name: /Stock incluido/ })).toContainText('Fuera de la lista');
    expect(products).toHaveLength(3);
    expect(bulkCalls.every(call => call.productIds.every(id => id === 'bulk-stock-included'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await page.goto('/catalogo/qa-bulk');
    await expect(page.getByRole('button', { name: /Revendedores/ })).toBeVisible();
    await page.getByRole('button', { name: /Revendedores/ }).click();
    await page.getByPlaceholder('Código de acceso').fill('qa-code');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page.getByText('[QA] Stock incluido')).toHaveCount(0);
    await expect(page.getByText('[QA] Producto proveedor')).toBeVisible();

    await page.goto('/revendedores');
    await page.getByRole('tablist', { name: 'Secciones de Revendedores' }).getByRole('tab', { name: 'Lista de precios' }).click();
    const restoredPanel = page.getByTestId('reseller-price-bulk-panel');
    await restoredPanel.getByLabel('Elegir [QA] Stock incluido').check();
    await toolbar.getByRole('button', { name: 'Agregar a la lista' }).click();
    await page.getByRole('dialog', { name: 'Confirmar cambios en la lista' }).getByRole('button', { name: 'Agregar a la lista' }).click();
    await expect.poll(() => priceListItems.some(item => item.product_id === 'bulk-stock-included')).toBe(true);
    await panel.getByLabel('Elegir [QA] Stock incluido').check();
    await toolbar.getByRole('button', { name: 'Por pedido' }).click();
    await page.getByRole('dialog', { name: 'Confirmar cambios en la lista' }).getByRole('button', { name: 'Marcar por pedido' }).click();
    await expect.poll(() => priceListItems.find(item => item.product_id === 'bulk-stock-included')?.availability).toBe('on_order');
  }
});

test('price list loads the product after row 1,000 and bulk actions can reach it at 360 and 1440 px', async ({ page }) => {
  test.setTimeout(60_000);
  const { products, bulkCalls, priceListItems, productReadPages } = await mockApp(page, { largeFixture: true });
  const p47 = products.at(-1)!;
  const item = { ...priceListItems[0] };

  for (const width of [360, 1440]) {
    if (width === 1440) priceListItems.splice(0, priceListItems.length, { ...item });
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto('/revendedores');
    await page.getByRole('tablist', { name: 'Secciones de Revendedores' }).getByRole('tab', { name: 'Lista de precios' }).click();
    await expect.poll(() => productReadPages.length).toBeGreaterThan(0);
    expect(productReadPages).toContain('start:0-999:1000');
    expect(productReadPages).toContain('start:1000-1999:1000');
    expect(productReadPages).toContain('start:2000-2999:500');

    const filters = page.getByRole('group', { name: 'Filtrar por estado' });
    await expect(filters.getByRole('button', { name: 'Todos · 2500' })).toBeVisible();
    await expect(filters.getByRole('button', { name: 'En la lista · 1' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Buscar producto en la lista de precios' }).fill('Auricular Bluetooth P47');
    const row = page.getByRole('row', { name: /Auricular Bluetooth P47/ });
    await expect(row).toBeVisible();
    await row.getByLabel('Elegir Auricular Bluetooth P47').check();
    await page.getByRole('toolbar', { name: 'Acciones para productos elegidos' }).getByRole('button', { name: 'Quitar de la lista' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Confirmar cambios en la lista' });
    await expect(confirmation).toContainText('1 producto');
    await confirmation.getByRole('button', { name: 'Quitar de la lista' }).click();
    await expect.poll(() => priceListItems.some(entry => entry.product_id === p47.id)).toBe(false);
    expect(bulkCalls.at(-1)).toMatchObject({ method: 'DELETE', productIds: [p47.id] });
    expect(products).toHaveLength(2_500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('mobile Más menu opens Revendedores page and reaches review without creating products', async ({ page }) => {
  const { products } = await mockApp(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  const menu = page.getByRole('dialog');
  const resellerLink = menu.getByRole('link', { name: 'Revendedores' });
  await expect(resellerLink).toBeVisible();
  await expect(resellerLink).toHaveAttribute('href', '/revendedores');
  await resellerLink.click();
  await expect(page).toHaveURL(/\/revendedores$/);
  await expect(page.getByRole('tablist', { name: 'Secciones de Revendedores' })).toBeVisible();
  await expect(page.locator('.mobile-navigation-bar a[href="/revendedores"]')).toHaveCount(0);

  await page.getByRole('tablist', { name: 'Secciones de Revendedores' }).getByRole('tab', { name: 'Proveedores' }).click();
  await page.getByRole('button', { name: /Importar lista|Editar productos|Crear lista/ }).first().click();
  const steps = page.getByRole('navigation', { name: 'Pasos para importar' });
  await expect(steps.getByRole('button', { name: '1. Importar' })).toHaveAttribute('aria-current', 'step');
  await page.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
  await page.getByRole('button', { name: 'Leer enlace' }).click();
  await expect(steps.getByRole('button', { name: '2. Precios' })).toHaveAttribute('aria-current', 'step');
  await page.getByLabel('Cotización USD a pesos').fill('1600');
  await page.getByLabel('Los precios incluyen IVA').selectOption('false');
  await page.getByRole('button', { name: 'Seguir: revisar' }).click();
  await expect(steps.getByRole('button', { name: '3. Revisar' })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByLabel('Productos importados', { exact: true })).toBeVisible();
  await expect(page.getByTestId('supplier-import-add-filtered')).toBeVisible();
  expect(products).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await page.goto('/stock');
  await page.getByRole('button', { name: 'Más acciones de stock' }).click();
  await page.getByRole('button', { name: /Lista revendedores/ }).click();
  await expect(page).toHaveURL(/\/revendedores$/);
  await expect(page.getByRole('dialog', { name: 'Lista de precios para revendedores' })).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Secciones de Revendedores' })).toBeVisible();
});
