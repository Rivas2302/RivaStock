import { expect, test, type Page, type Route } from '@playwright/test';

const OWNER_ID = '10000000-0000-4000-8000-000000000901';
const CATEGORY_ID = '10000000-0000-4000-8000-000000000902';
const ORDER_ID = '10000000-0000-4000-8000-000000000903';
const PROJECT_HOST = 'rivastock-test.invalid';
const CREATED_AT = '2026-11-10T12:00:00.000Z';
const imageBytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64');
const moduleKeys = [
  'sales', 'quotes', 'orders', 'quickPrice', 'stock', 'intake', 'sendPhotos', 'customers', 'suppliers',
  'resellers', 'supplierOrders', 'cash', 'reports', 'calculator', 'ai', 'knowledge', 'automation', 'traceability',
];
const minimumModules = Object.fromEntries(moduleKeys.map(key => [key, ['stock', 'orders', 'sales', 'customers'].includes(key)]));

function makeSession(user: Record<string, unknown>) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: OWNER_ID, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer', user,
  };
}

async function makeImageFile(page: Page, name: string) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo crear la imagen de prueba.');
    context.fillStyle = '#3156a6';
    context.fillRect(0, 0, 320, 320);
    context.fillStyle = '#ffffff';
    context.font = 'bold 38px sans-serif';
    context.fillText('QA', 128, 172);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo preparar la imagen.')), 'image/jpeg', 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(bytes) };
}

