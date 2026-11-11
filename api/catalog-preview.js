const SHARE_FUNCTION_URL = 'https://nkfqhuqrgrpfufdymkcr.supabase.co/functions/v1/share';
const PRODUCT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAllowedHost(host) {
  return host === 'rivastock.vercel.app' || /^rivastock-[a-z0-9-]+\.vercel\.app$/i.test(host);
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value?.split(',')[0]?.trim();
}

export function createCatalogPreviewHandler(fetcher = fetch) {
  return async function catalogPreviewHandler(request, response) {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      response.status(405).end('Method not allowed');
      return;
    }

    const userAgent = firstHeader(request.headers['user-agent']) ?? '';
    if (!/(whatsapp|facebookexternalhit|meta-externalagent|instagram|twitterbot|linkedinbot)/i.test(userAgent)) {
      response.status(404).end('Not found');
      return;
    }

    const slug = typeof request.query?.slug === 'string' ? request.query.slug.trim() : '';
    const productId = typeof request.query?.productId === 'string' ? request.query.productId.trim() : '';
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug) || (productId && !PRODUCT_ID_PATTERN.test(productId))) {
      response.status(404).end('Not found');
      return;
    }

    const host = (firstHeader(request.headers['x-forwarded-host']) || firstHeader(request.headers.host) || '').toLowerCase();
    if (!isAllowedHost(host)) {
      response.status(400).end('Invalid host');
      return;
    }

    const upstreamUrl = new URL(SHARE_FUNCTION_URL);
    upstreamUrl.searchParams.set('slug', slug);
    upstreamUrl.searchParams.set('siteHost', host);
    const canonical = typeof request.query?.canonical === 'string' && request.query.canonical === 'ofertas'
      ? 'ofertas'
      : 'catalogo';
    upstreamUrl.searchParams.set('canonical', canonical);
    if (productId) upstreamUrl.searchParams.set('productId', productId);

    try {
      const upstream = await fetcher(upstreamUrl, {
        method,
        headers: { 'user-agent': userAgent },
        redirect: 'manual',
      });
      response.status(upstream.status);
      for (const name of [
        'content-type', 'cache-control', 'vercel-cdn-cache-control',
        'x-content-type-options', 'referrer-policy', 'content-security-policy', 'location',
      ]) {
        const value = upstream.headers.get(name);
        if (value) response.setHeader(name, value);
      }
      response.end(method === 'HEAD' ? undefined : await upstream.text());
    } catch {
      response.setHeader('Cache-Control', 'no-store');
      response.status(503).end('Preview unavailable');
    }
  };
}

export default createCatalogPreviewHandler();
