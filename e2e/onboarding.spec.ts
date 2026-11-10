import { expect, test, type Page, type Route } from '@playwright/test';

const ownerId = '00000000-0000-4000-8000-000000000041';
const inventoryOwnerId = '00000000-0000-4000-8000-000000000042';
const ownerUser = {
  id: ownerId,
  email: 'owner@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: { display_name: 'Fixture Owner', full_name: 'Fixture Owner', password_set: true },
  created_at: '2026-01-01T00:00:00Z',
};
const catalogConfig = {
  id: '00000000-0000-4000-8000-000000000043',
  user_id: ownerId,
  business_name: 'Empty Fixture Store',
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

function session(user = ownerUser) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: ownerId, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token',
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  };
}

function profile(businessName = 'Fixture Store') {
  return {
    id: ownerId,
    email: ownerUser.email,
    display_name: 'Fixture Owner',
    role: 'admin',
    business_name: businessName,
    business_name_lower: businessName.toLowerCase(),
    currency_symbol: '$',
    dark_mode: false,
    phone: null,
    email_contact: null,
    onboarding_completed_at: '2026-01-01T00:00:00Z',
    catalog_slug: businessName ? 'fixture-store' : null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

interface FixtureOptions {
  businessName?: string;
  authenticated?: boolean;
  platformAdmin?: boolean;
  userMetadata?: Record<string, unknown>;
  initialPassword?: string;
  orders?: Record<string, unknown>[];
  intercept?: (route: Route, url: URL) => Promise<boolean>;
}

async function mountFixture(page: Page, options: FixtureOptions = {}) {
  const fixtureUser = {
    ...ownerUser,
    user_metadata: { ...ownerUser.user_metadata, ...(options.userMetadata ?? {}) },
  };
  let fixturePassword = options.initialPassword ?? '';
  const currentProfile = profile(options.businessName ?? 'Fixture Store');
  currentProfile.display_name = typeof fixtureUser.user_metadata.display_name === 'string'
    ? fixtureUser.user_metadata.display_name : '';
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requests: { method: string; pathname: string; body: unknown }[] = [];
  const fixtureOrders = [...(options.orders ?? [])];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') {
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    }
    if (options.intercept && await options.intercept(route, url)) return;

    const method = route.request().method();
    const path = url.pathname;
    const requestBody = route.request().postDataJSON?.() ?? null;
    requests.push({ method, pathname: path, body: requestBody });

    let data: unknown = [];
    if (path === '/auth/v1/verify' && method === 'POST') {
      data = session(fixtureUser);
    } else if (path === '/auth/v1/user') {
      if (method === 'PATCH' || method === 'PUT') {
        const metadata = (requestBody as { data?: Record<string, unknown> } | null)?.data;
        if (metadata) fixtureUser.user_metadata = { ...fixtureUser.user_metadata, ...metadata };
        const password = (requestBody as { password?: string } | null)?.password;
        if (password) fixturePassword = password;
      }
      data = fixtureUser;
    } else if (path === '/auth/v1/token' && method === 'POST') {
      const credentials = requestBody as { email?: string; password?: string } | null;
      if (credentials?.email === fixtureUser.email && credentials.password === fixturePassword && fixturePassword) {
        data = session(fixtureUser);
      } else {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Invalid login credentials' }) });
        return;
      }
    } else if (path === '/auth/v1/logout') {
      data = {};
    } else if (path.endsWith('/rpc/get_owner_profile')) {
      data = [currentProfile];
    } else if (path.endsWith('/rpc/is_platform_admin')) {
      data = options.platformAdmin ?? false;
    } else if (path.endsWith('/rpc/my_business_plan')) {
      data = {
        plan_code: 'base',
        plan_name: 'Base',
        status: 'active',
        limits: { modules: { ai: false, knowledge: false, automation: false } },
      };
    } else if (path.endsWith('/rpc/platform_usage_overview')) {
      data = {};
    } else if (path === '/functions/v1/platform-admin' && method === 'POST') {
      data = {
        budgets: { db_bytes: 500_000_000, storage_bytes: 10_000_000_000, warn_ratio: 0.8 },
        live: { db_bytes: 0, storage_bytes: 0 },
        last_snapshot_at: null,
        plans: [],
        businesses: [],
      };
    } else if (path.endsWith('/rpc/get_sales_report')) {
      data = { sales: [], totals: {}, by_month: [], by_category: [] };
    } else if (path === '/rest/v1/rpc/get_reseller_catalog_status') {
      data = { enabled: false };
    } else if (path === '/rest/v1/rpc/get_public_catalog_products'
      || path === '/rest/v1/rpc/get_public_inventory_owner_labels') {
      data = [];
    } else if (path.endsWith('/rpc/')) {
      data = null;
    } else if (path === '/rest/v1/profiles') {
      if (method === 'GET') {
        const lookup = url.searchParams.get('business_name_lower');
        data = lookup ? [] : [currentProfile];
      } else if (method === 'PATCH') {
        Object.assign(currentProfile, requestBody ?? {});
        data = currentProfile;
      }
    } else if (path === '/rest/v1/catalog_config') {
      if (method === 'GET') {
        data = currentProfile.business_name ? [catalogConfig] : [];
      } else if (method === 'POST') {
        data = requestBody;
      } else if (method === 'PATCH') {
        data = requestBody;
      }
    } else if (path === '/rest/v1/orders') {
      if (method === 'GET') {
        data = fixtureOrders;
      } else if (method === 'DELETE') {
        const idFilter = url.searchParams.get('id') ?? '';
        if (idFilter.startsWith('eq.')) {
          const id = idFilter.slice(3);
          const index = fixtureOrders.findIndex(order => order.id === id);
          if (index >= 0) fixtureOrders.splice(index, 1);
        }
        data = [];
      }
    } else if (path === '/rest/v1/inventory_owners') {
      data = [{ id: inventoryOwnerId, user_id: ownerId, name: 'Principal', is_primary: true, sort_order: 0 }];
    } else if (path === '/rest/v1/inventory_owner_memberships') {
      data = [{ inventory_owner_id: inventoryOwnerId, is_default: true, can_operate: true }];
    } else if (path === '/rest/v1/inventory_operation_settings') {
      data = [{ holdings_enabled: false }];
    }

    if (route.request().headers().accept?.includes('application/vnd.pgrst.object+json')) {
      data = Array.isArray(data) ? data[0] ?? null : data;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });

  if (options.authenticated !== false) {
    await page.addInitScript((value) => localStorage.setItem('rivastock-auth', JSON.stringify(value)), session(fixtureUser));
  }

  return { consoleErrors, pageErrors, requests, profile: currentProfile, orders: fixtureOrders, user: fixtureUser };
}