function createBackend() {
  const user: Record<string, unknown> = {
    id: OWNER_ID,
    email: 'cliente.qa@example.test',
    email_confirmed_at: CREATED_AT,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: { display_name: '', password_set: false, must_change_password: true, signup_kind: 'business_owner' },
    created_at: CREATED_AT,
  };
  let password = '';
  const profile: Record<string, unknown> = {
    id: OWNER_ID,
    email: user.email,
    display_name: '',
    role: 'admin',
    business_name: 'Electro Pasión QA',
    business_name_lower: 'electro pasión qa',
    currency_symbol: '$',
    dark_mode: false,
    phone: null,
    email_contact: null,
    onboarding_completed_at: CREATED_AT,
    catalog_slug: 'electro-pasion-qa',
    created_at: CREATED_AT,
  };
  const products: Record<string, unknown>[] = [];
  const orders: Record<string, unknown>[] = [];
  const uploadedPaths: string[] = [];
  const requestRoles: Array<{ path: string; method: string; role: 'authenticated' | 'anon' }> = [];
  const category = { id: CATEGORY_ID, user_id: OWNER_ID, name: 'Accesorios' };
  const catalog: Record<string, unknown> = {
    id: '10000000-0000-4000-8000-000000000904',
    user_id: OWNER_ID,
    business_name: 'Electro Pasión QA',
    slug: 'electro-pasion-qa',
    enabled: true,
    show_prices: true,
    show_stock: false,
    show_stock_quantity: false,
    show_out_of_stock: false,
    allow_orders: true,
    welcome_message: 'Encontrá lo que buscás.',
    primary_color: '#3156a6',
    accent_color: '#3156a6',
    logo_url: null,
    whatsapp_number: '5492302000000',
    layout: 'Grid',
    font_style: 'Modern',
    category_photo_overrides: {},
    presentation: {
      theme: 'normal',
      heroTitle: 'Electro Pasión QA',
      heroDescription: 'Productos para probar el catálogo.',
      heroColor: '#172033',
      accentColor: '#3156a6',
      sections: [{ id: 'all', visible: true }],
      featuredProductIds: [],
      offerProductIds: [],
      showProductsWithoutPhoto: true,
      showWhatsAppButton: true,
      whatsappMessageTemplate: 'Hola, quiero {producto} por {precio}. {link}',
      ambience: { announcementText: '' },
    },
  };

  const orderRow = () => orders[0] ?? null;
  const publicProducts = () => products.map(row => ({
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    category: 'Accesorios',
    salePrice: row.sale_price,
    stock: row.stock,
    imageUrl: row.image_url,
    images: row.images,
    description: row.description,
    availability: 'in_stock',
  }));

  async function mount(page: Page, options: { ownerSession?: boolean } = {}) {
    await page.route('**/*', async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
      if (url.hostname !== PROJECT_HOST) return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
      const path = url.pathname;
      const method = route.request().method();
      const authorization = route.request().headers().authorization ?? '';
      const role = authorization.includes('fixture') ? 'authenticated' : 'anon';
      requestRoles.push({ path, method, role });
      let body: unknown = null;
      try { body = route.request().postDataJSON?.() ?? null; } catch { /* Storage image uploads use multipart bodies. */ }

      if (path === '/auth/v1/verify' && method === 'POST') return route.fulfill({ json: makeSession(user) });
      if (path === '/auth/v1/user') {
        if (method === 'PATCH' || method === 'PUT') {
          const patch = body as { data?: Record<string, unknown>; password?: string } | null;
          if (patch?.data) user.user_metadata = { ...(user.user_metadata as object), ...patch.data };
          if (patch?.password) password = patch.password;
        }
        return route.fulfill({ json: user });
      }
      if (path === '/auth/v1/token' && method === 'POST') {
        if ((body as { email?: string; password?: string } | null)?.password === password && password) return route.fulfill({ json: makeSession(user) });
        return route.fulfill({ status: 400, json: { message: 'Invalid login credentials' } });
      }
      if (path === '/auth/v1/logout') return route.fulfill({ json: {} });
      if (path.endsWith('/rpc/get_owner_profile')) return route.fulfill({ json: [profile] });
      if (path.endsWith('/rpc/is_platform_admin')) return route.fulfill({ json: false });
      if (path.endsWith('/rpc/my_business_plan')) return route.fulfill({ json: {
        plan_code: 'base', plan_name: 'RivaStock', status: 'active', limits: { modules: minimumModules },
      } });
      if (path.endsWith('/rpc/storage_upload_check')) return route.fulfill({ json: { allowed: true, reason: null } });
      if (path.endsWith('/rpc/get_public_inventory_owner_labels')) return route.fulfill({ json: [] });
      if (path.endsWith('/rpc/get_reseller_catalog_status')) return route.fulfill({ json: { enabled: false } });
      if (path.endsWith('/rpc/resolve_public_catalog_slug')) return route.fulfill({ json: null });
      if (path.endsWith('/rpc/catalog_slug_available')) return route.fulfill({ json: true });
      if (path.endsWith('/rpc/suggest_catalog_slug')) return route.fulfill({ json: (body as { p_base_slug?: string } | null)?.p_base_slug ?? 'tienda-qa' });
      if (path.endsWith('/rpc/get_public_catalog_products')) return route.fulfill({ json: publicProducts() });
      if (path.endsWith('/rpc/create_public_catalog_order')) {
        const payload = body as { p_customer?: Record<string, unknown>; p_items?: Array<Record<string, unknown>> } | null;
        const itemRequest = payload?.p_items?.[0] ?? {};
        const product = products.find(row => row.id === itemRequest.product_id || row.id === itemRequest.productId) ?? products[0];
        const quantity = Number(itemRequest.quantity ?? 1);
        const price = Number(product?.sale_price ?? 0);
        const order: Record<string, unknown> = {
          id: ORDER_ID,
          order_code: 'P-QA-0001',
          user_id: OWNER_ID,
          date: CREATED_AT,
          customer_name: payload?.p_customer?.name ?? 'Comprador QA',
          customer_phone: payload?.p_customer?.phone ?? '2302000000',
          customer_email: payload?.p_customer?.email ?? '',
          customer_address: payload?.p_customer?.address ?? '',
          customer_message: payload?.p_customer?.message ?? '',
          items: [{ productId: product?.id, productName: product?.name, quantity, price }],
          total: price * quantity,
          status: 'Nuevo',
          is_read: false,
          channel: 'retail',
          delivery_method: 'pickup',
        };
        orders.splice(0, orders.length, order);
        return route.fulfill({ json: {
          id: ORDER_ID, orderCode: 'P-QA-0001', total: price * quantity, channel: 'retail',
          items: [{ productId: product?.id, productName: product?.name, quantity, price }],
        } });
      }
      if (path === '/functions/v1/send-order-notification') return route.fulfill({ status: 202, json: { ok: true } });
      if (path.startsWith('/storage/v1/object/public/assets/')) return route.fulfill({ status: 200, contentType: 'image/webp', body: imageBytes });
      if (path.startsWith('/storage/v1/object/assets/')) {
        uploadedPaths.push(path.replace('/storage/v1/object/assets/', ''));
        return route.fulfill({ status: 200, json: { Key: path.replace('/storage/v1/object/', ''), Id: `fixture-upload-${uploadedPaths.length}` } });
      }
      if (!path.startsWith('/rest/v1/')) return route.fulfill({ status: 200, json: [] });

      const table = path.replace('/rest/v1/', '');
      let data: unknown = [];
      let status = 200;
      if (table === 'profiles') {
        if (method === 'PATCH') Object.assign(profile, body as object);
        data = [profile];
      } else if (table === 'categories') {
        data = [category];
      } else if (table === 'products') {
        if (method === 'POST') {
          const row = { ...(body as Record<string, unknown>), user_id: OWNER_ID, created_at: CREATED_AT, updated_at: CREATED_AT };
          products.push(row);
          data = [row];
          status = 201;
        } else if (method === 'PATCH') {
          const id = url.searchParams.get('id')?.replace(/^eq\./, '');
          const row = products.find(item => item.id === id);
          if (row) Object.assign(row, body as object);
          data = row ? [row] : [];
        } else data = products;
      } else if (table === 'catalog_configs' || table === 'catalog_config') {
        if (method === 'POST' || method === 'PATCH') Object.assign(catalog, body as object);
        data = [catalog];
      } else if (table === 'orders') {
        if (method === 'PATCH') {
          const id = url.searchParams.get('id')?.replace(/^eq\./, '');
          const row = orders.find(item => item.id === id);
          if (row) Object.assign(row, body as object);
          data = row ? [row] : [];
        } else data = orders;
      } else if (table === 'inventory_owners') {
        data = [{ id: '10000000-0000-4000-8000-000000000905', user_id: OWNER_ID, name: 'Principal', is_primary: true, sort_order: 0 }];
      } else if (table === 'inventory_owner_memberships') {
        data = [{ inventory_owner_id: '10000000-0000-4000-8000-000000000905', is_default: true, can_operate: true }];
      } else if (table === 'inventory_operation_settings') {
        data = [{ holdings_enabled: false }];
      } else if (table === 'collaborators' || table === 'price_ranges') {
        data = [];
      }
      const accept = route.request().headers().accept ?? '';
      if (accept.includes('application/vnd.pgrst.object+json')) data = Array.isArray(data) ? data[0] ?? null : data;
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });

    if (options.ownerSession) await page.addInitScript(session => localStorage.setItem('rivastock-auth', JSON.stringify(session)), makeSession(user));
  }

  return { mount, user, profile, catalog, products, orders, uploadedPaths, requestRoles, orderRow };
}

