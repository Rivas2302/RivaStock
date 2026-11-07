import { expect, test, type Page, type Route } from '@playwright/test';

const owner = '10000000-0000-4000-8000-000000000001';
const now = new Date().toISOString();
const priceList = { id: 'price-list-qa', user_id: owner, kind: 'reseller', default_discount_percent: 20, public_enabled: false, minimum_rule: 'none', minimum_order_amount: 0, minimum_order_quantity: 0 };
const supplier = { id: 'supplier-qa', user_id: owner, name: '[QA] Mr Tecno', name_lower: '[qa] mr tecno', is_active: true };
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

async function mockApp(page: Page) {
  const products: Record<string, unknown>[] = [];
  const categories: Record<string, unknown>[] = [{ id: 'category-general', user_id: owner, name: 'General' }];
  let supplierProductIds: string[] = [];
  let changedCatalog = false;
  const sourceCosts: number[] = [];
  const pricingCalls: unknown[][] = [];

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
      sourceCosts.push(changedCatalog ? 8.75 : 7.75);
      return route.fulfill({ json: {
        source: 'woocommerce', currency: 'USD', items: [
          { code: '1015', name: 'Lámpara solar', price: changedCatalog ? 8.75 : 7.75, category: 'Iluminación', imageUrl: null, url: 'https://mrtecno.com.ar/productos/1015' },
          { code: 'C91015', name: 'Cable iPhone C', price: 3.5, category: 'Cargadores', imageUrl: null, url: 'https://mrtecno.com.ar/productos/c91015' },
          { code: 'YH88214N', name: 'Cargador USB', price: 2.25, category: 'Cargadores', imageUrl: null, url: 'https://mrtecno.com.ar/productos/yh88214n' },
        ],
      } });
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const rpc = path.split('/').pop();
      if (rpc === 'get_owner_profile') return route.fulfill({ json: [{ id: owner, role: 'admin', business_name: 'Negocio QA', display_name: 'Dueño QA', currency_symbol: '$', dark_mode: false, onboarding_completed_at: now, created_at: now }] });
      if (rpc === 'is_platform_admin') return route.fulfill({ json: false });
      if (rpc === 'my_business_plan') return route.fulfill({ json: { plan_code: 'base', plan_name: 'RivaStock', status: 'active', limits: { modules: { ai: false, knowledge: false, automation: false } } } });
      if (rpc === 'save_reseller_supplier_list') {
        supplierProductIds = (route.request().postDataJSON() as { p_product_ids: string[] }).p_product_ids;
        return route.fulfill({ json: supplierList });
      }
      if (rpc === 'save_reseller_supplier_list_pricing') {
        pricingCalls.push((route.request().postDataJSON() as { p_items: unknown[] }).p_items);
        return route.fulfill({ json: pricingCalls.at(-1)?.length ?? 0 });
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
        return route.fulfill({ json: products });
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
      if (table === 'price_lists') return route.fulfill({ json: [priceList] });
      if (table === 'reseller_supplier_lists') return route.fulfill({ json: [supplierList] });
      if (table === 'reseller_supplier_list_items') return route.fulfill({ json: supplierProductIds.map((product_id, sort_order) => ({ user_id: owner, supplier_list_id: supplierList.id, product_id, sort_order })) });
      if (table === 'suppliers') return route.fulfill({ json: [supplier] });
      if (table === 'inventory_operation_settings') return route.fulfill({ json: [{ holdings_enabled: false }] });
      if (table === 'inventory_owners') return route.fulfill({ json: [{ id: 'inventory-owner', user_id: owner, name: 'Principal', is_primary: true }] });
      if (table === 'inventory_owner_memberships') return route.fulfill({ json: [{ inventory_owner_id: 'inventory-owner', is_default: true, can_operate: true }] });
      if (table === 'collaborators') return route.fulfill({ json: [] });
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: [] });
  });

  await page.addInitScript(value => localStorage.setItem('rivastock-auth', JSON.stringify(value)), session());
  return { products, pricingCalls, sourceCosts, changeCatalog: () => { changedCatalog = true; } };
}

test('supplier catalog import reviews three fixture pages, bulk adds, then updates by SKU on reimport', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
  const { products, pricingCalls, sourceCosts, changeCatalog } = await mockApp(page);
  page.on('dialog', dialog => dialog.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Más acciones de stock' }).click();
  await page.getByRole('button', { name: /Lista revendedores/ }).click();

  const modal = page.getByRole('dialog', { name: 'Lista de precios para revendedores' });
  await expect(modal).toBeVisible();
  await modal.locator('summary').filter({ hasText: 'Listas por proveedor' }).click();
  await modal.getByRole('button', { name: /Editar productos|Crear lista/ }).click();
  await modal.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await expect(modal.getByText('3 productos · 3 listos · 0 para revisar')).toBeVisible();
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await modal.getByRole('button', { name: 'Agregar los 3 listos' }).click();
  await expect.poll(() => products.length).toBe(3);
  await expect.poll(() => pricingCalls.length).toBe(1);

  changeCatalog();
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await expect(modal.getByText('3 productos · 0 listos · 0 para revisar')).toHaveCount(0);
  await expect(modal.getByText(/0 nuevos · 1 actualizados · 2 sin cambios/)).toBeVisible();
  await modal.getByRole('button', { name: 'Agregar los 3 listos' }).click();
  await expect.poll(() => products.length).toBe(3);
  await expect.poll(() => pricingCalls.length).toBe(2);
  expect(pageErrors).toEqual([]);
  await expect(modal.getByText(/0 nuevos · 0 actualizados · 3 sin cambios/)).toBeVisible();
});

test('bulk import button confirms and creates only products matching the active search filter', async ({ page }) => {
  const { products } = await mockApp(page);
  page.on('dialog', dialog => dialog.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Más acciones de stock' }).click();
  await page.getByRole('button', { name: /Lista revendedores/ }).click();
  const modal = page.getByRole('dialog', { name: 'Lista de precios para revendedores' });
  await modal.locator('summary').filter({ hasText: 'Listas por proveedor' }).click();
  await modal.getByRole('button', { name: /Editar productos|Crear lista/ }).click();
  await modal.getByLabel('Enlace HTTPS del proveedor').fill('https://mrtecno.com.ar/productos/');
  await modal.getByRole('button', { name: 'Leer enlace' }).click();
  await modal.getByLabel('Cotización USD a pesos').fill('1600');
  await modal.getByLabel('Los precios incluyen IVA').selectOption('false');
  await modal.getByLabel('Buscar productos importados').fill('Lámpara solar');
  await expect(modal.getByRole('button', { name: 'Agregar los 1 listos de "Lámpara solar"' })).toBeVisible();
  await modal.getByRole('button', { name: 'Agregar los 1 listos de "Lámpara solar"' }).click();
  await expect.poll(() => products.length).toBe(1);
  expect(products[0].name).toBe('Lámpara solar');
});
