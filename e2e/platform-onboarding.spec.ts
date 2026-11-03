import { expect, test, type Page } from '@playwright/test';

const ownerId = '10000000-0000-4000-8000-000000000201';
const catalogId = '10000000-0000-4000-8000-000000000202';
const owner = {
  id: ownerId,
  email: 'platform-owner@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

function fixtureSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: ownerId, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token',
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user: owner,
  };
}

function profile(complete: boolean) {
  return {
    id: ownerId,
    email: owner.email,
    display_name: 'Fixture Owner',
    role: 'admin',
    business_name: complete ? 'Fixture Store' : '',
    business_name_lower: complete ? 'fixture store' : '',
    currency_symbol: '$',
    dark_mode: false,
    phone: null,
    email_contact: null,
    catalog_slug: complete ? 'fixture-store' : null,
    onboarding_completed_at: complete ? '2026-01-01T00:00:00Z' : null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

async function mountMock(page: Page, { isAdmin = true, onboardingComplete = true, adminCheckDelayMs = 0 }: { isAdmin?: boolean; onboardingComplete?: boolean; adminCheckDelayMs?: number } = {}) {
  const currentProfile = profile(onboardingComplete);
  const catalog = {
    id: catalogId,
    owner_uid: ownerId,
    business_name: 'Fixture Store',
    slug: 'fixture-store',
    enabled: true,
    show_prices: true,
    show_stock: true,
    show_stock_quantity: false,
    show_out_of_stock: false,
    allow_orders: true,
    welcome_message: '¡Bienvenido a nuestra tienda!',
    primary_color: '#6366f1',
    accent_color: '#6366f1',
    layout: 'Grid',
    font_style: 'Modern',
  };
  const platformDashboard = {
    budgets: { db_bytes: 471_859_200, storage_bytes: 900_000_000, warn_ratio: 0.8 },
    live: { db_bytes: 10_000_000, storage_bytes: 20_000_000 },
    last_snapshot_at: '2026-01-01T00:00:00Z',
    plans: [
      { code: 'base', name: 'Base', limits: { cloud_knowledge_bytes: 52_428_800, collaborators: 5, modules: { ai: false, knowledge: false, automation: false } }, is_active: true },
      { code: 'pro', name: 'Pro', limits: { cloud_knowledge_bytes: 157_286_400, collaborators: 15, modules: { ai: true, knowledge: true, automation: true } }, is_active: true },
      { code: 'interno', name: 'Interno', limits: { cloud_knowledge_bytes: 524_288_000, collaborators: 50, modules: { ai: true, knowledge: true, automation: true } }, is_active: true },
    ],
    businesses: [{
      owner_uid: ownerId,
      business_name: 'Fixture Store',
      email: owner.email,
      created_at: '2026-01-01T00:00:00Z',
      plan_code: 'base',
      status: 'active',
      db_bytes: 120_000,
      storage_bytes: { assets: 1_200_000, knowledge: 0 },
      storage_total_bytes: 1_200_000,
      local_knowledge_bytes: 0,
      store_bytes: 0,
      mirror_status: 'none',
      files_missing: 0,
      central_last_seen_at: null,
      plan_limits: { collaborators: 5, cloud_knowledge_bytes: 52_428_800, local_knowledge_bytes: 21_474_836_480, trace_retention_days: 7, modules: { ai: false, knowledge: false, automation: false } },
      limit_overrides: {},
      notes: '',
    }],
  };

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });

    const path = url.pathname;
    const method = route.request().method();
    let data: unknown = [];
    if (path === '/auth/v1/user') data = owner;
    else if (path.endsWith('/rpc/get_owner_profile')) data = [currentProfile];
    else if (path.endsWith('/rpc/is_platform_admin')) {
      if (adminCheckDelayMs) await new Promise((resolve) => setTimeout(resolve, adminCheckDelayMs));
      data = isAdmin;
    }
    else if (path.endsWith('/rpc/my_business_plan')) data = { plan_code: 'base', plan_name: 'Base', status: 'active', limits: { collaborators: 5, modules: { ai: false, knowledge: false, automation: false } } };
    else if (path.endsWith('/rpc/platform_usage_overview')) data = { budgets: platformDashboard.budgets, live: platformDashboard.live, businesses: [], last_snapshot_at: platformDashboard.last_snapshot_at };
    else if (path === '/functions/v1/platform-admin') data = platformDashboard;
    else if (path === '/rest/v1/ai_bridge_devices') data = [];
    else if (path === '/rest/v1/profiles') {
      if (method === 'GET') data = url.searchParams.has('business_name_lower') ? [] : [currentProfile];
      if (method === 'PATCH') {
        Object.assign(currentProfile, route.request().postDataJSON() ?? {});
        data = currentProfile;
      }
    } else if (path === '/rest/v1/catalog_config') {
      if (method === 'GET') data = currentProfile.business_name ? [catalog] : [];
      if (method === 'POST') data = route.request().postDataJSON() ?? catalog;
      if (method === 'PATCH') data = { ...catalog, ...(route.request().postDataJSON() ?? {}) };
    }

    if (route.request().headers().accept?.includes('application/vnd.pgrst.object+json')) {
      data = Array.isArray(data) ? data[0] ?? null : data;
    }
    const headers = { 'Content-Type': 'application/json' };
    await route.fulfill({ status: 200, headers, body: JSON.stringify(data) });
  });

  await page.addInitScript((session) => localStorage.setItem('rivastock-auth', JSON.stringify(session)), fixtureSession());
  return { currentProfile };
}

test('platform dashboard shows customer-facing plan names and project usage', async ({ page }) => {
  await mountMock(page);
  await page.goto('/plataforma');
  await expect(page.getByRole('heading', { name: 'Plataforma RivaStock' })).toBeVisible();
  await expect(page.getByText('RivaStock', { exact: true }).first()).toBeVisible();
  const businessCard = page.getByRole('article').filter({ hasText: 'Fixture Store' });
  await expect(businessCard.getByRole('combobox').first()).toHaveValue('base');
  await expect(businessCard.getByRole('combobox').first()).toContainText('RivaStock IA');
  await expect(page.getByText('Base de datos del proyecto')).toBeVisible();
  await expect(page.getByText('Almacenamiento en la nube')).toBeVisible();
});

test('platform route waits for the admin check before deciding access', async ({ page }) => {
  await mountMock(page, { adminCheckDelayMs: 400 });
  await page.goto('/plataforma');
  await expect(page.getByRole('heading', { name: 'Plataforma RivaStock' })).toBeVisible();
});

test('welcome flow completes owner details and leaves the central setup as a first-step action', async ({ page }) => {
  const fixture = await mountMock(page, { onboardingComplete: false });
  await page.goto('/bienvenida');
  const dialog = page.getByRole('dialog', { name: 'Completá los datos de tu negocio' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Nombre del negocio').fill('Tienda Nueva');
  await page.getByLabel('Teléfono de contacto').fill('+54 11 5555-1234');
  await page.getByLabel('Email de contacto').fill('contacto@example.test');
  await page.getByRole('button', { name: 'Guardar y continuar' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Bienvenido a RivaStock, Tienda Nueva' })).toBeVisible();
  await expect(page.getByText('La central con IA está disponible en el plan RivaStock IA.')).toBeVisible();
  expect(fixture.currentProfile).toMatchObject({ business_name: 'Tienda Nueva', onboarding_completed_at: expect.any(String) });
});
