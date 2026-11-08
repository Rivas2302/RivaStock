import { expect, test, type Page, type Route } from '@playwright/test';

const owner = '10000000-0000-4000-8000-000000000001';
const now = new Date().toISOString();
const priceList = { id: 'price-list-qa', user_id: owner, kind: 'reseller', default_discount_percent: 20, public_enabled: false, minimum_rule: 'none', minimum_order_amount: 0, minimum_order_quantity: 0,
  margin_rules: { tiers: [
    { id: 'cost-5000', maximumCost: 5000, mode: 'percent', value: 40, minimumProfit: null, maximumProfit: null },
    { id: 'cost-15000', maximumCost: 15000, mode: 'percent', value: 30, minimumProfit: null, maximumProfit: null },
    { id: 'cost-30000', maximumCost: 30000, mode: 'fixed', value: 5000, minimumProfit: null, maximumProfit: null },
    { id: 'cost-over-30000', maximumCost: null, mode: 'percent', value: 18, minimumProfit: null, maximumProfit: null },
  ], categoryOverrides: {}, productOverrides: {}, rounding: 'none' } };
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

async function mockApp(page: Page, options: { failImageIndex?: number; removalFixture?: boolean; bulkFixture?: boolean; mobileListFixture?: boolean; marginFixture?: boolean; largeFixture?: boolean; ocrTexts?: string[]; nameCleanupFixture?: boolean; photoScanFixture?: boolean; useRealOcr?: boolean; emptyCatalog?: boolean } = {}) {
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
  ] : options.marginFixture ? [
    [1_000, 6_000, 16_000, 32_000, 20_000, 8_000].map((cost, index) => ({
      id: `margin-product-${index + 1}`, user_id: owner, name: `[QA] Margen producto ${index + 1}`, category: index === 2 ? 'Perfumes' : 'General', category_id: index === 2 ? 'category-perfumes' : 'category-general', stock: 3, sale_price: cost + 500, purchase_price: cost, image_url: null, images: [],
    })),
  ].flat() : options.mobileListFixture ? Array.from({ length: 3 }, (_, index) => ({
    id: `mobile-price-${index + 1}`, user_id: owner, name: `[QA] Móvil producto ${index + 1}`, category: 'General', category_id: 'category-general', stock: index + 1, sale_price: 2000 + index * 500, purchase_price: 1000 + index * 200, image_url: null, images: [],
  })) : options.largeFixture ? [
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
  const categories: Record<string, unknown>[] = [
    { id: 'category-general', user_id: owner, name: 'General' },
    ...(options.marginFixture ? [{ id: 'category-perfumes', user_id: owner, name: 'Perfumes' }] : []),
  ];
  let supplierProductIds: string[] = options.photoScanFixture ? ['supplier-photo-1'] : options.nameCleanupFixture ? ['supplier-name-1'] : options.removalFixture ? ['product-removal-1', 'product-removal-2'] : options.bulkFixture ? ['bulk-provider-included'] : [];
  const priceListItems: Record<string, unknown>[] = options.largeFixture ? [
    { id: 'item-p47', user_id: owner, price_list_id: priceList.id, product_id: 'zz-product-p47', pricing_mode: 'default', availability: 'in_stock', sort_order: 0 },
  ] : options.marginFixture ? Array.from({ length: 6 }, (_, index) => ({
    id: `margin-item-${index + 1}`, user_id: owner, price_list_id: priceList.id, product_id: `margin-product-${index + 1}`, pricing_mode: 'default', availability: 'in_stock', sort_order: index,
  })) : options.mobileListFixture ? Array.from({ length: 3 }, (_, index) => ({
    id: `mobile-price-item-${index + 1}`, user_id: owner, price_list_id: priceList.id, product_id: `mobile-price-${index + 1}`, pricing_mode: 'default', availability: 'in_stock', sort_order: index,
  })) : options.bulkFixture ? [
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
  const settingsWrites: Array<{ target: string; body: Record<string, unknown> }> = [];

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
      if (options.emptyCatalog) return route.fulfill({ json: { source: 'unknown', currency: 'ARS', items: [], text: '' } });
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
      if (rpc === 'configure_reseller_price_list') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        settingsWrites.push({ target: rpc, body });
        Object.assign(priceList, {
          public_enabled: body.p_public_enabled,
          minimum_rule: body.p_minimum_rule,
          minimum_order_amount: body.p_minimum_order_amount,
          minimum_order_quantity: body.p_minimum_order_quantity,
          access_code_hash: body.p_access_code ? 'fixture-hash' : priceList.access_code_hash,
        });
        return route.fulfill({ json: priceList });
      }
      if (rpc === 'configure_reseller_pricing_advisor') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        settingsWrites.push({ target: rpc, body });
        Object.assign(priceList, {
          minimum_profit_margin_percent: body.p_minimum_profit_margin_percent,
          target_reseller_discount_percent: body.p_target_reseller_discount_percent,
        });
        return route.fulfill({ json: priceList });
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
      if (table === 'price_lists') {
        if (method === 'PATCH') {
          const body = route.request().postDataJSON() as Record<string, unknown>;
          settingsWrites.push({ target: table, body });
          Object.assign(priceList, body);
          return route.fulfill({ json: priceList });
        }
        return route.fulfill({ json: [priceList] });
      }
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
            if (existing) Object.assign(existing, row);
            else priceListItems.push({ ...row, id: `bulk-item-${String(row.product_id)}` });
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
    products, pricingCalls, sourceCosts, removalCalls, bulkCalls, priceListItems, productReadPages, settingsWrites,
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

async function confirmSupplierProductImport(page: Page) {
  const confirmation = page.getByRole('dialog', { name: 'Confirmar productos' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Agregar productos' }).click();
  await expect(confirmation).toBeHidden();
}

for (const viewport of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) {
  test(`reseller settings match the approved structure, autosave, and change access code with a fixture at ${viewport.width}px`, async ({ page }) => {
    const { settingsWrites } = await mockApp(page);
    await page.setViewportSize(viewport);
    await page.goto('/revendedores');
    await page.getByRole('tablist', { name: 'Secciones de Revendedores' }).getByRole('tab', { name: 'Ajustes' }).click();
    const settings = page.getByRole('tabpanel', { name: 'Ajustes' });
    await expect(settings.getByRole('heading', { name: 'Publicación y acceso' })).toBeVisible();
    await expect(settings.getByRole('heading', { name: 'Precios' })).toBeVisible();
    await expect(settings.getByRole('heading', { name: 'Compra mínima' })).toBeVisible();
    await expect(settings.getByText('Precio automático con excepciones')).toHaveCount(0);
    await expect(settings.getByText('Asistente de precios')).toHaveCount(0);
    await expect(settings.getByRole('button', { name: 'Ver', exact: true })).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Descargar', exact: true })).toBeVisible();
    await expect(settings.locator('input[type="password"]')).toHaveCount(0);

    await settings.getByRole('button', { name: 'Bajar descuento general' }).click();
    await expect.poll(() => settingsWrites.some(write => write.target === 'price_lists' && write.body.default_discount_percent === 19)).toBe(true);
    await expect(settings.getByText('Cambios guardados', { exact: true })).toBeVisible();

    await settings.getByRole('group', { name: 'Tipo de compra mínima' }).getByRole('button', { name: 'Monto', exact: true }).click();
    const amount = settings.getByLabel('Monto mínimo');
    await amount.fill('55000');
    await amount.press('Tab');
    await expect.poll(() => settingsWrites.some(write => write.target === 'configure_reseller_price_list' && write.body.p_minimum_rule === 'amount' && write.body.p_minimum_order_amount === 55000)).toBe(true);

    await settings.getByRole('button', { name: 'Cambiar código' }).click();
    const codeDialog = page.getByRole('dialog', { name: 'Cambiar código' });
    await expect(codeDialog).toBeVisible();
    await expect(codeDialog.locator('input[name="reseller-code-new"]')).toHaveAttribute('autocomplete', 'off');
    await expect(codeDialog.locator('input[name="reseller-code-repeat"]')).toHaveAttribute('autocomplete', 'off');
    await expect(codeDialog.locator('input[name="reseller-code-new"]')).toHaveAttribute('type', 'password');
    await codeDialog.getByRole('button', { name: 'Mostrar códigos' }).click();
    await expect(codeDialog.locator('input[name="reseller-code-new"]')).toHaveAttribute('type', 'text');
    await codeDialog.getByRole('button', { name: 'Ocultar códigos' }).click();
    await codeDialog.getByLabel('Nuevo código').fill('clave-local-QA');
    await codeDialog.getByLabel('Repetir código').fill('clave-distinta');
    await expect(codeDialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    await codeDialog.getByLabel('Repetir código').fill('clave-local-QA');
    await codeDialog.getByRole('button', { name: 'Guardar' }).click();
    await expect(codeDialog).toBeHidden();
    await expect.poll(() => settingsWrites.some(write => write.target === 'configure_reseller_price_list' && write.body.p_access_code === 'clave-local-QA')).toBe(true);
    await settings.getByRole('switch', { name: 'Catálogo para revendedores publicado' }).click();
    await expect.poll(() => settingsWrites.some(write => write.target === 'configure_reseller_price_list' && write.body.p_public_enabled === true)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.waitForTimeout(3500);
    if (viewport.width === 360) await page.addStyleTag({ content: '.mobile-navigation-bar { display: none !important; }' });
    await settings.screenshot({ path: `test-results/i31-settings-${viewport.width}.png` });
  });
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
    await confirmSupplierProductImport(page);
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
  const modal = await openMobileSupplierImportFromStock(page);
  await modal.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await continueSupplierImportToReview(page, modal);
  await expect(modal.getByText('3 productos · 3 listos · 0 para revisar')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Agregar los 3 listos con foto' })).toBeVisible();
  await modal.getByRole('button', { name: 'Agregar los 3 listos con foto' }).click();
  await confirmSupplierProductImport(page);
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
  await confirmSupplierProductImport(page);
  await expect.poll(() => products.length).toBe(3);
  await expect.poll(() => pricingCalls.length).toBe(2);
  expect(pageErrors).toEqual([]);
  await expect(modal.getByText(/0 nuevos · 0 actualizados · 3 sin cambios/)).toBeVisible();
});

test('bulk import button confirms and creates only products matching the active search filter', async ({ page }) => {
  const { products } = await mockApp(page);
  const modal = await openMobileSupplierImportFromStock(page);
  await modal.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await continueSupplierImportToReview(page, modal);
  await modal.getByLabel('Buscar productos importados').fill('Lámpara solar');
  await expect(modal.getByRole('button', { name: 'Agregar los 1 listos con foto de "Lámpara solar"' })).toBeVisible();
  await modal.getByRole('button', { name: 'Agregar los 1 listos con foto de "Lámpara solar"' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmar productos' })).toContainText('1 producto con foto');
  expect(products).toHaveLength(0);
  await confirmSupplierProductImport(page);
  await expect.poll(() => products.length).toBe(1);
  expect(products[0].name).toBe('Lámpara solar');
});

test('a failed supplier image does not block other photos or product import', async ({ page }) => {
  const { products, failImagesAt } = await mockApp(page);
  const modal = await openMobileSupplierImportFromStock(page);
  await modal.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await continueSupplierImportToReview(page, modal);
  failImagesAt(2);
  await modal.getByRole('button', { name: 'Agregar los 3 listos con foto' }).click();
  await confirmSupplierProductImport(page);
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
  await confirmSupplierProductImport(page);
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
    const importMarginRules = page.getByLabel('Reglas de ganancia aplicadas');
    await expect(importMarginRules).toBeVisible();
    await expect(importMarginRules).toContainText(/Hasta\s+\$\s*5\.000: 40%/);
    await expect(importMarginRules).toContainText(/Hasta\s+\$\s*15\.000: 30%/);
    await expect(page.getByRole('button', { name: 'Leer lista con IA' })).toHaveCount(0);
    await page.getByLabel('Cotización USD a pesos').fill('1600');
    await page.getByLabel('Los precios incluyen IVA').selectOption('false');
    await page.getByRole('button', { name: 'Seguir: revisar' }).click();
    await expect(steps.getByRole('button', { name: '3. Revisar' })).toHaveAttribute('aria-current', 'step');
    await expect(page.getByLabel('Ejemplo de precio')).toContainText(/precio revendedor\s+\$\s*16\.120/);
    await page.getByLabel('Buscar productos importados').fill('Lámpara solar');
    await expect(page.getByRole('button', { name: 'Agregar los 1 listos con foto de "Lámpara solar"' })).toBeVisible();
    await expect(page.getByLabel('Productos importados', { exact: true })).toBeVisible();
    if (width === 360) {
      await expect.poll(() => page.locator('.app-content').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    }
    const before = products.length;
    await page.getByTestId('supplier-import-add-filtered').click();
    await confirmSupplierProductImport(page);
    await expect.poll(() => products.length).toBe(before + 1);
    expect(products.at(-1)?.name).toBe('Lámpara solar');
    expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width);
    // Each viewport run starts from the same clean fixture state, as separate smoke runs would.
    products.splice(0, products.length);
  }
});

test('extension supplier capture arrives in review without saving products', async ({ page }) => {
  const { products, priceListItems } = await mockApp(page);
  const captureId = 'a1b2c3d4-e5f6-4789-a012-123456789abc';
  const capturedItems = [
    { name: 'Cable USB C [QA]', code: 'EXT-001', altCode: null, price: 1200, currency: 'ARS', category: 'Cables', imageUrl: 'https://images.example.test/cable.webp', images: ['https://images.example.test/cable.webp'], url: 'https://supplier.example.test/products/1' },
    { name: 'Cargador USB [QA]', code: 'EXT-002', altCode: null, price: 2500, currency: 'ARS', category: 'Cargadores', imageUrl: null, images: [], url: 'https://supplier.example.test/products/2' },
  ];
  await page.addInitScript(({ id, items }) => {
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { runtime: { lastError: null, sendMessage: (_extensionId: string, message: { type: string; offset?: number }, callback: (response: unknown) => void) => {
        if (message.type === 'rivastock-get-capture') {
          const offset = message.offset ?? 0;
          callback({ captureId: id, offset, nextOffset: items.length, total: items.length, done: true, items: items.slice(offset), origin: 'https://supplier.example.test', source: ['dom-cards'], warnings: [], capturedAt: new Date().toISOString() });
        } else callback({ received: true });
      } } },
    });
  }, { id: captureId, items: capturedItems });

  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/revendedores?importar=extension&captura=${captureId}`);
  await expect(page.getByRole('heading', { name: 'Recibimos 2 productos de supplier.example.test' })).toBeVisible();
  await expect(page.getByText('No se guardó ningún producto ni se enviaron cookies o datos de sesión.')).toBeVisible();
  await page.getByLabel('Proveedor para la captura').selectOption('supplier-qa');
  await page.getByRole('button', { name: 'Seguir a Precios' }).click();
  await expect(page.getByRole('button', { name: '2. Precios' })).toHaveAttribute('aria-current', 'step');
  await page.getByLabel('Los precios incluyen IVA').selectOption('false');
  await page.getByRole('button', { name: 'Seguir: revisar' }).click();
  await expect(page.getByRole('button', { name: '3. Revisar' })).toHaveAttribute('aria-current', 'step');
  await page.getByLabel('Solo con foto').uncheck();
  await expect(page.getByLabel('Productos importados', { exact: true })).toContainText('Cable USB C [QA]');
  await expect(page.getByLabel('Productos importados', { exact: true })).toContainText('EXT-001');
  await expect(page.getByLabel('Productos importados', { exact: true })).toContainText('Cargador USB [QA]');
  await page.getByLabel('Productos importados', { exact: true }).screenshot({ path: 'test-results/i37-extension-review-360.png' });
  expect(products).toHaveLength(0);
  expect(priceListItems).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/i37-extension-review-1440.png', fullPage: true });
});

test('I36 simulates six cost-based margins on mobile, applies one or many prices, and supports undo', async ({ page }, testInfo) => {
  const { products, priceListItems, bulkCalls } = await mockApp(page, { marginFixture: true });
  const originalProductPrices = products.map(product => [product.id, product.sale_price, product.purchase_price]);

  for (const width of [360, 412, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 960 : 820 });
    await page.goto('/revendedores');
    const tabs = page.getByRole('tablist', { name: 'Secciones de Revendedores' });
    await tabs.getByRole('tab', { name: 'Ajustes' }).click();
    const assistant = page.getByTestId('reseller-margin-assistant');
    await expect(assistant).toBeVisible();
    await expect(assistant.getByTestId('reseller-margin-simulator').locator('article')).toHaveCount(6);
    if (width === 360) await assistant.screenshot({ path: testInfo.outputPath('i36-margin-simulator-360.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await tabs.getByRole('tab', { name: 'Lista de precios' }).click();
    await page.getByRole('button', { name: 'Ganancia baja · 6' }).click();
    const list = page.getByTestId('reseller-price-list-mobile');
    if (width < 640) {
      await expect(list.locator('article')).toHaveCount(6);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }

    if (width === 360) {
      const firstRow = list.locator('article').filter({ hasText: '[QA] Margen producto 1' });
      await expect(firstRow).toContainText(/Sugerido:\s*\$\s*1\.400/);
      await firstRow.getByRole('button', { name: 'Aplicar' }).click();
      const confirmation = page.getByRole('dialog', { name: 'Confirmar precios sugeridos' });
      await expect(confirmation).toContainText('1 producto');
      await confirmation.getByRole('button', { name: 'Aplicar precios sugeridos' }).click();
      await expect.poll(() => priceListItems.find(item => item.product_id === 'margin-product-1')?.fixed_price).toBe(1_400);
      await page.getByRole('button', { name: 'Deshacer' }).click();
      await expect.poll(() => priceListItems.find(item => item.product_id === 'margin-product-1')?.pricing_mode).toBe('default');

      await list.getByLabel('Elegir [QA] Margen producto 1').check();
      await list.getByLabel('Elegir [QA] Margen producto 2').check();
      const toolbar = page.getByRole('toolbar', { name: 'Acciones para productos elegidos' });
      await toolbar.getByRole('button', { name: 'Aplicar ganancia sugerida (2)' }).click();
      const bulkConfirmation = page.getByRole('dialog', { name: 'Confirmar precios sugeridos' });
      await expect(bulkConfirmation).toContainText('2 productos');
      await bulkConfirmation.getByRole('button', { name: 'Aplicar precios sugeridos' }).click();
      await expect.poll(() => priceListItems.filter(item => item.pricing_mode === 'fixed').length).toBe(2);
      await page.getByRole('button', { name: 'Deshacer' }).click();
      await expect.poll(() => priceListItems.every(item => item.pricing_mode === 'default')).toBe(true);
      expect(products.map(product => [product.id, product.sale_price, product.purchase_price])).toEqual(originalProductPrices);
      expect(bulkCalls.filter(call => call.method === 'POST').every(call => call.body)).toBe(true);
    }
  }
});

test('JavaScript-only supplier pages offer the Chrome extension guide', async ({ page }) => {
  await mockApp(page, { emptyCatalog: true });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/revendedores');
  await page.getByRole('tablist', { name: 'Secciones de Revendedores' }).getByRole('tab', { name: 'Proveedores' }).click();
  await page.getByRole('button', { name: /Importar lista|Editar productos|Crear lista/ }).first().click();
  await page.getByLabel('Enlace HTTPS del proveedor').fill('https://brajamayorista.com/tienda/centro/productos');
  await page.getByRole('button', { name: 'Leer enlace' }).click();
  await expect(page.getByRole('alert')).toContainText('Esta tienda carga los productos con JavaScript.');
  await expect(page.getByRole('alert')).toContainText('Abrila en Chrome en tu PC');
  await page.getByRole('button', { name: 'Cómo hacerlo' }).click();
  const help = page.getByRole('dialog', { name: 'Importar desde Chrome' });
  await help.screenshot({ path: 'test-results/i37-extension-help-360.png' });
  await expect(help.getByRole('listitem')).toHaveCount(3);
  await expect.poll(() => help.locator('img').evaluateAll(images => images.length === 3 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(help.getByText('Hacelo desde una PC con Chrome.')).toBeVisible();
  await expect(help.getByRole('link', { name: 'Instalar o actualizar la extensión' })).toBeVisible();
  await expect(help).toContainText('no comparte cookies ni datos de sesión.');
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
    const mobileList = panel.getByTestId('reseller-price-list-mobile');
    const includedCheckbox = (root: typeof panel) => width === 360
      ? root.getByTestId('reseller-price-list-mobile').getByLabel('Elegir [QA] Stock incluido')
      : root.getByRole('row', { name: /Stock incluido/ }).getByLabel('Elegir [QA] Stock incluido');
    const includedRow = width === 360
      ? mobileList.locator('article').filter({ hasText: 'Stock incluido' })
      : panel.getByRole('row', { name: /Stock incluido/ });
    const excludedRow = width === 360
      ? mobileList.locator('article').filter({ hasText: 'Stock fuera de lista' })
      : panel.getByRole('row', { name: /Stock fuera de lista/ });
    await expect(includedRow).toContainText('En la lista');
    await expect(excludedRow).toContainText(width === 360 ? 'Fuera' : 'Fuera de la lista');
    if (width === 360) {
      await expect(mobileList.getByText('[QA] Producto proveedor')).toHaveCount(0);
      await mobileList.getByLabel('Elegir [QA] Stock incluido').check();
      await mobileList.getByLabel('Elegir [QA] Stock fuera de lista').check();
    } else {
      await expect(panel.getByRole('row', { name: /Producto proveedor/ })).toHaveCount(0);
      await panel.getByLabel('Elegir todos los que se ven').check();
    }

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
    await expect(includedRow).toContainText('En la lista');

    if (width === 360) {
      await mobileList.getByLabel('Elegir [QA] Stock incluido').check();
      await mobileList.getByLabel('Elegir [QA] Stock fuera de lista').check();
    } else {
      await panel.getByLabel('Elegir todos los que se ven').check();
    }
    await toolbar.getByRole('button', { name: 'Quitar de la lista' }).click();
    await page.getByRole('dialog', { name: 'Confirmar cambios en la lista' }).getByRole('button', { name: 'Quitar de la lista' }).click();
    await expect.poll(() => priceListItems.some(item => item.product_id === 'bulk-stock-included')).toBe(false);
    await expect(includedRow).toContainText(width === 360 ? 'Fuera' : 'Fuera de la lista');
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
    await includedCheckbox(restoredPanel).check();
    await toolbar.getByRole('button', { name: 'Agregar a la lista' }).click();
    await page.getByRole('dialog', { name: 'Confirmar cambios en la lista' }).getByRole('button', { name: 'Agregar a la lista' }).click();
    await expect.poll(() => priceListItems.some(item => item.product_id === 'bulk-stock-included')).toBe(true);
    await includedCheckbox(panel).check();
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
    if (width === 360) {
      const mobileList = page.getByTestId('reseller-price-list-mobile');
      await expect(mobileList.getByRole('button', { name: 'Editar precio de Auricular Bluetooth P47' })).toBeVisible();
      await mobileList.getByLabel('Elegir Auricular Bluetooth P47').check();
    } else {
      const row = page.getByRole('row', { name: /Auricular Bluetooth P47/ });
      await expect(row).toBeVisible();
      await row.getByLabel('Elegir Auricular Bluetooth P47').check();
    }
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
  await menu.getByLabel('Buscar acciones y secciones').fill('Revendedores');
  const resellerLink = menu.getByRole('link', { name: 'Revendedores' });
  await expect(resellerLink).toBeVisible();
  await expect(resellerLink).toHaveAttribute('href', '/revendedores');
  await menu.screenshot({ path: 'test-results/i29-mobile-more-revendedores-360.png' });
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

test('I35 keeps reseller tabs and price rows usable on mobile at 360 and 412 px', async ({ page }, testInfo) => {
  const { products, bulkCalls, priceListItems } = await mockApp(page, { mobileListFixture: true });
  const tabNames = ['Resumen', 'Lista de precios', 'Proveedores', 'Encargos', 'Ajustes'] as const;
  const tabFiles = ['summary', 'prices', 'providers', 'orders', 'settings'] as const;

  for (const width of [360, 412, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 960 : 820 });
    await page.goto('/revendedores');
    const tabs = page.getByRole('tablist', { name: 'Secciones de Revendedores' });
    await expect(tabs.getByRole('tab')).toHaveCount(5);
    if (width < 640) {
      const tabDimensions = await tabs.evaluate(element => ({ overflowX: getComputedStyle(element).overflowX, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      expect(tabDimensions.overflowX).toBe('auto');
      expect(tabDimensions.scrollWidth).toBeGreaterThan(tabDimensions.clientWidth);
    }

    for (let index = 0; index < tabNames.length; index++) {
      const tab = tabs.getByRole('tab', { name: tabNames[index] });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      if (tabNames[index] === 'Resumen') await expect(page.getByRole('tabpanel', { name: 'Resumen de Revendedores' })).toBeVisible();
      if (tabNames[index] === 'Lista de precios') {
        await expect(page.getByTestId('reseller-price-list')).toBeVisible();
        if (width < 640) {
          await expect(page.getByTestId('reseller-price-list-mobile')).toBeVisible();
          await expect(page.getByTestId('reseller-price-list-mobile').getByText('[QA] Móvil producto 1')).toBeVisible();
          await expect(page.getByRole('table', { name: 'Productos de la lista de precios' })).toHaveCount(0);
        } else {
          await expect(page.getByRole('table', { name: 'Productos de la lista de precios' })).toBeVisible();
        }
      }
      if (tabNames[index] === 'Proveedores') await expect(page.getByRole('tabpanel', { name: 'Proveedores' })).toBeVisible();
      if (tabNames[index] === 'Encargos') await expect(page.getByRole('tabpanel', { name: 'Encargos' })).toBeVisible();
      if (tabNames[index] === 'Ajustes') await expect(page.getByRole('tabpanel', { name: 'Ajustes' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width !== 1440) await page.screenshot({ path: testInfo.outputPath(`i35-${tabFiles[index]}-${width}.png`), fullPage: true });
    }

    if (width === 360) {
      const mobileList = page.getByTestId('reseller-price-list-mobile');
      await tabs.getByRole('tab', { name: 'Lista de precios' }).click();
      await mobileList.getByRole('button', { name: 'Editar precio de [QA] Móvil producto 1' }).click();
      await expect(page.getByRole('dialog', { name: 'Editar [QA] Móvil producto 1' })).toBeVisible();
      await page.getByRole('button', { name: 'Cerrar edición' }).click();

      for (let index = 1; index <= 3; index++) await mobileList.getByLabel(`Elegir [QA] Móvil producto ${index}`).check();
      const toolbar = page.getByRole('toolbar', { name: 'Acciones para productos elegidos' });
      await expect(toolbar).toContainText('3 elegidos');
      const bottomBarLayout = await page.evaluate(() => {
        const toolbarElement = document.querySelector('[aria-label="Acciones para productos elegidos"]');
        const navigationElement = document.querySelector('.mobile-navigation-bar');
        if (!toolbarElement || !navigationElement) return null;
        return { toolbarBottom: toolbarElement.getBoundingClientRect().bottom, navigationTop: navigationElement.getBoundingClientRect().top, toolbarPosition: getComputedStyle(toolbarElement).position };
      });
      expect(bottomBarLayout?.toolbarPosition).toBe('fixed');
      expect(bottomBarLayout?.toolbarBottom).toBeLessThanOrEqual(bottomBarLayout?.navigationTop ?? 0);

      await toolbar.getByRole('button', { name: 'Quitar de la lista' }).click();
      const confirmation = page.getByRole('dialog', { name: 'Confirmar cambios en la lista' });
      await expect(confirmation).toContainText('3 productos de la lista de revendedores. No se borran de tu stock.');
      await confirmation.getByRole('button', { name: 'Quitar de la lista' }).click();
      await expect.poll(() => priceListItems.length).toBe(0);
      expect(products).toHaveLength(3);
      expect(bulkCalls.at(-1)?.productIds).toEqual(['mobile-price-1', 'mobile-price-2', 'mobile-price-3']);

      await page.getByRole('button', { name: 'Deshacer' }).click();
      await expect.poll(() => priceListItems.length).toBe(3);
      expect(products).toHaveLength(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
});
