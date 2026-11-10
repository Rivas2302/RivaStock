import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const PRODUCT_ID = 'b8724ee3-8d5b-4ff0-a32f-d98a09c18012';
const OWNER_ID = '4ea3b55c-d0fa-4a0e-a98b-d289bd930a41';
const CATEGORY_ID = 'c6804a78-fb64-4a5b-8835-184b8e31b5a7';
const productImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#dbeafe"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="42" fill="#172033">Cable USB-C</text></svg>')}`;
const product = {
  id: PRODUCT_ID, name: 'Cable USB-C', categoryId: CATEGORY_ID, category: 'Cables', salePrice: 8500,
  stock: 4, imageUrl: productImage, images: [productImage], description: 'Carga rápida y conexión confiable.',
  availability: 'in_stock', createdAt: '2026-11-05T12:00:00.000Z',
};

function fixtureConfig(theme: 'normal' | 'christmas' | 'children-day' | 'new-year', offerEndsAt = '2099-01-01T00:00', showOutOfStock = false, emptyCatalog = false) {
  const titles = { normal: 'Encontrá lo que buscás', christmas: 'Regalos para compartir', 'children-day': 'Un regalo para cada aventura', 'new-year': 'Empezá el año con algo nuevo' };
  const heroColors = { normal: '#172033', christmas: '#164632', 'children-day': '#F1D98B', 'new-year': '#202226' };
  const accentColors = { normal: '#3156A6', christmas: '#B23A48', 'children-day': '#6B55A1', 'new-year': '#9B7A35' };
  return {
    id: '8af7667f-e8db-46aa-b246-4fba337d9580', user_id: OWNER_ID, business_name: 'Tienda de prueba', slug: 'qa-catalog',
    enabled: true, show_prices: true, show_out_of_stock: showOutOfStock, show_stock: true, show_stock_quantity: false,
    category_photos_enabled: true, category_photo_overrides: {},
    welcome_message: emptyCatalog ? '' : 'Productos elegidos con cuidado.', primary_color: accentColors[theme], accent_color: accentColors[theme],
    allow_orders: true, layout: 'Grid', font_style: 'Modern', whatsapp_number: '5491100000000',
    presentation: {
      theme, schedules: [], heroTitle: emptyCatalog ? '' : titles[theme], heroDescription: emptyCatalog ? '' : 'Productos elegidos con cuidado.',
      heroImageUrl: null, heroColor: heroColors[theme], accentColor: accentColors[theme],
      sections: [{ id: 'featured', visible: false }, { id: 'offers', visible: true }, { id: 'categories', visible: true }, { id: 'new', visible: false }, { id: 'all', visible: true }],
      featuredProductIds: [], featuredCategoryId: null, offerProductIds: [PRODUCT_ID], offerDiscountPercentByProduct: { [PRODUCT_ID]: 20 }, offerEndsAt,
      ambience: { intensity: 'normal', animatedEffects: true, headerDecoration: true, productDecoration: true, countdown: true, announcementText: 'Envíos en General Pico', themedFont: true, welcomeCard: true },
      showWhatsAppButton: true, showProductsWithoutPhoto: true, whatsappMessageTemplate: 'Hola, quiero {producto} por {precio}, cantidad {cantidad}. {link}',
    },
  };
}

