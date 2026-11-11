import { fetchSupplierCatalogImage, readLimitedSupplierImage } from './supplierCatalog.ts';
import { isAllowedSupplierImageUrl } from './supplierSiteDomain.ts';

const publicDns = async () => ['8.8.8.8'];

Deno.test('supplier image proxy rejects redirects to another host before fetching it', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    return new Response(null, { status: 302, headers: { location: 'https://other.com/image.webp' } });
  };

  let rejected = false;
  try {
    await fetchSupplierCatalogImage('https://supplier.com/image.jpg', publicDns, fetcher);
  } catch {
    rejected = true;
  }

  if (!rejected || requests !== 1) throw new Error('The proxy must stop before following a cross-origin image redirect.');
});

Deno.test('supplier image proxy allows a redirect that stays on the source host', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async input => {
    requests++;
    if (requests === 1) return new Response(null, { status: 302, headers: { location: '/images/final.webp' } });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp' } });
  };

  const result = await fetchSupplierCatalogImage('https://supplier.com/image.jpg', publicDns, fetcher);
  const bytes = await readLimitedSupplierImage(result.response, 3);
  if (requests !== 2 || result.url.href !== 'https://supplier.com/images/final.webp' || bytes.length !== 3) {
    throw new Error('Same-origin redirects should return the final image without exceeding its byte limit.');
  }
});

Deno.test('supplier image proxy allows an image subdomain redirect within the supplier site', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async input => {
    requests++;
    if (requests === 1) return new Response(null, { status: 302, headers: { location: 'https://api.supplier.com/images/final.webp' } });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp' } });
  };

  const result = await fetchSupplierCatalogImage('https://supplier.com/image.jpg', publicDns, fetcher, 'https://supplier.com');
  const bytes = await readLimitedSupplierImage(result.response, 3);
  if (requests !== 2 || result.url.href !== 'https://api.supplier.com/images/final.webp' || bytes.length !== 3) {
    throw new Error('Image redirects should be allowed across HTTPS subdomains of the same supplier domain.');
  }
});

Deno.test('supplier image proxy permits only allowlisted public image CDN redirects and requests WebP', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    requests++;
    if (requests === 1) {
      if (!String(new Headers(init?.headers).get('accept')).includes('image/webp')) throw new Error('Missing WebP Accept header.');
      return new Response(null, { status: 302, headers: { location: 'https://res.cloudinary.com/demo/photo.webp?auto=format' } });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp' } });
  };

  const result = await fetchSupplierCatalogImage('https://supplier.com/photo.webp', publicDns, fetcher, 'https://supplier.com');
  if (requests !== 2 || result.url.hostname !== 'res.cloudinary.com' || !isAllowedSupplierImageUrl('https://supplier.com', result.url.href)) {
    throw new Error('Known image CDNs should be allowed while unrelated hosts remain blocked.');
  }
  let rejected = false;
  try { await fetchSupplierCatalogImage('https://supplier.com/photo.webp', publicDns, async () => new Response(null, { status: 302, headers: { location: 'https://cloudinary.com.evil.test/photo.webp' } }), 'https://supplier.com'); }
  catch { rejected = true; }
  if (!rejected) throw new Error('A lookalike CDN hostname must be rejected.');
});

Deno.test('supplier image body reader cancels when a streamed image exceeds the byte ceiling', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  }));

  let rejected = false;
  try {
    await readLimitedSupplierImage(response, 3);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('The image reader must reject streamed bodies above the configured ceiling.');
});
