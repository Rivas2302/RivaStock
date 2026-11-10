import { describe, expect, it, vi } from 'vitest';
import { createShareHandler } from '../../supabase/functions/share/handler';
import { getCatalogSharePath, getCatalogShareUrl } from './catalogShare';
import { DEFAULT_SHARE_IMAGE_URL, formatPrice, getPublicAssetUrl, getPublicShareImageUrl, readEmbeddedShareImage, readImageDimensions, renderShareHtml } from '../../supabase/functions/share/metadata';

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

  it('accepts only the same function’s scoped catalog image endpoint', () => {
    const imageUrl = `${SUPABASE_URL}/functions/v1/share?slug=rivatech-2&siteHost=rivastock.vercel.app&image=catalog`;
    expect(getPublicShareImageUrl(imageUrl, PROJECT_HOST)).toBe(imageUrl);
    expect(getPublicShareImageUrl('https://evil.example/functions/v1/share?slug=rivatech-2&siteHost=rivastock.vercel.app&image=catalog', PROJECT_HOST)).toBeNull();
    expect(getPublicShareImageUrl(`${SUPABASE_URL}/functions/v1/share?slug=rivatech-2&siteHost=evil.example&image=catalog`, PROJECT_HOST)).toBeNull();
    expect(getPublicShareImageUrl(`${SUPABASE_URL}/functions/v1/share?slug=rivatech-2&siteHost=rivastock.vercel.app&image=catalog&next=https://evil.example`, PROJECT_HOST)).toBeNull();
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

  it('reads dimensions from PNG, JPEG, WebP, and GIF headers', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    new DataView(png.buffer).setUint32(16, 1200);
    new DataView(png.buffer).setUint32(20, 630);
    expect(readImageDimensions(png)).toEqual({ width: 1200, height: 630 });

    expect(readImageDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9])))
      .toEqual({ width: 600, height: 300 });
    expect(readImageDimensions(Uint8Array.from([0x52,0x49,0x46,0x46,0x16,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x58,10,0,0,0,0,0,0,0,0xaf,0,0,0x3f,0,0,0])))
      .toEqual({ width: 176, height: 64 });
    expect(readImageDimensions(Uint8Array.from([0x47,0x49,0x46,0x38,0x39,0x61,0x80,0x02,0x58,0x01])))
      .toEqual({ width: 640, height: 344 });
    expect(readImageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('decodes only small base64 images whose declared MIME matches their bytes', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
    const dataUrl = `data:image/jpeg;base64,${btoa(String.fromCharCode(...jpeg))}`;
    expect(readEmbeddedShareImage(dataUrl)).toMatchObject({ contentType: 'image/jpeg', width: 600, height: 300 });
    expect(readEmbeddedShareImage(dataUrl.replace('image/jpeg', 'image/png'))).toBeNull();
    expect(readEmbeddedShareImage('data:image/jpeg;base64,AAAA')).toBeNull();
  });
});

