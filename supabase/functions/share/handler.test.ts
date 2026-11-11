import { describe, expect, it, vi } from 'vitest';
import { createShareHandler } from './handler.ts';

const PROJECT_URL = 'https://nkfqhuqrgrpfufdymkcr.supabase.co';
const SLUG = 'qa-super-offers';
const PRODUCT_ID = 'b8724ee3-8d5b-4ff0-a32f-d98a09c18012';
const IMAGE_URL = `${PROJECT_URL}/storage/v1/object/public/assets/qa/cover.png`;

function pngFixture(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(16, 1200);
  new DataView(bytes.buffer).setUint32(20, 630);
  return bytes;
}

function createFetcher(offerPayload: Record<string, unknown>) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rest/v1/catalog_config')) {
      return Response.json([{
        slug: SLUG,
        business_name: 'Tienda de prueba',
        show_prices: true,
        tagline: 'Ofertas por pocos días',
        welcome_message: '',
        logo_url: IMAGE_URL,
        banner_url: null,
        presentation: {},
        enabled: true,
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/rpc/get_public_super_offer')) return Response.json(offerPayload);
    if (url.toString() === IMAGE_URL) return new Response(pngFixture(), { headers: { 'content-type': 'image/png' } });
    return new Response('Not found', { status: 404 });
  });
  return fetcher;
}

function request(productId = ''): Request {
  const url = new URL(`${PROJECT_URL}/functions/v1/share`);
  url.searchParams.set('slug', SLUG);
  url.searchParams.set('canonical', 'ofertas');
  url.searchParams.set('siteHost', 'rivastock.vercel.app');
  if (productId) url.searchParams.set('productId', productId);
  return new Request(url, { headers: { 'x-forwarded-host': 'rivastock.vercel.app', 'user-agent': 'WhatsApp/2.24' } });
}

describe('super-offer share metadata', () => {
  it('uses the catalog cover and route-specific title for the offer page', async () => {
    const fetcher = createFetcher({ active: true, batch: { id: 'batch' }, products: [] });
    const response = await createShareHandler({ supabaseUrl: PROJECT_URL, publishableKey: 'sb_publishable_test', fetcher })(request());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<title>Súper ofertas · Tienda de prueba</title>');
    expect(html).toContain(`https://rivastock.vercel.app/ofertas/${SLUG}`);
    expect(html).toContain(IMAGE_URL);
    expect(html).toContain('og:image:width');
    expect(html).toContain('og:image:height');
    expect(html).toContain('summary_large_image');
  });

  it('uses only the offer product image and safe display fields on product links', async () => {
    const fetcher = createFetcher({
      active: true,
      batch: { id: 'batch' },
      products: [{
        id: PRODUCT_ID,
        name: 'Auricular QA',
        salePrice: 1200,
        imageUrl: IMAGE_URL,
        images: [],
        supplier: 'Proveedor privado',
        purchasePrice: 10,
        resellerPrice: 900,
      }],
    });
    const response = await createShareHandler({ supabaseUrl: PROJECT_URL, publishableKey: 'sb_publishable_test', fetcher })(request(PRODUCT_ID));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<title>Súper ofertas · Auricular QA · Tienda de prueba</title>');
    expect(html).toContain(`https://rivastock.vercel.app/ofertas/${SLUG}/${PRODUCT_ID}`);
    expect(html).toContain(IMAGE_URL);
    expect(html).not.toContain('Proveedor privado');
    expect(html).not.toContain('purchasePrice');
    expect(html).not.toContain('resellerPrice');
  });

  it('keeps offer link metadata free of comparison percentages when the option is off', async () => {
    const fetcher = createFetcher({
      active: true,
      batch: { id: 'batch-qa', showComparePrice: false },
      products: [{
        id: PRODUCT_ID,
        name: 'Auricular QA',
        salePrice: 1200,
        imageUrl: IMAGE_URL,
        images: [],
      }],
    });
    const response = await createShareHandler({ supabaseUrl: PROJECT_URL, publishableKey: 'sb_publishable_test', fetcher })(request(PRODUCT_ID));
    const html = await response.text();
    const title = html.match(/<meta property="og:title" content="([^"]*)">/)?.[1] ?? '';
    const description = html.match(/<meta property="og:description" content="([^"]*)">/)?.[1] ?? '';

    expect(response.status).toBe(200);
    expect(title).not.toContain('%');
    expect(description).not.toContain('%');
    expect(description).toContain('1.200');
  });

  it('redirects closed product offers to the closed offer catalog', async () => {
    const fetcher = createFetcher({ active: false, batch: null, products: [] });
    const response = await createShareHandler({ supabaseUrl: PROJECT_URL, publishableKey: 'sb_publishable_test', fetcher })(request(PRODUCT_ID));

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`https://rivastock.vercel.app/ofertas/${SLUG}`);
  });
});