test('new invited business configures catalog and receives an anonymous WhatsApp order on mobile', async ({ page, browser }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const backend = createBackend();
  await backend.mount(page);

  await page.goto('/auth/confirm?token_hash=qa-invitation&type=invite');
  await expect(page).toHaveURL(/\/reset-password\?type=invite$/);
  await expect(page.getByRole('heading', { name: 'Creá tu contraseña' })).toBeVisible();
  await page.getByLabel('¿Cómo te llamás?').fill('María QA');
  await page.getByLabel('Contraseña nueva').fill('Prueba-Segura-123');
  await page.getByLabel('Repetila').fill('Prueba-Segura-123');
  await page.getByRole('button', { name: 'Crear contraseña y entrar' }).click();
  await expect(page.getByText('Tu nombre y contraseña quedaron guardados.')).toBeVisible();
  await page.getByRole('button', { name: 'Entrar a RivaStock', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Buenas tardes, María/ })).toBeVisible();
  await expect(page.locator('body')).toContainText('María QA');
  await expect(page.locator('body')).not.toContainText(/RivaTech|Instalá la central|Vincular la central|Conectá Facebook/i);
  await expect(page.getByRole('link', { name: 'Stock' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ventas' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Clientes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Proveedores' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await expect(page.getByRole('link', { name: 'Pedidos' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.goto('/stock');
  await expect(page.getByRole('region', { name: 'Stock móvil' })).toBeVisible();
  await page.getByRole('button', { name: /Agregar producto/i }).first().click();
  const form = page.getByTestId('mobile-product-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Nombre').fill('Producto QA Cliente');
  await form.getByLabel('Categoría').selectOption(CATEGORY_ID);
  await form.getByLabel('Precio de venta').fill('2500');
  await form.getByLabel('Stock inicial').fill('3');
  const photo = await makeImageFile(page, 'producto-qa.jpg');
  const chooser = page.waitForEvent('filechooser');
  await form.getByRole('button', { name: 'Galería' }).click();
  await (await chooser).setFiles(photo);
  await expect(form.getByRole('img', { name: 'Imagen 1' })).toBeVisible();
  await form.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(form).toHaveCount(0);
  expect(backend.products).toHaveLength(1);
  expect(backend.uploadedPaths.length).toBeGreaterThan(0);
  expect(backend.requestRoles.some(request => request.path.startsWith('/storage/v1/object/assets/') && request.role === 'authenticated')).toBe(true);

  await page.goto('/config');
  await page.getByRole('button', { name: 'Catálogo público' }).click();
  await expect(page.getByRole('heading', { name: 'Tu catálogo' })).toBeVisible();
  await page.getByRole('button', { name: /Datos del negocio/ }).click();
  await page.getByLabel('Nombre del negocio').fill('Electro Pasión QA');
  await page.getByLabel('Tu link').fill('electro-pasion-qa');
  const logo = await makeImageFile(page, 'logo-qa.jpg');
  await page.getByLabel('Subir logo').setInputFiles(logo);
  await expect(page.getByRole('img', { name: 'Logo del negocio' })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  await page.getByRole('button', { name: 'Volver a configuración del catálogo' }).click();
  await page.getByRole('button', { name: /WhatsApp y pedidos online/ }).click();
  await page.getByLabel('Número de WhatsApp').fill('5492302111111');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  await page.getByRole('button', { name: 'Volver a configuración del catálogo' }).click();
  const catalogLink = page.getByRole('link', { name: 'Abrir' });
  await expect(catalogLink).toHaveAttribute('href', /\/p\/electro-pasion-qa$/);
  expect(backend.catalog).toMatchObject({ business_name: 'Electro Pasión QA', slug: 'electro-pasion-qa', whatsapp_number: '5492302111111' });
  expect(backend.catalog.logo_url).toContain('/storage/v1/object/public/assets/');

  const anonContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const anonPage = await anonContext.newPage();
  await backend.mount(anonPage);
  const publicUrl = new URL(await catalogLink.getAttribute('href') ?? '', 'http://127.0.0.1:4173');
  // Vercel's /p short-link rewrite is external to the local Vite test server.
  await anonPage.goto(`/catalogo/${publicUrl.pathname.split('/').at(-1)}`);
  await expect(anonPage.getByRole('heading', { name: 'Electro Pasión QA' })).toBeVisible();
  await expect(anonPage.getByRole('img', { name: 'Producto QA Cliente' })).toBeVisible();
  await anonPage.getByRole('button', { name: 'Agregar Producto QA Cliente al carrito' }).last().click();
  await anonPage.getByRole('button', { name: /Abrir carrito/ }).click();
  await anonPage.getByRole('button', { name: 'Confirmar Pedido' }).click();
  await anonPage.getByPlaceholder('Nombre completo').fill('Comprador QA');
  await anonPage.getByPlaceholder('WhatsApp').fill('2302000000');
  await anonPage.getByRole('button', { name: 'Enviar Pedido' }).click();
  await expect(anonPage.getByRole('heading', { name: '¡Pedido recibido!' })).toBeVisible();
  await expect(anonPage.getByTestId('retail-order-code')).toHaveText('P-QA-0001');
  const whatsappLink = anonPage.getByRole('link', { name: 'Enviar pedido por WhatsApp' });
  const whatsappUrl = new URL(await whatsappLink.getAttribute('href') ?? '');
  expect(whatsappUrl.hostname).toBe('wa.me');
  expect(whatsappUrl.searchParams.get('text')).toContain('P-QA-0001');
  expect(whatsappUrl.searchParams.get('text')).toContain('Producto QA Cliente');
  expect(backend.requestRoles.some(request => request.path.endsWith('/rpc/create_public_catalog_order') && request.role === 'anon')).toBe(true);
  expect(backend.requestRoles.some(request => request.path.endsWith('/rpc/get_public_catalog_products') && request.role === 'anon')).toBe(true);
  expect(backend.orderRow()).toMatchObject({ customer_name: 'Comprador QA', channel: 'retail', status: 'Nuevo' });

  await page.goto('/pedidos');
  await expect(page.getByRole('heading', { name: 'Pedidos del Catálogo' })).toBeVisible();
  await expect(page.getByTestId('order-code')).toContainText('P-QA-0001');
  expect(backend.requestRoles.some(request => request.path.startsWith('/rest/v1/orders') && request.role === 'authenticated')).toBe(true);
  expect(backend.user.user_metadata).toMatchObject({ display_name: 'María QA', password_set: true, must_change_password: false });
  await anonContext.close();
});