describe('public catalog share handler', () => {
  const forwardedHost = { 'x-forwarded-host': 'rivastock.vercel.app' };
  const configRow = {
    slug: 'rivatech-2', business_name: 'RivaTech', show_prices: true,
    tagline: 'Tecnología para todos', welcome_message: 'Encontrá lo que buscás.', logo_url: null, banner_url: null,
    presentation: null, user_id: '11111111-1111-4111-8111-111111111111', enabled: true,
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
      if (url.pathname.endsWith('/functions/v1/share') && url.searchParams.get('image') === 'catalog') {
        const row = (options.configRows ?? [configRow]) as Array<Record<string, unknown>>;
        const config = row[0];
        const presentation = config?.presentation && typeof config.presentation === 'object'
          ? config.presentation as { heroImageUrl?: string }
          : {};
        const imageUrl = [presentation.heroImageUrl, config?.banner_url, config?.logo_url]
          .find((candidate): candidate is string => typeof candidate === 'string' && Boolean(readEmbeddedShareImage(candidate)));
        if (!imageUrl) return new Response('not found', { status: 404 });
        const image = readEmbeddedShareImage(imageUrl);
        return image
          ? new Response(image.bytes, { status: 200, headers: { 'Content-Type': image.contentType } })
          : new Response('not found', { status: 404 });
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
      if (url.pathname === '/og-default.png') {
        const png = new Uint8Array(24);
        png.set([0x89, 0x50, 0x4e, 0x47], 0);
        new DataView(png.buffer).setUint32(16, 1200);
        new DataView(png.buffer).setUint32(20, 630);
        return new Response(png, { status: 206, headers: { 'Content-Type': 'image/png' } });
      }
      if (url.pathname.includes('/storage/v1/object/public/assets/')) {
        const png = new Uint8Array(24);
        png.set([0x89, 0x50, 0x4e, 0x47], 0);
        new DataView(png.buffer).setUint32(16, 1200);
        new DataView(png.buffer).setUint32(20, 630);
        return new Response(png, { status: 206, headers: { 'Content-Type': 'image/png' } });
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
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(fetcher).toHaveBeenCalledWith(`${SUPABASE_URL}/storage/v1/object/public/assets/item.webp`, expect.objectContaining({ headers: { Range: 'bytes=0-524287' } }));
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
    expect(html).toContain(`og:image" content="${DEFAULT_SHARE_IMAGE_URL}"`);
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
    expect(html).toContain('url=https://rivastock.vercel.app/catalogo/rivatech-2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses the cover image before the logo and falls back to the logo when no cover exists', async () => {
    const cover = `${SUPABASE_URL}/storage/v1/object/public/assets/catalog/cover.webp`;
    const logo = `${SUPABASE_URL}/storage/v1/object/public/assets/catalog/logo.webp`;
    const handler = createShareHandler({
      supabaseUrl: SUPABASE_URL,
      publishableKey: 'sb_publishable_test',
      fetcher: makeFetch({ configRows: [{ ...configRow, banner_url: cover, logo_url: logo }] }),
    });
    const coverResponse = await handler(new Request('https://project.supabase.co/functions/v1/share?slug=rivatech-2', { headers: forwardedHost }));
    expect(await coverResponse.text()).toContain(`og:image" content="${cover}`);

    const logoOnlyHandler = createShareHandler({
      supabaseUrl: SUPABASE_URL,
      publishableKey: 'sb_publishable_test',
      fetcher: makeFetch({ configRows: [{ ...configRow, banner_url: null, logo_url: logo }] }),
    });
    const logoResponse = await logoOnlyHandler(new Request('https://project.supabase.co/functions/v1/share?slug=rivatech-2', { headers: forwardedHost }));
    expect(await logoResponse.text()).toContain(`og:image" content="${logo}`);
  });

  it('serves an embedded catalog cover as a validated public image and uses it for OG metadata', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
    const dataUrl = `data:image/jpeg;base64,${btoa(String.fromCharCode(...jpeg))}`;
    const fetcher = makeFetch({ configRows: [{ ...configRow, presentation: { useBusinessCover: true, heroImageUrl: dataUrl } }] });
    const handler = createShareHandler({ supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher });
    const response = await handler(new Request('https://project.supabase.co/functions/v1/share?slug=rivatech-2', { headers: forwardedHost }));
    const html = await response.text();
    const imageUrl = `${SUPABASE_URL}/functions/v1/share?slug=rivatech-2&siteHost=rivastock.vercel.app&image=catalog`;

    expect(response.status).toBe(200);
    expect(html).toContain(`og:image" content="${imageUrl.replaceAll('&', '&amp;')}`);
    expect(html).toContain('property="og:image:type" content="image/jpeg"');
    expect(html).toContain('property="og:image:width" content="600"');
    expect(html).toContain('property="og:image:height" content="300"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');

    const imageResponse = await handler(new Request(imageUrl));
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await imageResponse.arrayBuffer())).toEqual(jpeg);
  });

  it('falls back to an embedded logo when the catalog has no cover', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
    const logoDataUrl = `data:image/jpeg;base64,${btoa(String.fromCharCode(...jpeg))}`;
    const handler = createShareHandler({
      supabaseUrl: SUPABASE_URL,
      publishableKey: 'sb_publishable_test',
      fetcher: makeFetch({ configRows: [{ ...configRow, logo_url: logoDataUrl }] }),
    });
    const response = await handler(new Request('https://project.supabase.co/functions/v1/share?slug=rivatech-2', { headers: forwardedHost }));

    expect(await response.text()).toContain(`og:image" content="${SUPABASE_URL}/functions/v1/share?slug=rivatech-2&amp;siteHost=rivastock.vercel.app&amp;image=catalog`);
  });

  it.each([
    ['anon', undefined],
    ['authenticated caller', 'Bearer authenticated-fixture-token'],
  ])('renders read-only public metadata for a %s request', async (_role, authorization) => {
    const handler = createShareHandler({ supabaseUrl: SUPABASE_URL, publishableKey: 'sb_publishable_test', fetcher: makeFetch({ product: { ...product, imageUrl: null, images: [] } }) });
    const response = await handler(new Request(`https://project.supabase.co/functions/v1/share?slug=rivatech-2&productId=${PRODUCT_ID}`, {
      headers: { ...forwardedHost, ...(authorization ? { authorization } : {}) },
    }));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('property="og:image:width"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
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
