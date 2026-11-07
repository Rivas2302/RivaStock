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

function fixtureConfig(theme: 'normal' | 'christmas' | 'children-day' | 'new-year', offerEndsAt = '2099-01-01T00:00') {
  const titles = { normal: 'Encontrá lo que buscás', christmas: 'Regalos para compartir', 'children-day': 'Un regalo para cada aventura', 'new-year': 'Empezá el año con algo nuevo' };
  const heroColors = { normal: '#172033', christmas: '#164632', 'children-day': '#F1D98B', 'new-year': '#202226' };
  const accentColors = { normal: '#3156A6', christmas: '#B23A48', 'children-day': '#6B55A1', 'new-year': '#9B7A35' };
  return {
    id: '8af7667f-e8db-46aa-b246-4fba337d9580', user_id: OWNER_ID, business_name: 'Tienda de prueba', slug: 'qa-catalog',
    enabled: true, show_prices: true, show_out_of_stock: false, show_stock: true, show_stock_quantity: false,
    welcome_message: 'Productos elegidos con cuidado.', primary_color: accentColors[theme], accent_color: accentColors[theme],
    allow_orders: true, layout: 'Grid', font_style: 'Modern', whatsapp_number: '5491100000000',
    presentation: {
      theme, schedules: [], heroTitle: titles[theme], heroDescription: 'Productos elegidos con cuidado.',
      heroImageUrl: null, heroColor: heroColors[theme], accentColor: accentColors[theme],
      sections: [{ id: 'featured', visible: false }, { id: 'offers', visible: true }, { id: 'categories', visible: true }, { id: 'new', visible: false }, { id: 'all', visible: true }],
      featuredProductIds: [], featuredCategoryId: null, offerProductIds: [PRODUCT_ID], offerDiscountPercentByProduct: { [PRODUCT_ID]: 20 }, offerEndsAt,
      ambience: { intensity: 'normal', animatedEffects: true, headerDecoration: true, productDecoration: true, countdown: true, announcementText: 'Envíos en General Pico', themedFont: true, welcomeCard: true },
      showWhatsAppButton: true, showProductsWithoutPhoto: true, whatsappMessageTemplate: 'Hola, quiero {producto} por {precio}, cantidad {cantidad}. {link}',
    },
  };
}

async function mockCatalogApi(page: Page, theme: 'normal' | 'christmas' | 'children-day' | 'new-year' = 'normal', offerEndsAt?: string, resellerRounds: false | 'all' | 'group' = false) {
  const roundId = '017e8786-e22a-4d48-8602-0bc5c818aac2';
  await page.route('**/rest/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname.endsWith('/catalog_config')) return route.fulfill({ json: [fixtureConfig(theme, offerEndsAt)] });
    if (pathname.endsWith('/categories')) return route.fulfill({ json: [{ id: CATEGORY_ID, name: 'Cables', user_id: OWNER_ID }] });
    if (pathname.endsWith('/rpc/get_public_catalog_products')) return route.fulfill({ json: [product] });
    if (pathname.endsWith('/rpc/get_public_catalog_product')) return route.fulfill({ json: product });
    if (pathname.endsWith('/rpc/get_public_inventory_owner_labels')) return route.fulfill({ json: [] });
    if (pathname.endsWith('/rpc/get_reseller_catalog_status')) return route.fulfill({ json: { enabled: Boolean(resellerRounds) } });
    if (resellerRounds && pathname.endsWith('/rpc/unlock_reseller_catalog')) {
      if (resellerRounds === 'group') return route.fulfill({ status: 400, json: { message: 'El código no es válido.' } });
      return route.fulfill({ json: {
      enabled: true, priceListId: '109d526d-eb86-4367-99ea-e24fc35eea41', minimumRule: 'none', minimumOrderAmount: 0,
      minimumOrderQuantity: 0, products: [{ ...product, availability: 'on_order' }],
      } });
    }
    if (resellerRounds && pathname.endsWith('/rpc/get_public_reseller_supplier_rounds')) {
      const accessCode = (route.request().postDataJSON() as { p_access_code?: string }).p_access_code;
      if (resellerRounds === 'group' && accessCode !== 'CODIGO-GRUPO-QA') return route.fulfill({ json: [] });
      return route.fulfill({ json: [{
      id: roundId, supplierListId: '1f3e5fb4-c82d-4a75-b867-c4e571dfb64b', supplierName: 'Proveedor de prueba',
      audienceName: resellerRounds === 'group' ? 'Revendedores de General Pico' : 'Todos los revendedores',
      closesAt: '2099-12-01T21:00:00.000Z', minimumOrderAmount: 0,
      products: [{ ...product, salePrice: 6800 }],
      }] });
    }
    if (resellerRounds && pathname.endsWith('/rpc/create_public_reseller_supplier_round_order')) return route.fulfill({ json: {
      id: '9c2a6eab-e43d-40cc-9a58-5533d3c3ec6d', total: 6800, closesAt: '2099-12-01T21:00:00.000Z',
    } });
    if (pathname.endsWith('/rpc/create_public_catalog_order')) throw new Error('The catalog preview must never create an order.');
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
  await expect(addButton).toBeVisible();
  await page.getByRole('button', { name: 'Agregar Cable USB-C al carrito' }).last().click();
  await page.getByRole('button', { name: /Abrir carrito, 1 productos/ }).click();
  await expect(page.getByText(/6\.800/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar Pedido' }).click();
  await expect(page.getByRole('heading', { name: 'Finalizar Pedido' })).toBeVisible();
  expect(orderSubmitted).toBe(false);
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
