import { expect, test, type Page } from '@playwright/test';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_URL = 'https://rivastock-test.invalid';
const now = new Date().toISOString();
const MODULE_KEYS = [
  'sales', 'quotes', 'orders', 'quickPrice', 'stock', 'intake', 'sendPhotos',
  'customers', 'suppliers', 'resellers', 'supplierOrders', 'cash', 'reports',
  'calculator', 'ai', 'knowledge', 'automation', 'traceability',
];
const DEFAULT_PLAN_MODULES = Object.fromEntries(MODULE_KEYS.map(key => [key, key !== 'resellers']));

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: OWNER_ID, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer',
    user: { id: OWNER_ID, email: 'navigation@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: now },
  };
}

async function mockApp(
  page: Page,
  darkMode = false,
  modules: Record<string, boolean> = DEFAULT_PLAN_MODULES,
) {
  const mutations: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method()) && !url.pathname.includes('/rpc/')) mutations.push(`${request.method()} ${url.pathname}`);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: session().user });
    if (url.pathname.endsWith('/rpc/get_owner_profile')) return route.fulfill({ json: [{
      id: OWNER_ID, role: 'admin', business_name: 'Negocio de prueba', business_name_lower: 'negocio de prueba',
      display_name: 'Dueño', currency_symbol: '$', catalog_slug: 'negocio-prueba', dark_mode: darkMode,
      onboarding_completed_at: now, created_at: now,
    }] });
    if (url.pathname.endsWith('/rpc/is_platform_admin')) return route.fulfill({ json: false });
    if (url.pathname.endsWith('/rpc/my_business_plan')) return route.fulfill({ json: {
      plan_code: 'pro', plan_name: 'RivaStock IA', status: 'active', limits: { modules },
    } });
    if (url.pathname === '/rest/v1/inventory_operation_settings') return route.fulfill({ json: [{ holdings_enabled: false }] });
    if (url.pathname.startsWith('/rest/v1/')) return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(value => localStorage.setItem('rivastock-auth', JSON.stringify(value)), session());
  return mutations;
}

