import { expect, test, type Page, type Route } from '@playwright/test';

const userId = '00000000-0000-4000-8000-000000000001';
const ownerId = '00000000-0000-4000-8000-000000000002';
const user = { id: userId, email: 'owner@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const session = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp, role: 'authenticated' })}.fixture`, refresh_token: 'fixture-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer', user };
};

async function mountFixture(page: Page, intercept?: (route: Route, url: URL) => Promise<boolean>, waitForShell = true) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.abort();
    if (intercept && await intercept(route, url)) return;
    const name = url.pathname.split('/').pop();
    let data: unknown = [];
    if (name === 'user') data = user;
    if (name === 'logout') data = {};
    if (name === 'token') data = session();
    if (name === 'get_owner_profile') data = [{ id: userId, email: user.email, display_name: 'Owner', business_name: 'Session Test Shop', currency_symbol: '$', role: 'admin', dark_mode: false }];
    if (name === 'inventory_owners') data = [{ id: ownerId, user_id: userId, name: 'Main', is_primary: true, sort_order: 0 }];
    if (name === 'inventory_owner_memberships') data = [{ inventory_owner_id: ownerId, is_default: true, can_operate: true }];
    if (name === 'inventory_operation_settings') data = [{ holdings_enabled: false }];
    if (route.request().headers().accept?.includes('application/vnd.pgrst.object+json') && Array.isArray(data)) data = data[0] ?? null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.addInitScript(value => localStorage.setItem('rivastock-auth', JSON.stringify(value)), session());
  await page.goto('/');
  if (waitForShell) await expect(page.locator('main')).toBeVisible();
  return errors;
}

