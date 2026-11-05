import type { Page, Route } from '@playwright/test';


const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_URL = 'https://rivastock-test.invalid';
const now = new Date().toISOString();
const imagePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVb8AAAAASUVORK5CYII=', 'base64');

function fixtureSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: OWNER_ID, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token',
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: OWNER_ID, email: 'mobile-sales@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: now },
  };
}

function productsFixture() {
  return [
    {
      id: 'camera', user_id: OWNER_ID, name: '[QA] Cámara WiFi', category_id: 'category-camera', category: 'Cámaras',
      purchase_price: 100, sale_price: 2500, stock: 3, min_stock: 1, show_in_catalog: true, barcode: null,
      image_url: null, images: [
        `${PROJECT_URL}/storage/v1/object/public/assets/camera-a.webp`,
        `${PROJECT_URL}/storage/v1/object/public/assets/camera-b.webp`,
      ], created_at: now, updated_at: now,
    },
    {
      id: 'cable', user_id: OWNER_ID, name: '[QA] Cable iPhone C', category_id: 'category-chargers', category: 'Cargadores',
      purchase_price: 100, sale_price: 1000, stock: 2, min_stock: 1, show_in_catalog: true, barcode: null,
      image_url: null, images: [], created_at: now, updated_at: now,
    },
    {
      id: 'broken', user_id: OWNER_ID, name: '[QA] Producto con foto rota', category_id: 'category-general', category: 'General',
      purchase_price: 100, sale_price: 500, stock: 1, min_stock: 1, show_in_catalog: true, barcode: null,
      image_url: null, images: [`${PROJECT_URL}/storage/v1/object/public/assets/broken.webp`], created_at: now, updated_at: now,
    },
  ];
}

export async function mockSales(page: Page) {
  const products = productsFixture();
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });

    const path = url.pathname;
    if (path === '/auth/v1/user') return route.fulfill({ json: fixtureSession().user });
    if (path.endsWith('/rpc/get_owner_profile')) return route.fulfill({ json: [{
      id: OWNER_ID,
      role: 'admin',
      business_name: 'Negocio QA',
      business_name_lower: 'negocio qa',
      display_name: 'Dueño QA',
      currency_symbol: '$',
      catalog_slug: 'qa-catalog',
      dark_mode: false,
      onboarding_completed_at: now,
      created_at: now,
    }] });
    if (path.endsWith('/rpc/is_platform_admin')) return route.fulfill({ json: false });
    if (path.endsWith('/rpc/my_business_plan')) return route.fulfill({ json: {
      plan_code: 'base', plan_name: 'RivaStock', status: 'active',
      limits: { modules: { ai: false, knowledge: false, automation: false } },
    } });
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '');
      if (table === 'products') return route.fulfill({ json: products });
      if (table === 'profiles') return route.fulfill({ json: [{ id: OWNER_ID, business_name: 'Negocio QA', onboarding_completed_at: now }] });
      if (table === 'inventory_operation_settings') return route.fulfill({ json: { holdings_enabled: false } });
      if (table === 'collaborators') return route.fulfill({ json: [] });
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('.thumb.webp') || path.endsWith('/broken.webp')) {
      return route.fulfill({ status: 404, body: 'not found' });
    }
    if (path.endsWith('/camera-a.webp') || path.endsWith('/camera-b.webp')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: imagePng });
    }
    if (path.startsWith('/storage/v1/')) return route.fulfill({ status: 404, body: 'not found' });
    if (path.endsWith('/rpc/')) return route.fulfill({ json: null });
    return route.fulfill({ json: [] });
  });
  await page.addInitScript((session) => localStorage.setItem('rivastock-auth', JSON.stringify(session)), fixtureSession());
}
