import { describe, expect, it, vi } from 'vitest';
import { readSupplierCatalog } from '../../supabase/functions/_shared/supplierCatalog';

const resolvePublic = async () => ['93.184.216.34'];

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}

describe('supplier structured catalog reader', () => {
  it('reads and paginates three WooCommerce Store API pages and converts minor units', async () => {
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get('page'));
      const count = page < 3 ? 100 : 1;
      return jsonResponse(Array.from({ length: count }, (_, index) => ({
        name: page === 1 && index === 0 ? 'LAMPARA SOLAR &#8211; 1015' : `Producto ${page}-${index}`,
        sku: `${page}-${index}`,
        prices: { price: page === 1 && index === 0 ? '775' : '10000', currency_code: 'USD', currency_minor_unit: 2 },
        categories: [{ name: 'Iluminación' }],
        images: [{ src: 'https://supplier.com/photo.webp' }],
        permalink: `https://supplier.com/product/${page}-${index}`,
      })));
    });
    const fetcher = fetcherMock as unknown as typeof fetch;

    const catalog = await readSupplierCatalog('https://supplier.com/productos/', resolvePublic, fetcher);
    expect(catalog.source).toBe('woocommerce');
    expect(catalog.currency).toBe('USD');
    expect(catalog.items).toHaveLength(201);
    expect(catalog.items[0]).toMatchObject({ name: 'LAMPARA SOLAR – 1015', price: 7.75, category: 'Iluminación' });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('uses Store API prices when WooCommerce accepts the ARS currency parameter', async () => {
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const ars = url.searchParams.get('currency') === 'ARS';
      return jsonResponse([{
        name: 'Cable', sku: 'HM352', prices: { price: ars ? '1000000' : '625', currency_code: ars ? 'ARS' : 'USD', currency_minor_unit: 2 },
        categories: [{ name: 'Cables' }], images: [], permalink: 'https://supplier.com/cable',
      }]);
    });
    const catalog = await readSupplierCatalog('https://supplier.com/productos/', resolvePublic, fetcherMock as unknown as typeof fetch);
    expect(catalog).toMatchObject({ currency: 'ARS', rateSource: 'store_api', items: [{ code: 'HM352', price: 10000 }] });
  });

  it('detects the exchange rate from three matching WooCommerce product pages', async () => {
    const prices = [6.25, 7.5, 10];
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith('/product/')) {
        const index = Number(url.pathname.split('/').pop()) - 1;
        return new Response(`<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">$</span>${(prices[index] * 1600).toLocaleString('en-US')}.00</bdi></span>`, { headers: { 'content-type': 'text/html' } });
      }
      return jsonResponse(prices.map((price, index) => ({
        name: `Producto ${index + 1}`, sku: `SKU-${index + 1}`,
        prices: { price: String(price * 100), currency_code: 'USD', currency_minor_unit: 2 },
        categories: [], images: [], permalink: `https://supplier.com/product/${index + 1}`,
      })));
    });
    const catalog = await readSupplierCatalog('https://supplier.com/productos/', resolvePublic, fetcherMock as unknown as typeof fetch);
    expect(catalog).toMatchObject({ currency: 'USD', detectedRate: 1600, rateSource: 'product_pages', sampleCodes: ['SKU-1', 'SKU-2', 'SKU-3'] });
  });

  it('does not accept inconsistent or bot-blocked product-page prices as an exchange rate', async () => {
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith('/product/')) {
        if (url.pathname.endsWith('/3')) return new Response('One moment, please', { headers: { 'content-type': 'text/html' } });
        const factor = url.pathname.endsWith('/2') ? 1700 : 1600;
        return new Response(`<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">$</span>${factor * 10}.00</bdi></span>`, { headers: { 'content-type': 'text/html' } });
      }
      return jsonResponse([1, 2, 3].map(index => ({ name: `Producto ${index}`, sku: `SKU-${index}`, prices: { price: '1000', currency_code: 'USD', currency_minor_unit: 2 }, categories: [], images: [], permalink: `https://supplier.com/product/${index}` })));
    });
    const catalog = await readSupplierCatalog('https://supplier.com/productos/', resolvePublic, fetcherMock as unknown as typeof fetch);
    expect(catalog.detectedRate).toBeNull();
    expect(catalog.rateSource).toBeNull();
  });

  it('reads Shopify products.json and uses variant SKU and price', async () => {
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== '/products.json') return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      return jsonResponse({ products: [{
        title: 'Botella térmica', product_type: 'Hogar', handle: 'botella-termica',
        variants: [{ sku: 'BT-1', price: '15.30' }], image: { src: 'https://supplier.com/bottle.webp' },
      }] });
    });
    const fetcher = fetcherMock as unknown as typeof fetch;
    const catalog = await readSupplierCatalog('https://supplier.com/list', resolvePublic, fetcher);
    expect(catalog).toMatchObject({ source: 'shopify', items: [{ code: 'BT-1', name: 'Botella térmica', price: 15.3, category: 'Hogar' }] });
  });

  it('parses JSON-LD Product and ItemList after API endpoints are unavailable', async () => {
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== '/productos/') return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } });
      return new Response('<script type="application/ld+json">{"@graph":[{"@type":"https://schema.org/ItemList","itemListElement":[{"item":{"@type":"https://schema.org/Product","name":"Cable C","sku":"C-1","category":"Cables","image":"/cable.webp","offers":{"@type":"Offer","price":"12345.00","priceCurrency":"ARS"}}}]},{"@type":"Offer","itemOffered":{"@type":"Product","name":"Cargador D","sku":"D-2"},"price":"22.50","priceCurrency":"USD"}]}</script>', { headers: { 'content-type': 'text/html' } });
    });
    const fetcher = fetcherMock as unknown as typeof fetch;
    const catalog = await readSupplierCatalog('https://supplier.com/productos/', resolvePublic, fetcher);
    expect(catalog).toMatchObject({ source: 'jsonld', currency: null, items: [
      { code: 'C-1', price: 12345, imageUrl: 'https://supplier.com/cable.webp' },
      { code: 'D-2', price: 22.5, name: 'Cargador D' },
    ] });
  });

  it('reports bot challenges clearly instead of returning challenge text as a product', async () => {
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== '/') return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } });
      return new Response('<html><body>One moment, please… Checking your browser</body></html>', { headers: { 'content-type': 'text/html' } });
    });
    const fetcher = fetcherMock as unknown as typeof fetch;
    await expect(readSupplierCatalog('https://supplier.com/', resolvePublic, fetcher)).rejects.toThrow('protección anti-bots');
  });

  it('rejects a redirect to a private IP before following it', async () => {
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== '/') return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } });
      return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/admin' } });
    });
    const fetcher = fetcherMock as unknown as typeof fetch;
    await expect(readSupplierCatalog('https://supplier.com/', resolvePublic, fetcher)).rejects.toThrow('dirección que no es pública');
    expect(fetcherMock.mock.calls.every(([input]) => !String(input).includes('127.0.0.1'))).toBe(true);
  });
});