test('a real SDK auth event releases its lock before profile queries run', async ({ page }) => {
  const errors = await mountFixture(page);
  const result = await page.evaluate(async value => {
    const client = (window as unknown as { __rivastock_supabase__: { auth: { setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<{ error: { message: string } | null }> } } }).__rivastock_supabase__;
    return Promise.race([
      client.auth.setSession(value).then(result => result.error ? result.error.message : 'settled'),
      new Promise<string>(resolve => setTimeout(() => resolve('auth event is blocked'), 2000)),
    ]);
  }, session());
  expect(result).toBe('settled');
  await expect(page.getByRole('heading', { name: 'Panel de Control', exact: true })).toBeVisible();
  await expect(page.getByText('No se pudo cargar el panel')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('profile and collaborator verification start in parallel', async ({ page }) => {
  let release!: () => void;
  const profileStarted = new Promise<void>(resolve => { release = resolve; });
  const errors = await mountFixture(page, async (_route, url) => {
    if (url.pathname.endsWith('/rpc/get_owner_profile')) release();
    if (url.pathname.endsWith('/collaborators')) await profileStarted;
    return false;
  });
  await expect(page.getByRole('heading', { name: 'Panel de Control', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('dashboard recovers a transient stolen-lock read without reloading the page', async ({ page }) => {
  let attempts = 0;
  const errors = await mountFixture(page, async (route, url) => {
    if (url.pathname.endsWith('/inventory_owners') && url.searchParams.get('select') === '*') {
      attempts++;
      if (attempts === 1) {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: "AbortError: Lock broken by another request with the 'steal' option.", code: 'LOCK_INTERRUPTED' }) });
        return true;
      }
    }
    return false;
  });
  await expect(page.getByRole('heading', { name: 'Panel de Control', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  await expect(page.getByText('No se pudo cargar el panel')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('failed profile verification blocks access and reconnects in place without signing in again', async ({ page }) => {
  let blocked = true;
  let attempts = 0;
  const errors = await mountFixture(page, async (route, url) => {
    if (url.pathname.endsWith('/rpc/get_owner_profile')) {
      attempts++;
      if (blocked) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'permission denied', code: '42501' }) });
        return true;
      }
    }
    return false;
  }, false);
  await expect(page.getByRole('heading', { name: 'No pudimos conectar con tu cuenta' })).toBeVisible();
  await expect(page.locator('main')).not.toBeVisible();
  expect(attempts).toBe(1);
  blocked = false;
  await page.getByRole('button', { name: 'Reintentar conexión' }).click();
  await expect(page.getByRole('heading', { name: 'Panel de Control', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login$/);
  expect(attempts).toBe(2);
  expect(errors).toEqual([]);
});

test('sign-out cancels a pending profile load and cannot resurrect the session', async ({ page }) => {
  let blockProfile = false;
  let pending = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const errors = await mountFixture(page, async (route, url) => {
    if (blockProfile && url.pathname.endsWith('/rpc/get_owner_profile')) {
      pending = true;
      await gate;
      // The app correctly aborts this request on logout. Some browser versions
      // reject fulfill for an already cancelled request; that's expected here.
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: userId, business_name: 'Stale account', currency_symbol: '$' }]) }).catch(() => {});
      return true;
    }
    return false;
  });
  await expect(page.getByRole('heading', { name: 'Panel de Control', exact: true })).toBeVisible();
  blockProfile = true;
  await page.evaluate(async value => {
    const client = (window as unknown as { __rivastock_supabase__: { auth: { setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<unknown> } } }).__rivastock_supabase__;
    await client.auth.setSession(value);
  }, session());
  await expect.poll(() => pending).toBe(true);
  await page.getByRole('button', { name: 'Cerrar Sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  release();
  await page.evaluate(async () => {
    const client = (window as unknown as { __rivastock_supabase__: { auth: { getSession: () => Promise<{ data: { session: unknown } }> } } }).__rivastock_supabase__;
    if ((await client.auth.getSession()).data.session) throw new Error('Signed-out session was restored');
  });
  await expect(page.locator('form')).toBeVisible();
  await expect(page.getByText('Stale account')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('membership permission errors do not fall back to unrestricted legacy stock', async ({ page }) => {
  const errors = await mountFixture(page, async (route, url) => {
    if (url.pathname.endsWith('/inventory_owner_memberships')) {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'membership permission denied', code: '42501' }) });
      return true;
    }
    return false;
  }, false);
  await expect(page.getByRole('heading', { name: 'No pudimos conectar con tu cuenta' })).toBeVisible();
  await expect(page.locator('main')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('missing membership schema cannot disable an already enabled holdings scope', async ({ page }) => {
  const errors = await mountFixture(page, async (route, url) => {
    if (url.pathname.endsWith('/inventory_owner_memberships')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'missing membership table', code: 'PGRST205' }) });
      return true;
    }
    if (url.pathname.endsWith('/inventory_operation_settings')) {
      const data = route.request().headers().accept?.includes('application/vnd.pgrst.object+json') ? { holdings_enabled: true } : [{ holdings_enabled: true }];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      return true;
    }
    return false;
  }, false);
  await expect(page.getByRole('heading', { name: 'No pudimos conectar con tu cuenta' })).toBeVisible();
  await expect(page.locator('main')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('a burst of SDK session events coalesces into one pending profile query', async ({ page }) => {
  let block = false;
  let attempts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const errors = await mountFixture(page, async (route, url) => {
    if (block && url.pathname.endsWith('/rpc/get_owner_profile')) {
      attempts++;
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: userId, business_name: 'Coalesced account', currency_symbol: '$' }]) });
      return true;
    }
    return false;
  });
  await expect(page.getByRole('heading', { name: 'Panel de Control', exact: true })).toBeVisible();
  block = true;
  await page.evaluate(async value => {
    const client = (window as unknown as { __rivastock_supabase__: { auth: { setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<unknown> } } }).__rivastock_supabase__;
    await Promise.all([client.auth.setSession(value), client.auth.setSession(value), client.auth.setSession(value)]);
  }, session());
  await expect.poll(() => attempts).toBe(1);
  release();
  await expect(page.getByText('Coalesced account', { exact: true })).toBeVisible();
  expect(attempts).toBe(1);
  expect(errors).toEqual([]);
});
