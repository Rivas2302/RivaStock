import { describe, expect, it, vi } from 'vitest';
import { createShareHandler } from '../../supabase/functions/share/handler';
import { getCatalogSharePath, getCatalogShareUrl } from './catalogShare';
import { formatPrice, getPublicAssetUrl, renderShareHtml } from '../../supabase/functions/share/metadata';

const SUPABASE_URL = 'https://nkfqhuqrgrpfufdymkcr.supabase.co';
const PROJECT_HOST = new URL(SUPABASE_URL).hostname;
const PRODUCT_ID = '12345678-1234-4abc-8def-1234567890ab';

describe('catalog share links', () => {
  it('builds product and catalog URLs on the dedicated preview route', () => {
    expect(getCatalogSharePath('rivatech-2')).toBe('/p/rivatech-2');
    expect(getCatalogSharePath('riva tech', PRODUCT_ID)).toBe(`/p/riva%20tech/${PRODUCT_ID}`);
    expect(getCatalogShareUrl('https://rivastock.vercel.app', 'rivatech-2', PRODUCT_ID))
      .toBe(`https://rivastock.vercel.app/p/rivatech-2/${PRODUCT_ID}`);
  });
});

describe('share metadata', () => {
  it('only accepts HTTPS objects in this project’s public assets bucket and resolves thumbnails', () => {
    expect(getPublicAssetUrl(
      `${SUPABASE_URL}/storage/v1/object/public/assets/owner/products/item.thumb.webp`,
      PROJECT_HOST,
    )).toBe(`${SUPABASE_URL}/storage/v1/object/public/assets/owner/products/item.webp`);
    expect(getPublicAssetUrl('http://nkfqhuqrgrpfufdymkcr.supabase.co/storage/v1/object/public/assets/item.webp', PROJECT_HOST)).toBeNull();
    expect(getPublicAssetUrl('https://images.example.test/item.jpg', PROJECT_HOST)).toBeNull();
    expect(getPublicAssetUrl('data:image/webp;base64,UklGRg==', PROJECT_HOST)).toBeNull();
    expect(getPublicAssetUrl(`${SUPABASE_URL}:8443/storage/v1/object/public/assets/item.webp`, PROJECT_HOST)).toBeNull();
  });

  it('escapes metadata, emits Open Graph and Twitter tags, and redirects browsers to the catalog', () => {
    const html = renderShareHtml({
      canonicalUrl: `https://rivastock.vercel.app/p/rivatech-2/${PRODUCT_ID}`,
      catalogUrl: `https://rivastock.vercel.app/catalogo/rivatech-2/${PRODUCT_ID}`,
      title: '<Cable> & Cía',
      description: 'RivaTech · $ 1.234',
      imageUrl: `${SUPABASE_URL}/storage/v1/object/public/assets/item.webp`,
      imageContentType: 'image/jpeg',
      imageAlt: 'Cable & Cía',
      allowedImageHost: PROJECT_HOST,
    });

    expect(html).toContain('property="og:title" content="&lt;Cable&gt; &amp; Cía"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:image:type" content="image/jpeg"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(`http-equiv="refresh" content="0;url=https://rivastock.vercel.app/catalogo/rivatech-2/${PRODUCT_ID}"`);
    expect(html).not.toContain('<Cable>');
  });

  it('formats public prices without leaking invalid numeric values', () => {
    expect(formatPrice(1234, '$')).toBe('$ 1.234');
    expect(formatPrice(null, '$')).toBeNull();
    expect(formatPrice(Number.NaN, '$')).toBeNull();
  });
});

describe('public catalog share handler', () => {
  const forwardedHost = { 'x-forwarded-host': 'rivastock.vercel.app' };
  const configRow = {
    slug: 'rivatech-2', business_name: 'RivaTech', show_prices: true,
    tagline: 'Tecnología para todos', welcome_message: 'Encontrá lo que buscás.', logo_url: null, banner_url: null,
    user_id: '11111111-1111-4111-8111-111111111111', enabled: true,
  };
  const product = {
    id: PRODUCT_ID,
    name: 'Cable & cargador',
    salePrice: 1234,
    description: 'Carga rápida',
    imageUrl: `${SUPABASE_URL}/storage/v1/object/public/assets/item.webp`,
    images: [],
  };

  function makeFetch(options: { configRows?: unknown; product?: unknown; canonicalSlug?: unknown; status?: number } = {}) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith('/catalog_config')) {
        return Response.json(options.configRows ?? [configRow], { status: options.status ?? 200 });
      }
      if (url.pathname.endsWith('/rpc/get_public_catalog_product')) {
        return Response.json(options.product === undefined ? product : options.product, { status: options.status ?? 200 });
      }
      if (url.pathname.endsWith('/rpc/resolve_public_catalog_slug')) {
        return Response.json(options.canonicalSlug ?? null, { status: options.status ?? 200 });
      }
      if (url.pathname.endsWith('/public_profiles')) {
        return Response.json([{ currency_symbol: '$' }]);
      }
      if (url.pathname.includes('/storage/v1/object/public/assets/')) {
        return new Response(null, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      }
      throw new Error(`Unexpected URL: ${url.pathname}`);
    }) as typeof fetch;
  }

  it('renders a product preview for Vercel proxy requests and follows the catalog route', async () => {
    const fetcher = makeFetch();
    const handler = createShareHandler({ supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher });
    const response = await handler(new Request(`https://project.supabase.co/functions/v1/share?slug=rivatech-2&productId=${PRODUCT_ID}`, { headers: forwardedHost }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    expect(html).toContain('Cable &amp; cargador · RivaTech');
    expect(html).toContain('RivaTech · $ 1.234 · Carga rápida');
    expect(html).toContain(`og:url" content="https://rivastock.vercel.app/p/rivatech-2/${PRODUCT_ID}`);
    expect(html).toContain(`og:image" content="${SUPABASE_URL}/storage/v1/object/public/assets/item.webp`);
    expect(html).toContain(`url=https://rivastock.vercel.app/catalogo/rivatech-2/${PRODUCT_ID}`);
  });

  it('renders a catalog-level preview without requesting product data', async () => {
    const fetcher = makeFetch();
    const handler = createShareHandler({ supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher });
    const response = await handler(new Request('https://project.supabase.co/functions/v1/share?slug=rivatech-2', { headers: forwardedHost }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Catálogo de RivaTech');
    expect(html).toContain('Tecnología para todos');
    expect(html).toContain('url=https://rivastock.vercel.app/catalogo/rivatech-2');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('redirects a historical catalog slug to the canonical link and preserves a product id', async () => {
    const fetcher = makeFetch({ configRows: [], canonicalSlug: 'bazar-lucia' });
    const handler = createShareHandler({ supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher });
    const response = await handler(new Request(`https://project.supabase.co/functions/v1/share?slug=bazar-viejo&productId=${PRODUCT_ID}`, { headers: forwardedHost }));

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`https://rivastock.vercel.app/p/bazar-lucia/${PRODUCT_ID}`);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses the legacy catalog route for catalog-preview requests', async () => {
    const fetcher = makeFetch({ configRows: [], canonicalSlug: 'bazar-lucia' });
    const handler = createShareHandler({ supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher });
    const response = await handler(new Request(`https://project.supabase.co/functions/v1/share?slug=bazar-viejo&productId=${PRODUCT_ID}&canonical=catalogo`, { headers: forwardedHost }));

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`https://rivastock.vercel.app/catalogo/bazar-lucia/${PRODUCT_ID}`);
  });

  it('uses the neutral welcome message and catalog image when no configured tagline or logo exists', async () => {
    const fetcher = makeFetch({ configRows: [{ ...configRow, tagline: null, welcome_message: 'Encontrá lo que buscás.', banner_url: `${SUPABASE_URL}/storage/v1/object/public/assets/banner.webp` }] });
    const handler = createShareHandler({ supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher });
    const response = await handler(new Request('https://project.supabase.co/functions/v1/share?slug=rivatech-2&canonical=catalogo', { headers: forwardedHost }));
    const html = await response.text();

    expect(html).toContain('og:description" content="Encontrá lo que buscás."');
    expect(html).toContain(`og:image" content="${SUPABASE_URL}/storage/v1/object/public/assets/banner.webp`);
    expect(html).toContain('og:url" content="https://rivastock.vercel.app/catalogo/rivatech-2"');
  });

  it('uses the configured production host when an upstream replaces the forwarded host', async () => {
    const handler = createShareHandler({ supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher: makeFetch() });
    const response = await handler(new Request('https://project.supabase.co/functions/v1/share?siteHost=rivastock.vercel.app&slug=rivatech-2', {
      headers: { 'x-forwarded-host': 'nkfqhuqrgrpfufdymkcr.supabase.co' },
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('og:url" content="https://rivastock.vercel.app/p/rivatech-2"');
  });

  it('returns no catalog or product metadata for hidden products and missing businesses', async () => {
    const hiddenHandler = createShareHandler({
      supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher: makeFetch({ product: null }),
    });
    const hiddenResponse = await hiddenHandler(new Request(`https://project.supabase.co/functions/v1/share?slug=rivatech-2&productId=${PRODUCT_ID}`, { headers: forwardedHost }));
    expect(hiddenResponse.status).toBe(404);
    expect(await hiddenResponse.text()).not.toContain('Cable');

    const missingHandler = createShareHandler({
      supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher: makeFetch({ configRows: [] }),
    });
    const missingResponse = await missingHandler(new Request('https://project.supabase.co/functions/v1/share?slug=missing-business', { headers: forwardedHost }));
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.text()).not.toContain('RivaTech');
  });

  it('rejects malformed identifiers and unknown hosts before querying Supabase', async () => {
    const fetcher = makeFetch();
    const handler = createShareHandler({ supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher });
    const invalidId = await handler(new Request('https://project.supabase.co/functions/v1/share?slug=rivatech-2&productId=bad', { headers: forwardedHost }));
    const unknownHost = await handler(new Request('https://project.supabase.co/functions/v1/share?slug=rivatech-2', { headers: { 'x-forwarded-host': 'attacker.example' } }));

    expect(invalidId.status).toBe(404);
    expect(unknownHost.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns a retryable response when Supabase is unavailable', async () => {
    const handler = createShareHandler({
      supabaseUrl: SUPABASE_URL,
      publishableKey: 'sb_publishable_test',
      fetcher: makeFetch({ status: 500 }),
    });
    const response = await handler(new Request('https://project.supabase.co/functions/v1/share?slug=rivatech-2', { headers: forwardedHost }));
    expect(response.status).toBe(503);
  });
});