test('invitation requires a name and password, then supports logout and password login', async ({ page }) => {
  const verifyCalls: unknown[] = [];
  const fixture = await mountFixture(page, {
    authenticated: false,
    businessName: 'Electro Pasión Fixture',
    userMetadata: {
      business_name: 'Electro Pasión Fixture',
      display_name: '',
      password_set: false,
      must_change_password: true,
      signup_kind: 'business_owner',
    },
    intercept: async (route, url) => {
      if (url.pathname === '/auth/v1/verify') {
        verifyCalls.push(route.request().postDataJSON());
        return false;
      }
      return false;
    },
  });

  await page.goto('/auth/confirm?token_hash=invite-token-hash&type=invite');
  await expect(page).toHaveURL(/\/reset-password\?type=invite$/);
  await expect(page.getByRole('heading', { name: 'Creá tu contraseña' })).toBeVisible();
  await expect(page.getByLabel('¿Cómo te llamás?')).toBeVisible();

  const password = page.getByLabel('Contraseña nueva');
  const confirmation = page.getByLabel('Repetila');
  await page.getByLabel('¿Cómo te llamás?').fill('María López');
  await password.fill('Correct-Horse-123');
  await confirmation.fill('Different-Horse-456');
  await page.getByRole('button', { name: 'Crear contraseña y entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('Las contraseñas no coinciden');

  await confirmation.fill('Correct-Horse-123');
  await page.getByRole('button', { name: 'Crear contraseña y entrar' }).click();
  await expect(page.getByText('Tu nombre y contraseña quedaron guardados.')).toBeVisible();
  expect(fixture.user.user_metadata).toMatchObject({ display_name: 'María López', password_set: true, must_change_password: false });

  await page.getByRole('button', { name: 'Entrar a RivaStock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Panel de Control', exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText('María López');
  await expect(page.locator('body')).not.toContainText('owner@example.test');

  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill('owner@example.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill('Correct-Horse-123');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { name: 'Panel de Control', exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText('María López');
  await expect(page).not.toHaveURL(/\/login$/);
  expect(verifyCalls[0]).toMatchObject({ token_hash: 'invite-token-hash', type: 'invite' });
  expect(fixture.pageErrors).toEqual([]);
});

test('recovery link opens the new-password form and requires login after saving', async ({ page }) => {
  const fixture = await mountFixture(page, {
    authenticated: false,
    userMetadata: { display_name: 'Fixture Owner', password_set: true },
    initialPassword: 'Old-password-123',
  });

  await page.goto('/auth/confirm?token_hash=recovery-token-hash&type=recovery');
  await expect(page).toHaveURL(/\/reset-password\?type=recovery$/);
  await expect(page.getByRole('heading', { name: 'Elegí tu contraseña nueva' })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password/);
  await page.getByRole('textbox', { name: 'Contraseña nueva' }).fill('Recovered-password-456');
  await page.getByLabel('Repetila').fill('Recovered-password-456');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText('Contraseña actualizada. Te vamos a llevar al ingreso.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill('owner@example.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill('Recovered-password-456');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { name: 'Panel de Control', exact: true })).toBeVisible();
  expect(fixture.user.user_metadata.password_set).toBe(true);
  expect(fixture.pageErrors).toEqual([]);
});

test('an authenticated account without password_set cannot open the application', async ({ page }) => {
  await mountFixture(page, {
    userMetadata: { display_name: '', password_set: false, signup_kind: null },
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/reset-password\?type=first-login$/);
  await expect(page.getByRole('heading', { name: 'Creá tu contraseña' })).toBeVisible();
  await expect(page.getByLabel('¿Cómo te llamás?')).toBeVisible();
});

test('first-owner setup blocks dismissal, validates a unique name, and saves business details and catalog link', async ({ page }) => {
  let profileLookupConflict = true;
  const fixture = await mountFixture(page, {
    businessName: '',
    intercept: async (route, url) => {
      if (url.pathname === '/rest/v1/profiles' && route.request().method() === 'GET'
        && url.searchParams.get('business_name_lower') === 'eq.taken shop' && profileLookupConflict) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
          ...profile('Taken Shop'), id: '00000000-0000-4000-8000-000000000099',
        }]) });
        return true;
      }
      return false;
    },
  });

  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Completá los datos de tu negocio' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.click(8, 8);
  await expect(dialog).toBeVisible();

  await page.getByLabel('Nombre del negocio').fill('Taken Shop');
  await page.getByRole('button', { name: 'Guardar y continuar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Este nombre de negocio ya está en uso. Elegí otro.');

  profileLookupConflict = false;
  await page.getByLabel('Nombre del negocio').fill('North Star Store');
  await expect(dialog).toContainText('/catalogo/north-star-store');
  await page.getByLabel('Moneda').selectOption('US$');
  await page.getByLabel('Teléfono de contacto').fill('+1 555 555 0110');
  await page.getByLabel('Email de contacto').fill('sales@example.test');
  await page.getByRole('button', { name: 'Guardar y continuar' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Panel de Control', exact: true })).toBeVisible();
  expect(fixture.profile).toMatchObject({
    business_name: 'North Star Store',
    business_name_lower: 'north star store',
    currency_symbol: 'US$',
    phone: '+1 555 555 0110',
    email_contact: 'sales@example.test',
    catalog_slug: 'north-star-store',
  });
  expect(fixture.requests.some((request) => request.method === 'POST' && request.pathname === '/rest/v1/catalog_config')).toBe(true);
  expect(fixture.pageErrors).toEqual([]);
});

test('empty base-plan pages have helpful empty states and no runtime or console errors', async ({ page }) => {
  const fixture = await mountFixture(page, { businessName: 'Empty Fixture Store' });
  const pages = [
    ['/', 'No hay ventas registradas'],
    ['/consulta-rapida', 'Escaneá un producto para consultar su precio'],
    ['/stock', 'Todavía no cargaste productos. Agregá el primero.'],
    ['/ventas', 'Todavía no registraste ventas. Creá la primera desde Nueva Venta.'],
    ['/reportes', 'No hay ventas en el período seleccionado'],
    ['/pos', 'El carrito está vacío'],
    ['/presupuestos', 'Todavía no creaste presupuestos. Creá el primero desde Nuevo Presupuesto.'],
    ['/clientes', 'Todavía no cargaste clientes. Agregá el primero desde Nuevo Cliente.'],
    ['/proveedores', 'Todavía no cargaste proveedores. Agregá el primero desde Nuevo Proveedor.'],
    ['/compras', 'Registra tu primer pedido'],
    ['/ingresos', 'Todavía no registraste ingresos. Usá Registrar Ingreso para cargar el primero.'],
    ['/caja', 'Todavía no hay movimientos de caja. Registrá un ingreso o gasto para empezar.'],
    ['/pedidos', 'Todavía no hay pedidos recibidos desde tu catálogo.'],
    ['/calculadora', 'No hay un rango definido para este precio'],
    ['/config', 'Información del Negocio'],
    ['/trazabilidad', 'Todavía no hay eventos de trazabilidad.'],
    ['/catalogo/fixture-store', 'Catálogo vacío'],
  ];

  for (const [path, emptyState] of pages) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    const body = await page.locator('main').innerText();
    expect(body, `Unexpected data-load failure on ${path}`).not.toContain('No se pudo cargar');
    expect(body, `Unexpected empty access-denied state on ${path}`).not.toContain('No tenés permiso');
    await expect(page.locator('main'), `Missing helpful empty state on ${path}`).toContainText(emptyState);
  }

  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.consoleErrors).toEqual([]);
});

