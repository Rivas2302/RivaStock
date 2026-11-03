import { describe, expect, it, vi } from 'vitest';
import {
  buildCatalogPreviewHtml,
  createCatalogPreviewResponse,
  isPublicCatalogAssetUrl,
} from './catalogPreview';

const SUPABASE_URL = 'https://project.supabase.co';
const IMAGE_URL = SUPABASE_URL + '/storage/v1/object/public/assets/owner/products/product/photo.webp';
const INDEX_HTML = '<!doctype html><html><head><title>RivaStock</title></head><body><div id="root"></div></body></html>';
const CONFIG = {
  business_name: 'Riva & Stock',
  tagline: 'Productos <premium>',
  logo_url: null,
  banner_url: null,
  show_prices: true,
};
const PRODUCT = {
  id: 'f97827de-c833-4c0d-ae67-03b3acecdd45',
  name: 'M90 "Flux"',
  description: 'Auriculares resistentes',
  salePrice: 11200,
  images: [IMAGE_URL],
};

function makeFetcher(options: {
  config?: unknown[];
  product?: unknown;
  configStatus?: number;
  productStatus?: number;
} = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith('/catalog_config')) {
      return {
        ok: (options.configStatus ?? 200) < 400,
        status: options.configStatus ?? 200,
        json: async () => options.config ?? [CONFIG],
      } as Response;
    }
    if (url.pathname.endsWith('/rpc/get_public_catalog_product')) {
      return {
        ok: (options.productStatus ?? 200) < 400,
        status: options.productStatus ?? 200,
        json: async () => options.product === undefined ? PRODUCT : options.product,
      } as Response;
    }
    throw new Error('Unexpected request ' + url.pathname);
  });
}

describe('public catalog social previews', () => {
  it('injects product data, price, a JPEG image URL, and the SPA shell', async () => {
    const fetcher = makeFetcher();
    const response = await createCatalogPreviewResponse({
      slug: 'rivatech',
      productId: PRODUCT.id,
      origin: 'https://rivastock.vercel.app',
      supabaseUrl: SUPABASE_URL,
      publishableKey: 'sb_publishable_test',
      indexHtml: INDEX_HTML,
      fetcher,
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('og:title" content="M90 &quot;Flux&quot; — Riva &amp; Stock');
    expect(html).toContain('Auriculares resistentes · $ 11.200 · Riva &amp; Stock');
    expect(html).toContain('og:image:type" content="image/jpeg"');
    expect(html).toContain('/api/catalog-preview-image?source=');
    expect(decodeURIComponent(html.match(/og:image" content="([^"]+)/)?.[1] ?? '')).toContain(IMAGE_URL);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/rpc/get_public_catalog_product');
  });

  it('injects business metadata for a catalog link without a product', async () => {
    const response = await createCatalogPreviewResponse({
      slug: 'rivatech',
      origin: 'https://rivastock.vercel.app',
      supabaseUrl: SUPABASE_URL,
      publishableKey: 'sb_publishable_test',
      indexHtml: INDEX_HTML,
      fetcher: makeFetcher({ config: [{ ...CONFIG, banner_url: IMAGE_URL }] }),
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('og:title" content="Riva &amp; Stock — Catálogo');
    expect(html).toContain('og:image:type" content="image/jpeg"');
    expect(decodeURIComponent(html.match(/og:image" content="([^"]+)/)?.[1] ?? '')).toContain(IMAGE_URL);
    expect(html).toContain('<div id="root"></div>');
  });

  it('returns no product data for products hidden by the public catalog RPC', async () => {
    const fetcher = makeFetcher({ product: null });
    const response = await createCatalogPreviewResponse({
      slug: 'rivatech',
      productId: PRODUCT.id,
      origin: 'https://rivastock.vercel.app',
      supabaseUrl: SUPABASE_URL,
      publishableKey: 'sb_publishable_test',
      indexHtml: INDEX_HTML,
      fetcher,
    });

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(PRODUCT.name);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns 404 for a nonexistent or disabled catalog', async () => {
    const response = await createCatalogPreviewResponse({
      slug: 'missing-business',
      origin: 'https://rivastock.vercel.app',
      supabaseUrl: SUPABASE_URL,
      publishableKey: 'sb_publishable_test',
      indexHtml: INDEX_HTML,
      fetcher: makeFetcher({ config: [] }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
  });

  it('replaces old social tags and safely escapes injected values', () => {
    const html = buildCatalogPreviewHtml(
      '<html><head><meta property="og:title" content="old"><meta name="twitter:card" content="old"></head><body></body></html>',
      {
        title: 'A & "B"',
        description: '<script>alert(1)</script>',
        url: 'https://rivastock.vercel.app/catalogo/a?x=1&y=2',
        image: 'https://rivastock.vercel.app/catalog-preview-default.jpg',
        imageAlt: 'A product',
      },
    );

    expect(html).not.toContain('content="old"');
    expect(html).toContain('og:title" content="A &amp; &quot;B&quot;');
    expect(html).toContain('og:description" content="&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('og:url" content="https://rivastock.vercel.app/catalogo/a?x=1&amp;y=2');
  });

  it('accepts only public assets from this project', () => {
    expect(isPublicCatalogAssetUrl(IMAGE_URL, SUPABASE_URL)).toBe(true);
    expect(isPublicCatalogAssetUrl('https://attacker.example/image.webp', SUPABASE_URL)).toBe(false);
    expect(isPublicCatalogAssetUrl('data:image/webp;base64,AAAA', SUPABASE_URL)).toBe(false);
    expect(isPublicCatalogAssetUrl(SUPABASE_URL + '/storage/v1/object/private/assets/photo.jpg', SUPABASE_URL)).toBe(false);
  });
});
