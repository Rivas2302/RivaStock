import { expect, test, type Page } from '@playwright/test';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_URL = 'https://rivastock-test.invalid';
const now = new Date().toISOString();

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: OWNER_ID, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer',
    user: { id: OWNER_ID, email: 'navigation@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: now },
  };
}

async function mockApp(page: Page) {
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
      display_name: 'Dueño', currency_symbol: '$', catalog_slug: 'negocio-prueba', dark_mode: false,
      onboarding_completed_at: now, created_at: now,
    }] });
    if (url.pathname.endsWith('/rpc/is_platform_admin')) return route.fulfill({ json: false });
    if (url.pathname.endsWith('/rpc/my_business_plan')) return route.fulfill({ json: {
      plan_code: 'pro', plan_name: 'RivaStock IA', status: 'active', limits: { modules: { ai: true, knowledge: true, automation: true } },
    } });
    if (url.pathname === '/rest/v1/inventory_operation_settings') return route.fulfill({ json: [{ holdings_enabled: false }] });
    if (url.pathname.startsWith('/rest/v1/')) return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(value => localStorage.setItem('rivastock-auth', JSON.stringify(value)), session());
  return mutations;
}

test('mobile quick actions and More sheet navigate without creating data', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Navigation interactions run in Android and iPhone projects.');
  const mutations = await mockApp(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');

  const bar = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Acciones rápidas' })).toBeVisible();
  await bar.getByRole('button', { name: 'Acciones rápidas' }).click();
  await page.getByRole('dialog', { name: '¿Qué querés hacer?' }).getByRole('link', { name: 'Consultar precio' }).click();
  await expect(page).toHaveURL(/\/consulta-rapida$/);
  const quickDestinations = [
    ['Nueva venta', /\/ventas(?:\?.*)?$/, 'dialog:Nueva Venta'],
    ['Modo POS', /\/pos$/, 'heading:Modo POS'],
    ['Consultar precio', /\/consulta-rapida$/, 'testid:mobile-quick-price'],
    ['Enviar fotos', /\/fotos$/, 'heading:Buscar y enviar'],
    ['Presupuesto', /\/presupuestos(?:\?.*)?$/, 'dialog:Nuevo Presupuesto'],
    ['Ingreso de mercadería', /\/ingresos(?:\?.*)?$/, 'dialog:Registrar Ingreso de Mercadería'],
    ['Registrar gasto', /\/caja(?:\?.*)?$/, 'expense:Nuevo movimiento'],
    ['Cobro de cliente', /\/clientes\?action=collect$/, 'route:'],
  ] as const;
  for (const [label, destination, screen] of quickDestinations) {
    await bar.getByRole('button', { name: 'Acciones rápidas' }).click();
    const actionSheet = page.getByRole('dialog', { name: '¿Qué querés hacer?' });
    await expect(actionSheet.getByRole('link', { name: 'Nueva venta' })).toBeVisible();
    await expect(actionSheet.getByRole('link', { name: 'Registrar gasto' })).toBeVisible();
    await actionSheet.getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(destination);
    const [kind, screenName] = screen.split(':');
    if (kind === 'dialog') await expect(page.getByRole('dialog', { name: screenName })).toBeVisible();
    if (kind === 'expense') {
      const movementSheet = page.getByRole('dialog', { name: screenName });
      await expect(movementSheet).toBeVisible();
      await expect(movementSheet.getByRole('button', { name: 'Gasto', exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    if (kind === 'text') await expect(page.getByText(screenName, { exact: false }).first()).toBeVisible();
    if (kind === 'heading') await expect(page.getByRole('heading', { name: screenName }).last()).toBeVisible();
    if (kind === 'testid') await expect(page.getByTestId(screenName)).toBeVisible();
    await page.goBack();
    if (label === 'Registrar gasto') {
      await expect(page.getByRole('dialog', { name: 'Nuevo movimiento' })).toBeHidden();
      await page.goBack();
    }
    await expect(page).toHaveURL(/\/(?:consulta-rapida)?$/);
    await page.goto('/consulta-rapida');
  }

  await bar.getByRole('button', { name: 'Todas las secciones' }).click();
  const more = page.getByRole('dialog', { name: 'Todas las secciones' });
  await expect(more.getByRole('region', { name: 'Vender' })).toBeVisible();
  await expect(more.getByRole('region', { name: 'Clientes y proveedores' })).toBeVisible();
  await expect(more.getByRole('link', { name: 'Consulta rápida' })).toHaveAttribute('aria-current', 'page');
  await more.getByRole('link', { name: 'Stock' }).click();
  await expect(page).toHaveURL(/\/stock$/);
  await bar.getByRole('button', { name: 'Todas las secciones' }).click();
  await expect(page.getByRole('dialog', { name: 'Todas las secciones' }).getByRole('link', { name: 'Stock' })).toHaveAttribute('aria-current', 'page');
  expect(mutations).toEqual([]);
});

test('desktop navigation groups and search work at 1280px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop navigation is checked in Chromium.');
  await mockApp(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const sidebar = page.locator('.app-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText('Vender', { exact: true })).toBeVisible();
  await expect(sidebar.getByText('Clientes y proveedores', { exact: true })).toBeVisible();
  await expect(sidebar.getByLabel('Ir a')).toBeVisible();
  await sidebar.getByLabel('Ir a').fill('Compras');
  await expect(sidebar.getByRole('link', { name: 'Compras a proveedores' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Ventas', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/mobile-navigation-desktop-1280.png', fullPage: true });
});
