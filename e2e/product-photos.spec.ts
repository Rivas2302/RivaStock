import { expect, test, type Page, type Route } from '@playwright/test';

const userId = '00000000-0000-4000-8000-000000000071';
const inventoryOwnerId = '00000000-0000-4000-8000-000000000072';
const user = {
  id: userId,
  email: 'photos@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

const products = [
  {
    id: 'camera-1', user_id: userId, name: 'Cámara WiFi 360', category_id: 'security', category: 'Seguridad',
    purchase_price: 9000, sale_price: 15000, stock: 5, min_stock: 1, show_in_catalog: true,
    barcode: '779000000001', custom_fields: { SKU: 'CAM-360' },
    images: [
      'https://rivastock-test.invalid/storage/v1/object/public/assets/owner/products/camera-1/photo.webp',
      'https://rivastock-test.invalid/storage/v1/object/public/assets/owner/products/camera-1/photo-2.webp',
    ], image_url: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'headphones-1', user_id: userId, name: 'Auriculares Inalámbricos', category_id: 'audio', category: 'Audio',
    purchase_price: 5000, sale_price: 9000, stock: 0, min_stock: 1, show_in_catalog: false,
    barcode: '779000000002', custom_fields: { SKU: 'AUR-12' },
    images: ['https://rivastock-test.invalid/storage/v1/object/public/assets/owner/products/headphones-1/photo.webp'], image_url: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  },
];

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token',
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  };
}