test('catalog orders use readable dark status controls and safe delete confirmation on mobile and desktop', async ({ page }) => {
  const order = {
    id: 'order-qa-mobile-delete',
    user_id: ownerId,
    customer_name: 'Revendedor QA',
    customer_phone: '5490000000000',
    customer_email: 'qa@example.test',
    customer_address: 'General Pico',
    customer_message: '',
    items: [{ productId: 'product-qa', productName: 'Producto QA', quantity: 1, price: 1000 }],
    total: 1000,
    status: 'Nuevo',
    date: '2026-11-08T12:00:00Z',
    is_read: false,
    channel: 'reseller',
  };
  const fixture = await mountFixture(page, { businessName: 'Order Fixture Store', orders: [order] });

  for (const width of [360, 1440]) {
    if (fixture.orders.length === 0) fixture.orders.push(order);
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/pedidos');
    await expect(page.getByText('Revendedor QA', { exact: true })).toBeVisible();
    await page.evaluate(() => document.documentElement.classList.add('dark'));

    const status = page.getByTestId('order-status-select');
    await expect(status).toBeVisible();
    const colors = await status.evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      foreground: getComputedStyle(element).color,
      optionClass: element.querySelector('option')?.className ?? '',
    }));
    expect(colors.background).not.toBe('rgb(255, 255, 255)');
    expect(colors.foreground).not.toBe('rgb(255, 255, 255)');
    expect(colors.optionClass).toContain('text-[var(--ink)]');

    await page.getByRole('button', { name: 'Eliminar pedido' }).first().click();
    const confirmation = page.getByRole('alertdialog', { name: 'Eliminar pedido' });
    await expect(confirmation).toContainText('¿Eliminar el pedido de Revendedor QA? No se puede deshacer.');
    await expect(confirmation).toBeInViewport();
    await confirmation.getByRole('button', { name: 'Eliminar pedido' }).click();
    await expect(page.getByText('Todavía no hay pedidos recibidos desde tu catálogo.')).toBeVisible();
  }

  expect(fixture.requests.filter(request => request.method === 'DELETE')).toEqual([
    { method: 'DELETE', pathname: '/rest/v1/orders', body: null },
    { method: 'DELETE', pathname: '/rest/v1/orders', body: null },
  ]);
  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.consoleErrors).toEqual([]);
});

test('platform plan dropdown uses the approved dark palette', async ({ page }) => {
  const fixture = await mountFixture(page, { businessName: 'Platform Fixture Store', platformAdmin: true });
  await page.goto('/plataforma');
  await expect(page.getByText('Plataforma RivaStock')).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add('dark'));

  const plan = page.locator('select').first();
  await expect(plan).toBeVisible();
  const colors = await plan.evaluate(element => {
    const style = getComputedStyle(element);
    const option = element.querySelector('option');
    const optionStyle = option ? getComputedStyle(option) : null;
    return {
      background: style.backgroundColor,
      foreground: style.color,
      border: style.borderColor,
      colorScheme: style.colorScheme,
      optionBackground: optionStyle?.backgroundColor,
      optionForeground: optionStyle?.color,
    };
  });
  expect(colors).toEqual({
    background: 'rgb(32, 32, 32)',
    foreground: 'rgb(242, 242, 242)',
    border: 'rgb(38, 38, 38)',
    colorScheme: 'dark',
    optionBackground: 'rgb(32, 32, 32)',
    optionForeground: 'rgb(242, 242, 242)',
  });
  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.consoleErrors).toEqual([]);
});