async function mockCatalogApi(page: Page, theme: 'normal' | 'christmas' | 'children-day' | 'new-year' = 'normal', offerEndsAt?: string, resellerRounds: false | 'all' | 'group' = false, productOverrides: Partial<typeof product> = {}, showOutOfStock = false, includeRelatedProduct = false, allowPublicOrder = false, businessWhatsApp: string | null = '5491100000000', emptyCatalog = false, categoryOverrides?: Array<{ id: string; name: string; user_id: string }>, legacyCatalogSlug?: string, categoryPhotoOverrides: Record<string, string> = {}) {
  const roundId = '017e8786-e22a-4d48-8602-0bc5c818aac2';
  const catalogProduct = { ...product, ...productOverrides };
  const catalogProducts = emptyCatalog ? [] : includeRelatedProduct ? [catalogProduct, { ...product, id: 'related-product', name: 'Cable Lightning' }] : [catalogProduct];
  await page.route('**/rest/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname.endsWith('/catalog_config')) {
      const requestedSlug = url.searchParams.get('slug')?.replace(/^eq\./, '');
      if (legacyCatalogSlug && requestedSlug === legacyCatalogSlug) return route.fulfill({ json: [] });
      return route.fulfill({ json: [{ ...fixtureConfig(theme, offerEndsAt, showOutOfStock, emptyCatalog), whatsapp_number: businessWhatsApp, category_photo_overrides: categoryPhotoOverrides }] });
    }
    if (legacyCatalogSlug && pathname.endsWith('/rpc/resolve_public_catalog_slug')) return route.fulfill({ json: 'qa-catalog' });
    if (pathname.endsWith('/categories')) return route.fulfill({ json: categoryOverrides ?? [{ id: CATEGORY_ID, name: 'Cables', user_id: OWNER_ID }] });
    if (pathname.endsWith('/rpc/get_public_catalog_products')) return route.fulfill({ json: catalogProducts });
    if (pathname.endsWith('/rpc/get_public_catalog_product')) return route.fulfill({ json: catalogProduct });
    if (pathname.endsWith('/rpc/get_public_inventory_owner_labels')) return route.fulfill({ json: [] });
    if (pathname.endsWith('/rpc/get_reseller_catalog_status')) return route.fulfill({ json: { enabled: Boolean(resellerRounds) } });
    if (resellerRounds && pathname.endsWith('/rpc/unlock_reseller_catalog')) {
      const accessCode = (route.request().postDataJSON() as { p_access_code?: string }).p_access_code;
      if (resellerRounds === 'group' && accessCode !== 'CODIGO-GRUPO-QA') {
        return route.fulfill({ status: 400, json: { message: 'El código no es válido.' } });
      }
      return route.fulfill({ json: {
      enabled: true, priceListId: '109d526d-eb86-4367-99ea-e24fc35eea41', minimumRule: 'none', minimumOrderAmount: 0,
      minimumOrderQuantity: 0, products: [{ ...catalogProduct, availability: 'on_order' }],
      } });
    }
    if (resellerRounds && pathname.endsWith('/rpc/get_public_reseller_supplier_rounds')) {
      const accessCode = (route.request().postDataJSON() as { p_access_code?: string }).p_access_code;
      if (resellerRounds === 'group' && accessCode !== 'CODIGO-GRUPO-QA') return route.fulfill({ json: [] });
      return route.fulfill({ json: [{
      id: roundId, supplierListId: '1f3e5fb4-c82d-4a75-b867-c4e571dfb64b', supplierName: 'Proveedor de prueba',
      audienceName: resellerRounds === 'group' ? 'Revendedores de General Pico' : 'Todos los revendedores',
      closesAt: '2099-12-01T21:00:00.000Z', minimumOrderAmount: 0,
      products: [{ ...catalogProduct, salePrice: 6800 }],
      }] });
    }
    if (resellerRounds && pathname.endsWith('/rpc/get_public_reseller_buying_policy')) return route.fulfill({ json: 'Pago coordinado por WhatsApp.' });
    if (resellerRounds && pathname.endsWith('/rpc/create_public_reseller_supplier_round_order')) return route.fulfill({ json: {
      id: '9c2a6eab-e43d-40cc-9a58-5533d3c3ec6d', total: 6800, closesAt: '2099-12-01T21:00:00.000Z',
    } });
    if (pathname.endsWith('/rpc/create_public_catalog_order')) {
      if (!allowPublicOrder) throw new Error('The catalog preview must never create an order.');
      return route.fulfill({ json: {
        id: 'c0000000-0000-4000-8000-000000000001', orderCode: 'P-0042', total: 6800, channel: 'retail',
        items: [{ productId: PRODUCT_ID, productName: 'Cable USB-C', quantity: 1, price: 6800 }],
      } });
    }
    return route.fulfill({ status: 200, json: [] });
  });
}

