import { expect, test, type Page } from '@playwright/test';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_URL = 'https://rivastock-test.invalid';
const now = new Date().toISOString();
const photo = 'https://rivastock-test.invalid/storage/v1/object/public/assets/camera-a.webp';

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: OWNER_ID, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token', expires_at: expiresAt, expires_in: 3600,
    token_type: 'bearer',
    user: { id: OWNER_ID, email: 'quick-price@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: now },
  };
}

async function mockApp(page: Page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
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
      plan_code: 'pro', plan_name: 'RivaStock IA', status: 'active',
      limits: { modules: { ai: true, knowledge: true, automation: true } },
    } });
    if (url.pathname.endsWith('/rpc/get_public_catalog_products') || url.pathname.endsWith('/rpc/get_public_inventory_owner_labels')) return route.fulfill({ json: [] });
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.slice('/rest/v1/'.length);
      if (table === 'products') return route.fulfill({ json: [
        { id: 'camera', user_id: OWNER_ID, name: 'Cámara WiFi 360', category_id: 'camera-category', category: 'Cámaras', sale_price: 12500, purchase_price: 9000, stock: 1, min_stock: 1, barcode: '7790070123456', images: [photo], image_url: photo, show_in_catalog: true, owner_uid: OWNER_ID, created_at: now, updated_at: now },
        { id: 'cable', user_id: OWNER_ID, name: 'Cable iPhone C', category_id: 'charger-category', category: 'Cargadores', sale_price: 5000, purchase_price: 2500, stock: 0, min_stock: 1, barcode: '7790070654321', images: [], image_url: null, show_in_catalog: true, owner_uid: OWNER_ID, created_at: now, updated_at: now },
      ] });
      if (table === 'inventory_operation_settings') return route.fulfill({ json: { holdings_enabled: false } });
      if (table === 'inventory_owners' || table === 'collaborators' || table === 'categories') return route.fulfill({ json: [] });
      return route.fulfill({ json: [] });
    }
    if (url.pathname.startsWith('/storage/v1/object/public/assets/')) {
      return route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64') });
    }
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(value => localStorage.setItem('rivastock-auth', JSON.stringify(value)), session());
}

test('mobile quick price searches, opens the result, and returns to results', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Quick price mobile flow runs in Android and iPhone projects.');
  await mockApp(page);
  await page.goto('/consulta-rapida');

  await expect(page.getByTestId('mobile-quick-price')).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  await search.fill('wifi camara');
  const camera = page.getByRole('button', { name: /Cámara WiFi 360/ });
  await expect(camera).toBeVisible();
  await expect(camera.locator('img')).toHaveAttribute('loading', 'lazy');
  await expect(camera).toContainText('Queda 1');
  await camera.click();

  await expect(page.getByText('12.500', { exact: false })).toBeVisible();
  await expect(page.getByText('Queda 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a los resultados' }).click();
  await expect(search).toHaveValue('wifi camara');
  await expect(camera).toBeVisible();
});
