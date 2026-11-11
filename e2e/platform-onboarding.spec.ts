import { expect, test, type Page } from '@playwright/test';

const ownerId = '10000000-0000-4000-8000-000000000201';
const catalogId = '10000000-0000-4000-8000-000000000202';
const owner = {
  id: ownerId,
  email: 'platform-owner@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: { password_set: true, display_name: 'Fixture Owner' },
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

async function mountMock(page: Page, {
  isAdmin = true,
  onboardingComplete = true,
  adminCheckDelayMs = 0,
  businessRecord = {},
}: {
  isAdmin?: boolean;
  onboardingComplete?: boolean;
  adminCheckDelayMs?: number;
  businessRecord?: Record<string, unknown>;
} = {}) {
  const platformRequests: Record<string, unknown>[] = [];
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
      { code: 'base', name: 'RivaStock', limits: { cloud_knowledge_bytes: 52_428_800, collaborators: 5, modules: { ai: false, knowledge: false, automation: false } }, is_active: true },
      { code: 'pro', name: 'RivaStock IA', limits: { cloud_knowledge_bytes: 157_286_400, collaborators: 15, modules: { ai: true, knowledge: true, automation: true } }, is_active: true },
      { code: 'interno', name: 'Interno', limits: { cloud_knowledge_bytes: 524_288_000, collaborators: 50, modules: { ai: true, knowledge: true, automation: true } }, is_active: true },
    ],
    businesses: [{
      owner_uid: '10000000-0000-4000-8000-000000000203',
      business_name: 'Fixture Store',
      email: owner.email,
      created_at: '2026-01-01T00:00:00Z',
      plan_code: 'base',
      status: 'active',
      can_manage_account: true,
      activation_invite_pending: true,
      business_whatsapp_number: '5492302381814',
      account_action_disabled_reason: null,
      has_business_subscription: true,
      business_action_disabled_reason: null,
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
      deletion_requested_at: null,
      deletion_scheduled_for: null,
      deletion_purge_started_at: null,
      deletion_failure: null,
      suspension_scheduled_for: null,
      suspension_notice_sent_at: null,
      suspension_notice_error: null,
      ...businessRecord,
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
    else if (path.endsWith('/rpc/suggest_catalog_slug')) data = 'tienda-nueva';
    else if (path.endsWith('/rpc/my_business_plan')) data = { plan_code: 'base', plan_name: 'Base', status: 'active', limits: { collaborators: 5, modules: { ai: false, knowledge: false, automation: false } } };
    else if (path.endsWith('/rpc/platform_usage_overview')) data = { budgets: platformDashboard.budgets, live: platformDashboard.live, businesses: [], last_snapshot_at: platformDashboard.last_snapshot_at };
    else if (path === '/functions/v1/platform-admin') {
      const body = method === 'POST' ? route.request().postDataJSON() as Record<string, unknown> | undefined : undefined;
      if (body) platformRequests.push(body);
      if (body?.action === 'invite_link') {
        const referer = route.request().headers()['referer'] ?? 'http://127.0.0.1:4173/';
        data = {
          url: `${new URL(referer).origin}/auth/confirm?token_hash=fixture-one-time-invite&type=invite`,
          expires_at: '2026-11-11T15:00:00.000Z',
        };
      } else data = body?.action === 'list' || !body ? platformDashboard : { ok: true };
    }
    else if (path === '/rest/v1/ai_bridge_devices') data = [];
    else if (path === '/rest/v1/profiles') {
      if (method === 'GET') data = url.searchParams.has('business_name_lower') ? [] : [currentProfile];
      if (method === 'PATCH') {
        Object.assign(currentProfile, route.request().postDataJSON() ?? {});
        data = currentProfile;
      }
    } else if (path === '/rest/v1/catalog_config' || path === '/rest/v1/catalog_configs') {
      if (method === 'GET') data = currentProfile.business_name ? [catalog] : [];
      if (method === 'POST') data = { ...catalog, ...(route.request().postDataJSON() ?? {}), id: catalogId };
      if (method === 'PATCH') data = { ...catalog, ...(route.request().postDataJSON() ?? {}) };
    }

    if (route.request().headers().accept?.includes('application/vnd.pgrst.object+json')) {
      data = Array.isArray(data) ? data[0] ?? null : data;
    }
    const headers = { 'Content-Type': 'application/json' };
    await route.fulfill({ status: 200, headers, body: JSON.stringify(data) });
  });

  await page.addInitScript((session) => localStorage.setItem('rivastock-auth', JSON.stringify(session)), fixtureSession());
  return { currentProfile, platformRequests };
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

test('activation link opens first password setup in a private context and rejects a second use', async ({ page, browser }) => {
  const inviteeId = '10000000-0000-4000-8000-000000000204';
  const inviteeEmail = 'activation-test@example.test';
  await mountMock(page, { businessRecord: { owner_uid: inviteeId, email: inviteeEmail, business_name: 'Activation Test Business' } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/plataforma');
  const businessCard = page.getByRole('article').filter({ hasText: 'Activation Test Business' });
  await businessCard.getByRole('button', { name: 'Copiar enlace de activación' }).click();
  await expect(page.getByRole('dialog')).toContainText('Este enlace permite entrar a la cuenta. Mandalo solo al cliente.');
  await page.getByRole('dialog').getByRole('button', { name: 'Generar enlace' }).click();
  const activationPanel = page.getByRole('region', { name: 'Enlace de activación' });
  await expect(activationPanel).toBeVisible();
  await expect(activationPanel.getByRole('link', { name: 'Enviar por WhatsApp' })).toHaveAttribute('href', /https:\/\/wa\.me\/5492302381814\?text=/);
  const activationUrl = await activationPanel.locator('p[title]').getAttribute('title');
  expect(activationUrl).toContain('/auth/confirm?token_hash=fixture-one-time-invite&type=invite');

  let verificationAttempts = 0;
  let invitee = {
    id: inviteeId,
    email: inviteeEmail,
    email_confirmed_at: null as string | null,
    aud: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { signup_kind: 'business_owner', password_set: false, must_change_password: true, display_name: '' },
    created_at: '2026-11-11T12:00:00Z',
  };
  const invitedBusiness = {
    id: inviteeId,
    email: inviteeEmail,
    display_name: '',
    role: 'owner',
    business_name: 'Activation Test Business',
    business_name_lower: 'activation test business',
    currency_symbol: '$',
    dark_mode: false,
    phone: null,
    email_contact: null,
    catalog_slug: 'activation-test-business',
    onboarding_completed_at: '2026-11-11T12:00:00Z',
    created_at: '2026-11-11T12:00:00Z',
  };
  const privateContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  await privateContext.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    let status = 200;
    let data: unknown = [];
    if (url.pathname === '/auth/v1/verify') {
      verificationAttempts += 1;
      if (verificationAttempts === 1) {
        invitee = { ...invitee, email_confirmed_at: '2026-11-11T12:05:00Z' };
        data = {
          access_token: 'fixture-invite-access-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'fixture-invite-refresh-token',
          user: invitee,
        };
      } else {
        status = 400;
        data = { code: 400, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' };
      }
    } else if (url.pathname === '/auth/v1/user') {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { data?: Record<string, unknown> };
        invitee = { ...invitee, user_metadata: { ...invitee.user_metadata, ...body.data } };
      }
      data = invitee;
    } else if (url.pathname.endsWith('/rpc/get_owner_profile')) data = [invitedBusiness];
    else if (url.pathname.endsWith('/rpc/my_business_plan')) data = { plan_code: 'base', plan_name: 'RivaStock', status: 'active', limits: { modules: { ai: false, knowledge: false, automation: false } } };
    else if (url.pathname.endsWith('/rpc/is_platform_admin')) data = false;
    await route.fulfill({ status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  });

  try {
    const privatePage = await privateContext.newPage();
    await privatePage.goto(activationUrl!);
    await expect(privatePage.getByRole('heading', { name: 'Creá tu contraseña' })).toBeVisible();
    await expect(privatePage.getByLabel('Email')).toHaveValue(inviteeEmail);
    await privatePage.getByLabel('¿Cómo te llamás?').fill('Cliente de prueba');
    await privatePage.getByLabel('Contraseña nueva').fill('Prueba-1234');
    await privatePage.getByLabel('Repetila').fill('Prueba-1234');
    await privatePage.getByRole('button', { name: 'Crear contraseña y entrar' }).click();
    await expect(privatePage.getByText('Tu nombre y contraseña quedaron guardados.')).toBeVisible();
    await privatePage.getByRole('button', { name: 'Entrar a RivaStock' }).click();
    await expect(privatePage.getByText('Activation Test Business')).toBeVisible();

    const secondUseContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
    await secondUseContext.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      if (url.hostname !== 'rivastock-test.invalid') return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
      await route.fulfill({
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 400, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' }),
      });
    });
    try {
      const replayPage = await secondUseContext.newPage();
      await replayPage.goto(activationUrl!);
      await expect(replayPage.getByRole('heading', { name: 'Link inválido' })).toBeVisible();
      await expect(replayPage.getByText(/expiró o ya fue usado/)).toBeVisible();
    } finally {
      await secondUseContext.close();
    }
  } finally {
    await privateContext.close();
  }
});

test('unnamed account deletion confirms with its email under an authenticated admin fixture', async ({ page }) => {
  const fixture = await mountMock(page, { businessRecord: {
    business_name: '',
    email: 'demoemma@example.test',
    has_business_subscription: false,
    business_action_disabled_reason: 'Esta cuenta no tiene un negocio asociado para programar una suspensión.',
  } });
  await page.goto('/plataforma');
  const businessCard = page.getByRole('article').filter({ hasText: 'Sin nombre · demoemma@example.test' });
  await expect(businessCard).toBeVisible();
  await expect(businessCard.getByRole('button', { name: 'Programar suspensión' })).toBeDisabled();
  await businessCard.getByRole('button', { name: 'Eliminar cuenta' }).click();
  await expect(page.getByText('Escribí exactamente demoemma@example.test')).toBeVisible();
  await page.getByLabel('Escribí exactamente').fill('demoemma@example.test');
  await page.getByRole('button', { name: 'Eliminar ahora' }).click();
  await expect.poll(() => fixture.platformRequests.some((request) =>
    request.action === 'delete_business_now' && request.confirm_business_name === 'demoemma@example.test',
  )).toBe(true);
});

test('named account deletion confirms with the business name under an authenticated admin fixture', async ({ page }) => {
  const fixture = await mountMock(page, { businessRecord: { business_name: 'Named Fixture Store' } });
  await page.goto('/plataforma');
  const businessCard = page.getByRole('article').filter({ hasText: 'Named Fixture Store' });
  await businessCard.getByRole('button', { name: 'Eliminar cuenta' }).click();
  await expect(page.getByText('Escribí exactamente Named Fixture Store')).toBeVisible();
  await page.getByLabel('Escribí exactamente').fill('Named Fixture Store');
  await page.getByRole('button', { name: 'Dar de baja en 30 días' }).click();
  await expect.poll(() => fixture.platformRequests.some((request) =>
    request.action === 'request_business_deletion' && request.confirm_business_name === 'Named Fixture Store',
  )).toBe(true);
});

test('real collaborator and administrator identities stay protected with visible reasons', async ({ page }) => {
  const collaborator = await mountMock(page, { businessRecord: {
    business_name: 'Collaborator Fixture',
    can_manage_account: false,
    account_action_disabled_reason: 'Esta persona pertenece al equipo de tu negocio.',
    business_action_disabled_reason: 'Esta persona pertenece al equipo de tu negocio.',
  } });
  await page.goto('/plataforma');
  let businessCard = page.getByRole('article').filter({ hasText: 'Collaborator Fixture' });
  await expect(businessCard.getByText('Esta persona pertenece al equipo de tu negocio.')).toBeVisible();
  await expect(businessCard.getByRole('button', { name: 'Eliminar cuenta' })).toBeDisabled();
  await expect(businessCard.getByRole('button', { name: 'Reenviar invitación' })).toBeDisabled();
  expect(collaborator.platformRequests.some((request) => request.action === 'delete_business_now')).toBe(false);

  const adminPage = await page.context().newPage();
  const administrator = await mountMock(adminPage, { businessRecord: {
    owner_uid: ownerId,
    business_name: 'Admin Fixture',
    can_manage_account: false,
    account_action_disabled_reason: 'No podés administrar tu propia cuenta.',
    business_action_disabled_reason: 'No podés administrar tu propia cuenta.',
  } });
  await adminPage.goto('/plataforma');
  businessCard = adminPage.getByRole('article').filter({ hasText: 'Admin Fixture' });
  await expect(businessCard.getByText('No podés administrar tu propia cuenta.')).toBeVisible();
  await expect(businessCard.getByRole('button', { name: 'Eliminar cuenta' })).toBeDisabled();
  expect(administrator.platformRequests.some((request) => request.action === 'delete_business_now')).toBe(false);
  await adminPage.close();
});

test('welcome flow completes owner details without showing central setup on the base plan', async ({ page }) => {
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
  await expect(page.getByText('5. Instalá la central del negocio')).toHaveCount(0);
  expect(fixture.currentProfile).toMatchObject({ business_name: 'Tienda Nueva', onboarding_completed_at: expect.any(String) });
});