test('mobile quick actions and sections share one menu without creating data', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Navigation interactions run in Android and iPhone projects.');
  const mutations = await mockApp(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');

  const bar = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Abrir menú' })).toBeVisible();
  await bar.getByRole('button', { name: 'Abrir menú' }).click();
  const menu = page.getByRole('dialog', { name: '¿Qué querés hacer?' });
  await expect(menu.getByRole('searchbox', { name: 'Buscar acciones y secciones' })).not.toBeFocused();
  const create = menu.getByRole('region', { name: 'Crear' });
  const goTo = menu.getByRole('navigation', { name: 'Ir a' });
  await expect(create.getByRole('link')).toHaveCount(6);
  await expect(goTo.getByRole('link', { name: 'Consulta rápida' })).toHaveCount(1);
  await expect(goTo.getByRole('link', { name: 'Buscar y enviar' })).toHaveCount(1);
  await expect(goTo.getByRole('link', { name: 'Configuración' })).toHaveCount(1);
  await expect(goTo.getByRole('link', { name: 'Revendedores' })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(menu.getByText('Más', { exact: true })).toHaveCount(0);

  for (const [label, destination] of [
    ['Nueva venta', /\/ventas\?action=new$/],
    ['Modo POS', /\/pos$/],
    ['Registrar gasto', /\/caja\?action=expense$/],
    ['Cobro de cliente', /\/clientes\?action=collect$/],
    ['Presupuesto', /\/presupuestos\?action=new$/],
    ['Ingreso de mercadería', /\/ingresos\?action=new$/],
  ] as const) {
    await create.getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(destination);
    await page.goto('/');
    await bar.getByRole('button', { name: 'Abrir menú' }).click();
  }

  const search = menu.getByRole('searchbox', { name: 'Buscar acciones y secciones' });
  await search.fill('consulta');
  await expect(create.getByRole('link')).toHaveCount(0);
  await expect(goTo.getByRole('link', { name: 'Consulta rápida' })).toHaveCount(1);
  await goTo.getByRole('link', { name: 'Consulta rápida' }).click();
  await expect(page).toHaveURL(/\/consulta-rapida$/);
  expect(mutations).toEqual([]);
});

for (const darkMode of [false, true]) {
  const theme = darkMode ? 'dark' : 'light';

  test(`opening a new product from the mobile plus menu stays responsive in ${theme} mode`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium', 'Product form navigation runs in Android and iPhone projects.');
    await mockApp(page, darkMode);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    await page.getByRole('navigation', { name: 'Ir a' }).getByRole('link', { name: 'Stock' }).click();
    await page.getByRole('button', { name: 'Agregar producto' }).last().click();
    const form = page.getByTestId('mobile-product-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Nombre').fill('Borrador de prueba');
    await page.goBack();
    await expect(page.getByText('¿Descartar los cambios?')).toBeVisible();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText('Algo salió mal')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`opening a new product from the mobile Stock tab stays responsive in ${theme} mode`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium', 'Product form navigation runs in Android and iPhone projects.');
    await mockApp(page, darkMode);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Stock' }).click();
    await page.getByRole('button', { name: 'Agregar producto' }).last().click();
    const form = page.getByTestId('mobile-product-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Nombre').fill('Borrador de prueba');
    await page.goBack();
    await expect(page.getByText('¿Descartar los cambios?')).toBeVisible();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText('Algo salió mal')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('desktop navigation groups and search work at 1280px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop navigation is checked in Chromium.');
  await mockApp(page, false, { ...DEFAULT_PLAN_MODULES, resellers: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const sidebar = page.locator('.app-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText('Vender', { exact: true })).toBeVisible();
  await expect(sidebar.getByText('Clientes y proveedores', { exact: true })).toBeVisible();
  await expect(sidebar.getByText('Relaciones', { exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Revendedores' })).toHaveAttribute('href', '/revendedores');
  await expect(sidebar.getByLabel('Ir a')).toBeVisible();
  await sidebar.getByLabel('Ir a').fill('Compras');
  await expect(sidebar.getByRole('link', { name: 'Compras a proveedores' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Ventas', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/mobile-navigation-desktop-1280.png', fullPage: true });
});

test('business with only Sales and Stock cannot see or open other modules', async ({ page }, testInfo) => {
  const modules = Object.fromEntries(MODULE_KEYS.map(key => [key, key === 'sales' || key === 'stock']));
  await mockApp(page, false, modules);
  const mobile = testInfo.project.name !== 'chromium';
  await page.setViewportSize(mobile ? { width: 360, height: 740 } : { width: 1280, height: 900 });
  await page.goto('/');

  if (mobile) {
    const bar = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(bar.getByRole('link', { name: 'Stock' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Ventas' })).toBeVisible();
    await bar.getByRole('button', { name: 'Abrir menú' }).click();
    const menu = page.getByRole('dialog', { name: '¿Qué querés hacer?' });
    const create = menu.getByRole('region', { name: 'Crear' });
    await expect(create.getByRole('link')).toHaveCount(2);
    await expect(create.getByRole('link', { name: 'Nueva venta' })).toBeVisible();
    await expect(create.getByRole('link', { name: 'Modo POS' })).toBeVisible();
    const goTo = menu.getByRole('navigation', { name: 'Ir a' });
    await expect(goTo.getByRole('link', { name: 'Stock' })).toHaveCount(1);
    await expect(goTo.getByRole('link', { name: 'Ventas' })).toHaveCount(1);
    for (const label of ['Consulta rápida', 'Buscar y enviar', 'Presupuestos', 'Pedidos', 'Ingresos de mercadería', 'Clientes', 'Proveedores', 'Revendedores', 'Compras a proveedores', 'Flujo de Caja', 'Reportes', 'Calculadora', 'Asistente IA', 'Conocimientos', 'Automatizaciones', 'Trazabilidad']) {
      await expect(goTo.getByRole('link', { name: label })).toHaveCount(0);
    }
  } else {
    const sidebar = page.locator('.app-sidebar');
    await expect(sidebar.getByRole('link', { name: 'Stock' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Ventas', exact: true })).toBeVisible();
    for (const label of ['Consulta rápida', 'Buscar y enviar', 'Presupuestos', 'Pedidos', 'Ingresos de mercadería', 'Clientes', 'Proveedores', 'Revendedores', 'Compras a proveedores', 'Flujo de Caja', 'Reportes', 'Calculadora', 'Asistente IA', 'Conocimientos', 'Automatizaciones', 'Trazabilidad']) {
      await expect(sidebar.getByRole('link', { name: label })).toHaveCount(0);
    }
  }

  for (const path of ['/consulta-rapida', '/fotos', '/presupuestos', '/pedidos', '/ingresos', '/clientes', '/proveedores', '/revendedores', '/compras', '/caja', '/reportes', '/calculadora', '/ia', '/ia/conocimientos', '/automatizaciones', '/trazabilidad']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Este módulo no está incluido en tu plan' })).toBeVisible();
  }
});