test('public catalog mobile flow reaches checkout without submitting an order', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockCatalogApi(page);
  let orderSubmitted = false;
  page.on('request', request => { if (request.url().includes('/rpc/create_public_catalog_order')) orderSubmitted = true; });
  await page.goto('/catalogo/qa-catalog');
  await expect(page.getByRole('heading', { name: 'Encontrá lo que buscás' })).toBeVisible();
  const categoryCircle = page.locator('section[aria-label="Categorías"] button span').first();
  const categoryBox = await categoryCircle.boundingBox();
  expect(categoryBox?.width).toBe(categoryBox?.height);
  expect(Number.parseFloat(await categoryCircle.evaluate(element => getComputedStyle(element).borderRadius))).toBeGreaterThan(20);
  await expect(page.getByText('−20 %').first()).toBeVisible();
  await page.getByPlaceholder('Busca en nuestra colección...').fill('Cable');
  await expect(page.getByText('Cable USB-C').first()).toBeVisible();
  const card = page.locator('.catalog-theme-card').last();
  const cardBox = await card.boundingBox();
  const addButton = card.getByRole('button', { name: 'Agregar Cable USB-C al carrito' });
  const addBox = await addButton.boundingBox();
  expect(cardBox && addBox && cardBox.x >= 0 && cardBox.x + cardBox.width <= 360 && addBox.x >= cardBox.x && addBox.x + addBox.width <= cardBox.x + cardBox.width, JSON.stringify({ cardBox, addBox })).toBe(true);
  const categoryChip = card.getByTestId('catalog-product-category');
  const cardCategoryBox = await categoryChip.boundingBox();
  expect(cardCategoryBox && cardCategoryBox.x >= cardBox!.x && cardCategoryBox.x + cardCategoryBox.width <= cardBox!.x + cardBox!.width).toBe(true);
  expect(Number.parseFloat(await categoryChip.evaluate(element => getComputedStyle(element).borderRadius))).toBeGreaterThanOrEqual((cardCategoryBox?.height ?? 0) / 2);
  await expect(addButton).toBeVisible();
  await page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' }).last().click();
  await page.getByRole('button', { name: /Abrir carrito, 1 productos/ }).click();
  await expect(page.getByText(/6\.800/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar Pedido' }).click();
  await expect(page.getByRole('heading', { name: 'Finalizar Pedido' })).toBeVisible();
  expect(orderSubmitted).toBe(false);
});

test('category circles use visible product photos and product navigation returns to the catalog', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockCatalogApi(page);
  await page.goto('/catalogo/qa-catalog');
  const avatars = page.locator('section[aria-label="Categorías"] [data-testid="catalog-category-avatar"]');
  await expect(avatars).toHaveCount(2);
  await expect(avatars.first().locator('img')).toHaveCount(1);
  await expect(avatars.first()).toHaveClass(/rounded-full/);
  await page.getByRole('button', { name: 'Cable USB-C', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/catalogo/qa-catalog/${PRODUCT_ID}$`));
  await expect(page.getByTestId('catalog-product-detail-modal').getByRole('heading', { name: 'Cable USB-C' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);
  await expect(page.getByRole('button', { name: 'Cable USB-C', exact: true })).toBeVisible();
});

test('the configurable Todos photo is visible in the retail catalog', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockCatalogApi(page, 'normal', undefined, false, {}, false, false, false, '5491100000000', false, undefined, undefined, { all: 'https://assets.test/todos.webp' });
  await page.goto('/catalogo/qa-catalog');
  const todos = page.locator('section[aria-label="Categorías"] [data-testid="catalog-category-avatar"]').first();
  await expect(todos.locator('img')).toHaveAttribute('src', 'https://assets.test/todos.webp');
});

test('old catalog and product links redirect to the current slug without losing the product', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockCatalogApi(page, 'normal', undefined, false, {}, false, false, false, '5491100000000', false, undefined, 'bazar-viejo');

  await page.goto(`/catalogo/bazar-viejo/${PRODUCT_ID}?origen=compartido#producto`);

  await expect(page).toHaveURL(new RegExp(`/catalogo/qa-catalog/${PRODUCT_ID}\\?origen=compartido#producto$`));
  await expect(page.getByTestId('catalog-product-detail-modal')).toBeVisible();
  await expect(page.getByTestId('catalog-product-detail-modal').getByRole('heading', { name: 'Cable USB-C' })).toBeVisible();
});

test('product detail is a catalog modal with browser history, scroll, direct links, and related products', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('catalog-dark-mode', 'false'));
  await mockCatalogApi(page, 'christmas', undefined, false, {}, false, true);

  for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/catalogo/qa-catalog');
    const cableCategory = page.getByRole('button', { name: 'Cables', exact: true });
    await cableCategory.click();
    await expect(cableCategory).toHaveAttribute('aria-pressed', 'true');
    const search = page.getByPlaceholder('Busca en nuestra colección...');
    await search.fill('Cable');
    await page.locator('.catalog-theme-card').last().scrollIntoViewIfNeeded();
    const scrollBeforeOpen = await page.evaluate(() => window.scrollY);
    await page.getByRole('button', { name: 'Cable USB-C', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/catalogo/qa-catalog/${PRODUCT_ID}$`));
    await expect(page.getByTestId('catalog-product-detail-overlay')).toBeVisible();
    await expect(page.getByTestId('public-catalog-hero')).toBeAttached();
    const detailModal = page.getByTestId('catalog-product-detail-modal');
    await expect(detailModal).toHaveAttribute('data-catalog-theme', 'christmas');
    await expect(detailModal.locator('img[alt="Cable USB-C"]')).toBeVisible();
    await expect(detailModal.getByRole('button', { name: 'WhatsApp' }).first()).toBeVisible();
    expect(await detailModal.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(252, 250, 245)');
    expect(await detailModal.getByRole('button', { name: /Agregar al carrito/ }).last()
      .evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(178, 58, 72)');
    await expect(page.getByRole('button', { name: 'Copiar link' }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Agregar al carrito' }).last()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);
    await expect(search).toHaveValue('Cable');
    await expect(cableCategory).toHaveAttribute('aria-pressed', 'true');
    expect(Math.abs(await page.evaluate(() => window.scrollY) - scrollBeforeOpen)).toBeLessThanOrEqual(2);

    await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
    await page.getByRole('button', { name: 'Cable USB-C', exact: true }).click();
    await expect(detailModal).toBeVisible();
    expect(await detailModal.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(17, 17, 17)');
    await page.getByRole('button', { name: 'Volver al catálogo' }).click();
    await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);

    await page.getByRole('button', { name: 'Cable USB-C', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar ficha del producto' }).click({ position: { x: 5, y: 5 } });
    await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);

    await page.getByRole('button', { name: 'Cable USB-C', exact: true }).click();
    await page.goBack();
    await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);
    await expect(page.getByTestId('catalog-product-detail-overlay')).toHaveCount(0);

    await page.getByRole('button', { name: 'Cable USB-C', exact: true }).click();
    await page.getByTestId('catalog-product-detail-modal').getByRole('button', { name: 'Cable Lightning', exact: true }).click();
    await expect(page).toHaveURL(/\/catalogo\/qa-catalog\/related-product$/);
    await expect(page.getByRole('dialog', { name: 'Cable Lightning' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);

    await page.goto(`/catalogo/qa-catalog/${PRODUCT_ID}`);
    await expect(page.getByTestId('catalog-product-detail-overlay')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);
    await expect(page.getByTestId('catalog-product-detail-overlay')).toHaveCount(0);
  }
});

test('reseller direct product details require the reseller session and show only reseller-facing data', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockCatalogApi(page, 'normal', undefined, 'group', {}, false, false, false, '5491100000000', true);
  await page.goto(`/catalogo/qa-catalog/${PRODUCT_ID}`);
  await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);
  await expect(page.getByTestId('catalog-product-detail-overlay')).toHaveCount(0);
  await page.evaluate(() => {
    sessionStorage.setItem('catalog-reseller-session:qa-catalog', 'CODIGO-GRUPO-QA');
    sessionStorage.setItem('catalog-channel:qa-catalog', 'reseller');
  });
  for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/catalogo/qa-catalog/${PRODUCT_ID}`);
    const modal = page.getByTestId('catalog-product-detail-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('6.800');
    await expect(modal).not.toContainText(/proveedor|costo|código/i);
    await page.getByRole('button', { name: 'Volver al catálogo' }).click();
    await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);
  }
});