async function mountFixture(page: Page, options: { empty?: boolean; canShare?: boolean; failSecondPhoto?: boolean } = {}) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript((canShare) => {
    const calls: { kind: string; value?: string; fileCount?: number }[] = [];
    Object.defineProperty(window, '__productPhotoCalls', { value: calls, configurable: true });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => canShare });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { text?: string; files?: File[] }) => {
        calls.push({ kind: 'share', value: data.text, fileCount: data.files?.length ?? 0 });
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { calls.push({ kind: 'copy', value }); } },
    });
  }, options.canShare ?? true);

  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.abort();
    const path = url.pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/v1/user')) data = user;
    else if (path.endsWith('/auth/v1/logout')) data = {};
    else if (path.endsWith('/auth/v1/token')) data = session();
    else if (path.endsWith('/rpc/get_owner_profile')) data = [{
      id: userId, email: user.email, display_name: 'Photo Owner', business_name: 'Photo Shop',
      currency_symbol: '$', role: 'admin', dark_mode: false, catalog_slug: 'photo-shop',
    }];
    else if (path.endsWith('/rpc/is_platform_admin')) data = false;
    else if (path.endsWith('/rpc/my_business_plan')) data = {
      plan_code: 'base', plan_name: 'Base', status: 'active', limits: { modules: { ai: false, knowledge: false, automation: false } },
    };
    else if (path.endsWith('/collaborators')) data = [];
    else if (path.endsWith('/inventory_owner_memberships')) data = [{ inventory_owner_id: inventoryOwnerId, is_default: true, can_operate: true }];
    else if (path.endsWith('/inventory_operation_settings')) data = [{ holdings_enabled: false }];
    else if (path.endsWith('/inventory_owners')) data = [{ id: inventoryOwnerId, user_id: userId, name: 'Principal', is_primary: true, sort_order: 0 }];
    else if (path.endsWith('/rest/v1/products')) data = options.empty ? [] : products;
    else if (path.endsWith('/rest/v1/price_lists')) data = [{
      id: 'reseller-1', owner_uid: userId, name: 'Revendedores', kind: 'reseller', default_discount_percent: 20,
      public_enabled: false, minimum_rule: 'none', minimum_order_amount: 0, minimum_order_quantity: 0,
      minimum_profit_margin_percent: 25, target_reseller_discount_percent: 15,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    }];
    else if (path.endsWith('/rest/v1/price_list_items')) data = [
      {
        id: 'item-camera', owner_uid: userId, price_list_id: 'reseller-1', product_id: 'camera-1',
        pricing_mode: 'fixed', discount_percent: null, fixed_price: 12000, availability: 'in_stock', sort_order: 0,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'item-headphones', owner_uid: userId, price_list_id: 'reseller-1', product_id: 'headphones-1',
        pricing_mode: 'fixed', discount_percent: null, fixed_price: 8000, availability: 'in_stock', sort_order: 1,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ];
    else if (path.includes('/storage/v1/object/public/assets/')) {
      if (options.failSecondPhoto && path.endsWith('/photo-2.webp')) return route.abort('failed');
      const tinyWebp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64');
      return route.fulfill({ status: 200, contentType: 'image/webp', body: tinyWebp });
    }
    if (route.request().headers().accept?.includes('application/vnd.pgrst.object+json') && Array.isArray(data)) {
      data = data[0] ?? null;
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.addInitScript((value) => localStorage.setItem('rivastock-auth', JSON.stringify(value)), session());
  await page.goto('/fotos');
  await expect(page.getByRole('heading', { name: 'Buscar y enviar' })).toBeVisible();
  return { pageErrors };
}

test.describe('Android product photo flow', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test('searches, filters, opens the gallery, shares photos, and supports multi-select', async ({ page }) => {
    const fixture = await mountFixture(page);
    await expect(page.getByRole('link', { name: 'Buscar y enviar' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Buscar por nombre, categoría, código o campos propios' }).fill('wifi camara');
    await expect(page.getByRole('button', { name: 'Ver Cámara WiFi 360' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver Auriculares Inalámbricos' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await page.getByLabel('Categoría', { exact: true }).selectOption('Seguridad');
    await expect(page.getByRole('button', { name: 'Ver Cámara WiFi 360' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver Auriculares Inalámbricos' })).toHaveCount(0);
    await page.getByLabel('Categoría', { exact: true }).selectOption('all');
    await page.getByRole('button', { name: 'Solo con stock' }).click();
    await expect(page.getByRole('button', { name: 'Ver Cámara WiFi 360' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver Auriculares Inalámbricos' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Solo con stock' }).click();
    await page.getByLabel('Precio del texto').selectOption('reseller-1');
    await expect(page.getByText(/12\.000/)).toBeVisible();
    await page.getByLabel('Precio mínimo').fill('11000');
    await expect(page.getByRole('button', { name: 'Ver Cámara WiFi 360' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver Auriculares Inalámbricos' })).toHaveCount(0);
    await page.getByLabel('Precio mínimo').fill('');

    await page.getByRole('button', { name: 'Ver Cámara WiFi 360' }).click();
    await expect(page.getByRole('dialog', { name: 'Producto Cámara WiFi 360' })).toBeVisible();
    await page.getByRole('button', { name: 'Foto siguiente' }).click();
    await expect(page.getByText('2/2')).toBeVisible();
    await page.getByRole('dialog').locator('.aspect-square').first().evaluate((element) => {
      const dispatch = (type: 'touchstart' | 'touchend', clientX: number) => {
        const touch = new Touch({ identifier: 7, target: element, clientX, clientY: 240 });
        element.dispatchEvent(new TouchEvent(type, {
          bubbles: true,
          changedTouches: [touch],
          touches: type === 'touchstart' ? [touch] : [],
        }));
      };
      dispatch('touchstart', 120);
      dispatch('touchend', 300);
    });
    await expect(page.getByText('1/2')).toBeVisible();
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByText('Texto copiado: pegalo como pie de foto si no aparece')).toBeVisible();
    const shareCalls = await page.evaluate(() => (window as unknown as { __productPhotoCalls: { kind: string; value?: string; fileCount?: number }[] }).__productPhotoCalls);
    expect(shareCalls.slice(-2).map((call) => call.kind)).toEqual(['copy', 'share']);
    expect(shareCalls.at(-1)?.value).toContain('/catalogo/photo-shop/camera-1');
    expect(shareCalls.at(-1)?.fileCount).toBe(2);

    await page.getByRole('button', { name: 'Cerrar producto' }).click();
    await page.locator('article').nth(0).getByRole('button', { name: 'Seleccionar', exact: true }).click();
    await page.locator('article').nth(1).getByRole('button', { name: 'Seleccionar', exact: true }).click();
    await expect(page.getByRole('complementary').getByText('2 productos')).toBeVisible();
    await page.getByRole('button', { name: 'Enviar', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Ver Cámara WiFi 360' })).toBeVisible();
    const multiShareCalls = await page.evaluate(() => (window as unknown as { __productPhotoCalls: { kind: string; value?: string; fileCount?: number }[] }).__productPhotoCalls);
    expect(multiShareCalls.at(-1)?.fileCount).toBe(3);
    expect(fixture.pageErrors).toEqual([]);
  });

  test('shares the downloaded photo when the second photo fails', async ({ page }) => {
    const fixture = await mountFixture(page, { failSecondPhoto: true });
    await page.getByRole('button', { name: 'Ver Cámara WiFi 360' }).click();
    await expect(page.getByText('No pudimos incluir 1 foto.').first()).toBeVisible();
    const sendButton = page.getByRole('button', { name: 'Enviar', exact: true });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(page.getByText('No pudimos incluir 1 foto.').first()).toBeVisible();
    const calls = await page.evaluate(() => (window as unknown as { __productPhotoCalls: { kind: string; fileCount?: number }[] }).__productPhotoCalls);
    expect(calls.at(-1)).toMatchObject({ kind: 'share', fileCount: 1 });
    expect(fixture.pageErrors).toEqual([]);
  });
});

test.describe('iPhone product photo flow', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });

  test('shows save and copy fallback when file sharing is unavailable', async ({ page }) => {
    await mountFixture(page, { canShare: false });
    await page.getByRole('button', { name: 'Ver Cámara WiFi 360' }).click();
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Guardar fotos y copiar texto' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar camara-wifi-360-1.webp' })).toBeVisible();
    await page.getByRole('button', { name: 'Copiar texto' }).click();
  });

  test('shows an actionable account-empty state', async ({ page }) => {
    await mountFixture(page, { empty: true });
    await expect(page.getByRole('heading', { name: 'Todavía no hay productos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ir a Stock' })).toBeVisible();
  });
});
