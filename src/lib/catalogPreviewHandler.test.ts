import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleCatalogPreviewRequest } from '../../api/catalog-preview';
import { handleCatalogPreviewImageRequest } from '../../api/catalog-preview-image';

const SUPABASE_URL = 'https://nkfqhuqrgrpfufdymkcr.supabase.co';
const PRODUCT_ID = 'f97827de-c833-4c0d-ae67-03b3acecdd45';
const SOURCE_URL = SUPABASE_URL + '/storage/v1/object/public/assets/owner/products/product/photo.webp';
const INDEX_HTML = '<!doctype html><html><head><title>RivaStock</title></head><body><div id="root"></div></body></html>';
const CONFIG = { business_name: 'RivaTech', show_prices: true };
const PRODUCT = { id: PRODUCT_ID, name: 'Product', salePrice: 1200, images: [SOURCE_URL] };

afterEach(() => vi.unstubAllGlobals());

describe('Vercel catalog preview request handlers', () => {
  it('serves catalog metadata through the standard Request and Response handler', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return {
        ok: true,
        status: 200,
        json: async () => url.pathname.endsWith('/catalog_config') ? [CONFIG] : PRODUCT,
      } as Response;
    });
    vi.stubGlobal('fetch', fetcher);

    const response = await handleCatalogPreviewRequest(
      new Request('https://rivastock.vercel.app/api/catalog-preview?slug=rivatech&productId=' + PRODUCT_ID),
      INDEX_HTML,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('og:title');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('converts a public WebP asset into a cached JPEG response', async () => {
    const webp = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#6366f1' },
    }).webp().toBuffer();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(webp, {
      headers: { 'content-type': 'image/webp', 'content-length': String(webp.byteLength) },
    })));

    const source = encodeURIComponent(SOURCE_URL);
    const response = await handleCatalogPreviewImageRequest(
      new Request('https://rivastock.vercel.app/api/catalog-preview-image?source=' + source),
    );
    const output = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(output).metadata();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toContain('s-maxage=86400');
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
  });

  it('rejects an image source outside the public assets bucket', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await handleCatalogPreviewImageRequest(
      new Request('https://rivastock.vercel.app/api/catalog-preview-image?source='
        + encodeURIComponent('https://attacker.example/image.jpg')),
    );

    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