test('reseller catalog categories filter imported products and open their detail modal', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockCatalogApi(page, 'normal', undefined, 'group', { categoryId: '', category: 'Electrónica y accesorios', stock: 0 }, false, false, false, '5491100000000', false, undefined, undefined, { all: 'https://assets.test/todos.webp' });
  await page.goto('/catalogo/qa-catalog');
  await page.getByRole('button', { name: 'Revendedores' }).click();
  await page.getByPlaceholder('Código de acceso').fill('CODIGO-GRUPO-QA');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.locator('section[aria-label="Categorías"] [data-testid="catalog-category-avatar"]').first().locator('img')).toHaveAttribute('src', 'https://assets.test/todos.webp');
  const category = page.getByRole('button', { name: /Electrónica y accesorios/ });
  await expect(category).toContainText('1');
  await category.click();
  await expect(page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' })).toBeVisible();
  await page.getByRole('button', { name: 'Cable USB-C', exact: true }).click();
  const modal = page.getByTestId('catalog-product-detail-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('6.800');
  await expect(modal).not.toContainText(/proveedor|costo|código/i);
});

test('retail checkout saves a fixture order code and prepares the exact WhatsApp message', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCatalogApi(page, 'normal', undefined, false, {}, false, false, true);
  let submittedPayload: Record<string, unknown> | null = null;
  page.on('request', request => {
    if (request.url().endsWith('/rpc/create_public_catalog_order')) submittedPayload = request.postDataJSON() as Record<string, unknown>;
  });

  await page.goto('/catalogo/qa-catalog');
  await page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' }).last().click();
  await page.getByRole('button', { name: /Abrir carrito/ }).click();
  await page.getByRole('button', { name: 'Confirmar Pedido' }).click();
  await page.getByPlaceholder('Nombre completo').fill('Compradora de prueba');
  await page.getByPlaceholder('WhatsApp').fill('2302000000');
  await expect(page.getByPlaceholder('Email')).not.toHaveAttribute('required', '');
  await expect(page.getByPlaceholder('Dirección de entrega')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retiro' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Enviar Pedido' }).click();

  await expect(page.getByRole('heading', { name: '¡Pedido recibido!' })).toBeVisible();
  await expect(page.getByTestId('retail-order-code')).toHaveText('P-0042');
  const whatsappLink = page.getByRole('link', { name: 'Enviar pedido por WhatsApp' });
  const whatsappUrl = new URL(await whatsappLink.getAttribute('href') ?? '');
  expect(whatsappUrl.hostname).toBe('wa.me');
  expect(whatsappUrl.searchParams.get('text')).toContain('Pedido P-0042');
  expect(whatsappUrl.searchParams.get('text')).toContain('1 × Cable USB-C · $ 6.800');
  expect(whatsappUrl.searchParams.get('text')).toContain('Total: $ 6.800');
  expect(whatsappUrl.searchParams.get('text')).toContain('Entrega: Retiro');
  expect(whatsappUrl.searchParams.get('text')).toContain('Ver pedido: https://rivastock.vercel.app/pedidos/P-0042');
  expect(submittedPayload?.p_customer).toMatchObject({ name: 'Compradora de prueba', phone: '2302000000', email: '', address: '', deliveryMethod: 'pickup' });

  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: /Abrir carrito/ }).click();
  await expect(page.getByTestId('retail-order-code')).toHaveText('P-0042');
  await expect(page.getByRole('link', { name: 'Enviar pedido por WhatsApp' })).toBeVisible();
});

