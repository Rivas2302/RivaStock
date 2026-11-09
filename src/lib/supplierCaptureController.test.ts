import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupplierCaptureController } from '../../extensions/facebook/supplier-capture.js';

function memoryArea() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: async (key: string) => ({ [key]: values[key] }),
    set: async (entries: Record<string, unknown>) => Object.assign(values, entries),
  };
}

function mockExtension(tabUrl = 'https://supplier.example.test/products') {
  const session = memoryArea();
  const local = memoryArea();
  const api = {
    storage: { session, local },
    action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined) },
    scripting: { registerContentScripts: vi.fn(async () => undefined), unregisterContentScripts: vi.fn(async () => undefined) },
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: tabUrl })),
      reload: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ stopped: true })),
      update: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
      onRemoved: { addListener: vi.fn() },
    },
    permissions: { contains: vi.fn(async () => true) },
    runtime: { id: 'riva-extension-id', getURL: (path: string) => `chrome-extension://riva-extension-id/${path}`, onMessage: { addListener: vi.fn() } },
    crypto: { randomUUID: () => 'a1b2c3d4-e5f6-4789-a012-123456789abc' },
  };
  return { api, session, local };
}

describe('supplier capture controller', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('only registers capture scripts for the exact HTTPS supplier origin and reloads that tab', async () => {
    const { api } = mockExtension();
    const controller = createSupplierCaptureController(api as never);
    await expect(controller.start(7, 'https://supplier.example.test')).resolves.toEqual({ started: true, origin: 'https://supplier.example.test' });
    expect(api.permissions.contains).toHaveBeenCalledWith({ origins: ['https://supplier.example.test/*'] });
    expect(api.scripting.registerContentScripts).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ matches: ['https://supplier.example.test/*'], world: 'MAIN', persistAcrossSessions: false }),
    ]));
    expect(api.tabs.reload).toHaveBeenCalledWith(7);
  });

  it('requires the Braja CDN permission and permits only its image subdomain for captured photos', async () => {
    const { api, local } = mockExtension('https://brajamayorista.com/tienda/centro/productos?categoria=31');
    const controller = createSupplierCaptureController(api as never);
    await controller.start(7, 'https://brajamayorista.com');
    expect(api.permissions.contains).toHaveBeenCalledWith({ origins: [
      'https://brajamayorista.com/*', 'https://api.brajamayorista.com/*',
    ] });
    local.values.supplierProductCaptures = {
      'a1b2c3d4-e5f6-4789-a012-123456789abc': {
        origin: 'https://brajamayorista.com', expiresAt: Date.now() + 60_000,
        items: [{ imageUrl: 'https://api.brajamayorista.com/uploads/derivados/qa/v1-card-320.webp' }],
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/webp' },
    })));
    await expect(controller.readCaptureImage('a1b2c3d4-e5f6-4789-a012-123456789abc',
      'https://api.brajamayorista.com/uploads/derivados/qa/v1-card-320.webp'))
      .resolves.toMatchObject({ mimeType: 'image/webp', size: 3 });
    await expect(controller.readCaptureImage('a1b2c3d4-e5f6-4789-a012-123456789abc',
      'https://evilbrajamayorista.com/uploads/derivados/qa/v1-card-320.webp')).rejects.toThrow('no pertenece al sitio leído');
  });

  it('refuses insecure, private, protected, and tab-mismatched origins', async () => {
    const { api } = mockExtension();
    const controller = createSupplierCaptureController(api as never);
    await expect(controller.start(7, 'http://supplier.example.test')).rejects.toThrow('Abrí una tienda');
    await expect(controller.start(7, 'https://127.0.0.1')).rejects.toThrow('Abrí una tienda');
    await expect(controller.start(7, 'https://facebook.com')).rejects.toThrow('Abrí una tienda');
    await expect(controller.start(7, 'https://other.example.test')).rejects.toThrow('pestaña activa cambió');
    expect(api.tabs.reload).not.toHaveBeenCalled();
  });

  it('keeps only normalized product fields and excludes credential-bearing URLs and arbitrary page warnings', async () => {
    const { api } = mockExtension();
    const controller = createSupplierCaptureController(api as never);
    await controller.start(7, 'https://supplier.example.test');
    await controller.handleEvidence({
      url: 'https://supplier.example.test/products',
      items: [{ name: ' Cable USB  ', code: 'SKU-1', price: 3500, currency: 'ARS', category: 'Cables',
        imageUrl: 'https://images.example.test/cable.webp?access_token=do-not-forward',
        url: 'https://supplier.example.test/item/1?session=do-not-forward', raw: 'cookie=do-not-forward', cookie: 'do-not-forward' }],
      source: ['dom-cards', 'unknown'], warnings: ['Hay productos sin precio; quedaron marcados para revisar y no se importan como costo cero.', 'cookie=do-not-forward'],
    }, { tab: { id: 7 }, url: 'https://supplier.example.test/products' } as never);

    const live = await controller.readLive();
    expect(live.items).toHaveLength(1);
    expect(live.items[0]).toMatchObject({ name: 'Cable USB', code: 'SKU-1', price: 3500, imageUrl: null });
    expect(live.items[0]).not.toHaveProperty('raw');
    expect(live.items[0]).not.toHaveProperty('cookie');
    expect(live.items[0]).not.toHaveProperty('url');
    expect(live.warnings).toEqual(['Hay productos sin precio; quedaron marcados para revisar y no se importan como costo cero.']);
    expect(JSON.stringify(live)).not.toContain('do-not-forward');
  });

  it('does not click form-like controls and stops dynamic scripts after cancellation', async () => {
    const { api } = mockExtension();
    const controller = createSupplierCaptureController(api as never);
    await controller.start(7, 'https://supplier.example.test');
    await controller.handlePageFinished({ url: 'https://supplier.example.test/products', navigation: { next: { kind: 'button', label: 'Agregar' } } },
      { tab: { id: 7 }, url: 'https://supplier.example.test/products' } as never);
    expect(api.tabs.sendMessage).not.toHaveBeenCalledWith(7, expect.objectContaining({ type: 'supplier-capture-click-next' }));
    await controller.cancel(7);
    expect(api.scripting.unregisterContentScripts).toHaveBeenCalled();
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'supplier-capture-stop' });
    expect(await controller.readLive()).toBeNull();
  });

  it('forwards the explicit next numbered page label for page-script revalidation', async () => {
    const { api } = mockExtension();
    const controller = createSupplierCaptureController(api as never);
    await controller.start(7, 'https://supplier.example.test');
    await controller.handleEvidence({
      url: 'https://supplier.example.test/products',
      items: [{ name: 'Producto 1', code: 'SKU-1', price: 100 }], source: ['dom-cards'], warnings: [],
    }, { tab: { id: 7 }, url: 'https://supplier.example.test/products' } as never);
    await controller.handlePageFinished({
      url: 'https://supplier.example.test/products',
      navigation: { next: { kind: 'button', label: 'Pagina 2' } },
    }, { tab: { id: 7 }, url: 'https://supplier.example.test/products' } as never);

    expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'supplier-capture-click-next', label: 'Pagina 2' });
  });

  it('advances only the next numbered mayori hash page through the page-script allowlist', async () => {
    const origin = 'https://mayori.store';
    const pageUrl = `${origin}/electrobh/index.php#productos_page-1`;
    const { api } = mockExtension(pageUrl);
    const controller = createSupplierCaptureController(api as never);
    await controller.start(7, origin);
    await controller.handleEvidence({
      url: pageUrl, items: [{ name: 'Producto 1', code: 'SKU-1', price: 100 }], source: ['dom-cards'], warnings: [],
    }, { tab: { id: 7 }, url: `${origin}/electrobh/index.php` } as never);
    expect((await controller.readLive()).lastPageUrl).toBe(pageUrl);
    vi.mocked(api.tabs.sendMessage).mockResolvedValue({ done: true } as never);
    await controller.handlePageFinished({
      url: pageUrl, navigation: { next: { kind: 'hash-page', page: 2, label: 'Página 2' } },
    }, { tab: { id: 7 }, url: `${origin}/electrobh/index.php` } as never);
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'supplier-capture-click-hash-page', page: 2 });
    expect(api.tabs.update).not.toHaveBeenCalled();
  });

  it('stores the capture locally for 24 hours, serves bounded chunks, then removes it on acknowledgement', async () => {
    const { api, local } = mockExtension();
    const controller = createSupplierCaptureController(api as never);
    await controller.start(7, 'https://supplier.example.test');
    await controller.handleEvidence({
      url: 'https://supplier.example.test/products',
      items: Array.from({ length: 501 }, (_, index) => ({ name: `Producto ${index}`, code: `SKU-${index}`, price: index + 1, currency: 'ARS' })),
      source: ['network-json'], warnings: [],
    }, { tab: { id: 7 }, url: 'https://supplier.example.test/products' } as never);
    const finished = await controller.finish(7);
    expect(finished).toEqual({ done: true, count: 501 });
    const first = await controller.readCapture('a1b2c3d4-e5f6-4789-a012-123456789abc', 0);
    const second = await controller.readCapture('a1b2c3d4-e5f6-4789-a012-123456789abc', 500);
    expect(first.items).toHaveLength(500);
    expect(first.done).toBe(false);
    expect(second.items).toHaveLength(1);
    expect(second.done).toBe(true);
    expect(Object.values(local.values.supplierProductCaptures as Record<string, { expiresAt: number }>)[0].expiresAt)
      .toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    await controller.acknowledgeCapture('a1b2c3d4-e5f6-4789-a012-123456789abc');
    await expect(controller.readCapture('a1b2c3d4-e5f6-4789-a012-123456789abc', 0)).rejects.toThrow('venció');
    expect(api.tabs.create).toHaveBeenCalledWith({
      url: 'https://rivastock.vercel.app/revendedores?importar=extension&captura=a1b2c3d4-e5f6-4789-a012-123456789abc', active: true,
    });
  });

  it('downloads only a captured same-origin image without credentials and caps it at 400 KB', async () => {
    const { api, local } = mockExtension();
    local.values.supplierProductCaptures = {
      'a1b2c3d4-e5f6-4789-a012-123456789abc': {
        origin: 'https://supplier.example.test', expiresAt: Date.now() + 60_000,
        items: [{ imageUrl: 'https://supplier.example.test/photo.webp', images: ['https://supplier.example.test/photo.webp'] }],
      },
    };
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/webp' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = createSupplierCaptureController(api as never);
    await expect(controller.readCaptureImage('a1b2c3d4-e5f6-4789-a012-123456789abc', 'https://supplier.example.test/photo.webp'))
      .resolves.toEqual({ mimeType: 'image/webp', base64: 'AQID', size: 3 });
    expect(fetchMock).toHaveBeenCalledWith('https://supplier.example.test/photo.webp', expect.objectContaining({
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    }));
    await expect(controller.readCaptureImage('a1b2c3d4-e5f6-4789-a012-123456789abc', 'https://supplier.example.test/other.webp'))
      .rejects.toThrow('no pertenece a un producto');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