test('retail shipping requires an address and enables address autocomplete', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCatalogApi(page);
  await page.goto('/catalogo/qa-catalog');
  await page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' }).last().click();
  await page.getByRole('button', { name: /Abrir carrito/ }).click();
  await page.getByRole('button', { name: 'Confirmar Pedido' }).click();
  await page.getByRole('button', { name: 'Envío' }).click();
  const address = page.getByPlaceholder('Dirección de entrega');
  await expect(address).toHaveAttribute('required', '');
  await expect(address).toHaveAttribute('autocomplete', 'street-address');
});

test('an empty catalog uses neutral defaults and keeps the business separate from RivaTech', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockCatalogApi(page, 'normal', undefined, false, {}, false, false, false, null, true);
  await page.goto('/catalogo/qa-catalog');
  await expect(page.getByRole('heading', { name: 'Tienda de prueba' })).toBeVisible();
  await expect(page.getByText('Encontrá lo que buscás.')).toBeVisible();
  await expect(page.getByText(/RivaTech|Premium Tech Experience|TECNOLOGIA AL MEJOR PRECIO/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Abrir carrito' })).toBeVisible();
});

test('a retail order without a configured WhatsApp number still saves and shows its code', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCatalogApi(page, 'normal', undefined, false, {}, false, false, true, null);
  await page.goto('/catalogo/qa-catalog');
  await page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' }).last().click();
  await page.getByRole('button', { name: /Abrir carrito/ }).click();
  await page.getByRole('button', { name: 'Confirmar Pedido' }).click();
  await page.getByPlaceholder('Nombre completo').fill('Compradora de prueba');
  await page.getByPlaceholder('WhatsApp').fill('2302000000');
  await page.getByRole('button', { name: 'Enviar Pedido' }).click();
  await expect(page.getByTestId('retail-order-code')).toHaveText('P-0042');
  await expect(page.getByRole('link', { name: 'Enviar pedido por WhatsApp' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Ver pedido' })).toBeVisible();
});

for (const viewport of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) {
  test(`public catalog shows the cleaned supplier fixture name without its source code at ${viewport.width}px`, async ({ page }) => {
    const humidifierImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><defs><radialGradient id="g"><stop stop-color="#ffbb55"/><stop offset="1" stop-color="#c84d25"/></radialGradient></defs><rect width="640" height="640" fill="#ede9e2"/><rect x="218" y="112" width="204" height="412" rx="34" fill="#2b2b2b"/><rect x="240" y="142" width="160" height="340" rx="80" fill="#171717"/><path d="M274 420c-26-56 42-72 28-124 60 38 61 74 37 124 40-24 43-61 25-89 59 53 47 110-5 130h-78c-45-19-47-55-7-82z" fill="url(#g)"/><circle cx="320" cy="505" r="5" fill="#c7c7c7"/></svg>')}`;
    await page.setViewportSize(viewport);
    await mockCatalogApi(page, 'normal', undefined, false, {
      name: 'Humificador LED estilo fuego',
      category: 'Hogar',
      imageUrl: humidifierImage,
      images: [humidifierImage],
    });
    await page.goto('/catalogo/qa-catalog');
    await expect(page.getByRole('button', { name: 'Humificador LED estilo fuego', exact: true }).last()).toBeVisible();
    await expect(page.getByText(/HM352/i)).toHaveCount(0);
    await page.screenshot({ path: `test-results/i30-public-catalog-clean-name-${viewport.width}.png`, fullPage: true });
  });
}

test('out-of-stock products are hidden by default and remain orderable when enabled', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockCatalogApi(page, 'normal', undefined, false, { stock: 0, availability: 'out_of_stock' });
  await page.goto('/catalogo/qa-catalog');
  await expect(page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' })).toHaveCount(0);
  await expect(page.getByText('PRINCIPAL', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Últimas unidades', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^(Disponible|Stock:)/)).toHaveCount(0);
  await mockCatalogApi(page, 'normal', undefined, false, { stock: 0, availability: 'out_of_stock' }, true);
  await page.goto('/catalogo/qa-catalog');
  const addButton = page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' }).last();
  await expect(addButton).toBeVisible();
  await expect(page.getByText('AGOTADO', { exact: true }).first()).toBeVisible();
  await addButton.click();
  await addButton.click();
  await page.getByRole('button', { name: /Abrir carrito/ }).click();
  await expect(page.getByRole('button', { name: /Abrir carrito/ })).toContainText('2');
  await expect(page.getByText('No hay más stock disponible.')).toHaveCount(0);
});

test('direct product route hides out-of-stock products unless the owner enables them', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockCatalogApi(page, 'normal', undefined, false, { stock: 0, availability: 'out_of_stock' });
  await page.goto(`/catalogo/qa-catalog/${PRODUCT_ID}`);
  await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);
  await expect(page.getByTestId('catalog-product-detail-overlay')).toHaveCount(0);
  await mockCatalogApi(page, 'normal', undefined, false, { stock: 0, availability: 'out_of_stock' }, true);
  await page.goto(`/catalogo/qa-catalog/${PRODUCT_ID}`);
  await expect(page.getByText(/Disponible|Sin stock|unidades/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar una unidad' }).click();
  await expect(page.getByTestId('catalog-product-detail-modal').getByRole('button', { name: /Agregar al carrito/ }).last()).toBeEnabled();
  await page.getByTestId('catalog-product-detail-modal').getByRole('button', { name: /Agregar al carrito/ }).last().click();
  await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);
  await expect(page.getByRole('button', { name: /Abrir carrito/ })).toContainText('2');
});

test('on-order product remains visible while out-of-stock display is disabled', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockCatalogApi(page, 'normal', undefined, false, { stock: 0, availability: 'on_order' });
  await page.goto('/catalogo/qa-catalog');
  await expect(page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' }).last()).toBeVisible();
});

test('public product detail hides stock and leaves space after related products', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockCatalogApi(page, 'normal', undefined, false, { stock: 3 }, false, true);
  await page.goto(`/catalogo/qa-catalog/${PRODUCT_ID}`);
  await expect(page.getByText(/Disponible|Sin stock|unidades/)).toHaveCount(0);
  const related = page.getByRole('heading', { name: 'Productos relacionados' }).locator('..');
  await expect(related).toBeVisible();
  expect(await related.evaluate(element => getComputedStyle(element).paddingBottom)).toBe('32px');
});

test('reseller order round uses only its supplier products and directs payment to WhatsApp', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockCatalogApi(page, 'normal', undefined, 'group');
  const submittedRounds: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/rpc/create_public_reseller_supplier_round_order')) submittedRounds.push(request.postData() ?? '');
  });
  await page.goto('/catalogo/qa-catalog');
  await page.getByRole('button', { name: 'Revendedores' }).click();
  await page.getByPlaceholder('Código de acceso').fill('CODIGO-INCORRECTO');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert')).toContainText('El código no es válido');
  await page.getByPlaceholder('Código de acceso').fill('CODIGO-GRUPO-QA');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('region', { name: 'Rondas de pedidos por encargo' })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' }).click();
  await page.getByRole('button', { name: /Abrir carrito/ }).click();
  await page.getByRole('button', { name: 'Confirmar Pedido' }).click();
  await page.getByPlaceholder('Nombre completo').fill('Revendedor de prueba');
  await page.getByPlaceholder('WhatsApp').fill('2302000000');
  await page.getByRole('checkbox', { name: /Entiendo las condiciones/ }).check();
  await page.getByRole('button', { name: 'Enviar Pedido' }).click();
  await expect(page.getByRole('heading', { name: '¡Pedido recibido!' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Coordinar el pago por WhatsApp' })).toHaveAttribute('href', /wa\.me/);
  await expect(page.getByText(/alias|CBU|comprobante/i)).toHaveCount(0);
  expect(submittedRounds).toHaveLength(1);
  const payload = JSON.parse(submittedRounds[0]) as { p_round_id: string; p_access_code: string; p_items: Array<{ productId: string; quantity: number }> };
  expect(payload.p_round_id).toBe('017e8786-e22a-4d48-8602-0bc5c818aac2');
  expect(payload.p_access_code).toBe('CODIGO-GRUPO-QA');
  expect(payload.p_items).toEqual([{ productId: PRODUCT_ID, quantity: 1 }]);
});

test('renders screenshot references for Normal and the three seasonal themes', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mkdir(resolve('test-results/catalog-themes'), { recursive: true });
  for (const theme of ['normal', 'christmas', 'children-day', 'new-year'] as const) {
    await mockCatalogApi(page, theme);
    await page.goto('/catalogo/qa-catalog');
    await expect(page.getByTestId('public-catalog-hero')).toBeVisible();
    await expect(page.getByRole('note', { name: 'Anuncio del catálogo' })).toContainText('Envíos en General Pico');
    if (theme === 'christmas') await expect(page.getByText('Cuenta regresiva para Navidad')).toBeVisible();
    if (theme === 'new-year') await expect(page.getByText('Cuenta regresiva para Año Nuevo')).toBeVisible();
    await page.screenshot({ path: resolve(`test-results/catalog-themes/${theme}.png`), fullPage: true });
  }
});

test('seasonal effects stop when the visitor requests reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockCatalogApi(page, 'children-day');
  await page.goto('/catalogo/qa-catalog');
  const particle = page.locator('.catalog-theme-particle').first();
  await expect(particle).toBeAttached();
  await expect.poll(() => particle.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test('expired offers do not appear with a false discount or countdown', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockCatalogApi(page, 'normal', '2020-01-01T00:00');
  await page.goto('/catalogo/qa-catalog');
  await expect(page.getByRole('heading', { name: 'Ofertas relámpago' })).toHaveCount(0);
  await expect(page.getByText('−20%')).toHaveCount(0);
  await expect(page.getByText(/8\.500/).first()).toBeVisible();
});

test('product detail modal shares the G2 product URL and adds selected quantity', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockCatalogApi(page);
  await page.goto('/catalogo/qa-catalog');
  await page.getByRole('button', { name: 'Cable USB-C', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cable USB-C' }).last()).toBeVisible();
  await expect(page.getByText('Descripción')).toBeVisible();
  await expect(page.getByRole('button', { name: /Agregar al carrito/ }).last()).toBeVisible();
  await expect(page.getByText('Productos relacionados')).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar una unidad' }).click();
  await page.evaluate(() => { window.open = ((url?: string | URL) => { (window as Window & { __sharedUrl?: string }).__sharedUrl = String(url); return null; }) as typeof window.open; });
  await page.getByRole('button', { name: 'WhatsApp', exact: true }).last().click();
  const sharedUrl = await page.evaluate(() => (window as Window & { __sharedUrl?: string }).__sharedUrl ?? '');
  expect(sharedUrl).toContain('wa.me/5491100000000');
  expect(decodeURIComponent(sharedUrl)).toContain('Cable USB-C');
  expect(decodeURIComponent(sharedUrl)).toContain('2');
  expect(decodeURIComponent(sharedUrl)).toContain('/p/qa-catalog/');
  await page.getByRole('button', { name: /Agregar al carrito/ }).last().click();
  await expect(page.getByRole('button', { name: /Abrir carrito/ })).toContainText('2');
  await expect(page.getByRole('button', { name: /Abrir carrito/ })).toBeVisible();
});

test('direct product link returns to the catalog with its requested quantity in the cart', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockCatalogApi(page);
  await page.goto(`/catalogo/qa-catalog/${PRODUCT_ID}`);
  await page.getByRole('button', { name: 'Agregar una unidad' }).click();
  await page.getByRole('button', { name: /Agregar al carrito/ }).last().click();
  await expect(page).toHaveURL(/\/catalogo\/qa-catalog$/);
  await expect(page.getByRole('button', { name: /Abrir carrito/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Abrir carrito/ })).toContainText('2');
});

test('category labels and seasonal countdown meet automated contrast checks', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockCatalogApi(page, 'christmas');
  await page.goto('/catalogo/qa-catalog');
  await expect(page.getByTestId('public-catalog-hero')).toBeVisible();
  await expect(page.locator('.catalog-theme-card').first()).toHaveCSS('opacity', '1');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const contrastFailures = results.violations.filter(violation => violation.id === 'color-contrast');
  expect(contrastFailures, JSON.stringify(contrastFailures.map(item => item.nodes.map(node => node.html)), null, 2)).toHaveLength(0);
});

test('desktop catalog retains the MainPC grid and a usable cart entry point', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockCatalogApi(page, 'normal');
  await page.goto('/catalogo/qa-catalog');
  await expect(page.getByTestId('public-catalog-hero')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' }).last()).toBeVisible();
  const grid = page.locator('#catalog-section-all');
  const gridBox = await grid.boundingBox();
  expect(gridBox && gridBox.x + gridBox.width <= 1440).toBe(true);
  await mkdir(resolve('test-results/catalog-i18b'), { recursive: true });
  await page.screenshot({ path: resolve('test-results/catalog-i18b/main-pc.png'), fullPage: true });
});

test('category chips stay circular on mobile and desktop in light and dark mode', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mkdir(resolve('test-results/i25-categories'), { recursive: true });

  for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
    for (const darkMode of [false, true]) {
      await page.setViewportSize(viewport);
      await page.addInitScript((dark) => localStorage.setItem('catalog-dark-mode', String(dark)), darkMode);
      await mockCatalogApi(page);
      await page.goto('/catalogo/qa-catalog');

      const allCategories = page.getByRole('button', { name: 'Todos', exact: true });
      const cableCategory = page.getByRole('button', { name: 'Cables', exact: true });
      await expect(allCategories).toBeVisible();
      await expect(cableCategory).toHaveAttribute('aria-pressed', 'false');
      await cableCategory.click();
      await expect(cableCategory).toHaveAttribute('aria-pressed', 'true');

      await page.keyboard.press('Shift+Tab');
      await expect(allCategories).toBeFocused();
      const chipGeometry = await page.locator('button[aria-pressed="true"] > span[aria-hidden="true"]')
        .evaluate(element => ({ borderRadius: Number.parseFloat(getComputedStyle(element).borderRadius), bounds: element.getBoundingClientRect().toJSON() }));
      expect(chipGeometry.borderRadius).toBeGreaterThanOrEqual(chipGeometry.bounds.height / 2);
      expect(Math.abs(chipGeometry.bounds.width - chipGeometry.bounds.height)).toBeLessThanOrEqual(1);
      expect(chipGeometry.bounds.width).toBe(viewport.width < 640 ? 76 : 96);
      expect(await page.locator('.catalog-category-strip').evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
      const focusedGeometry = await allCategories.locator('span[aria-hidden="true"]').evaluate(element => ({
        borderRadius: Number.parseFloat(getComputedStyle(element).borderRadius),
        shadow: getComputedStyle(element).boxShadow,
      }));
      expect(focusedGeometry.borderRadius).toBeGreaterThanOrEqual(28);
      expect(focusedGeometry.shadow).not.toBe('none');

      const theme = darkMode ? 'dark' : 'light';
      await page.screenshot({
        path: resolve(`test-results/i25-categories/categories-${viewport.width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
});

test('desktop category strip shows arrows only when more categories can be scrolled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const categoryRows = Array.from({ length: 18 }, (_, index) => ({ id: `category-${index}`, name: `Categoría ${index + 1}`, user_id: OWNER_ID }));
  await mockCatalogApi(page, 'normal', undefined, false, {}, false, false, false, '5491100000000', false, categoryRows);
  await page.goto('/catalogo/qa-catalog');
  await expect(page.getByRole('button', { name: 'Desplazar categorías a la derecha' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desplazar categorías a la izquierda' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Desplazar categorías a la derecha' }).click();
  await expect(page.getByRole('button', { name: 'Desplazar categorías a la izquierda' })).toBeVisible();
});
