import {
  formatPrice,
  isValidCatalogSlug,
  isValidProductId,
  renderShareHtml,
  selectProductImage,
  type ShareCatalogConfig,
  type ShareProduct,
} from './metadata.ts';

type ShareHandlerOptions = {
  supabaseUrl: string;
  publishableKey: string;
  fetcher?: typeof fetch;
};

type PublicConfigRow = ShareCatalogConfig & { enabled: boolean };

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
  'Vercel-CDN-Cache-Control': 'max-age=300, stale-while-revalidate=600',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
};

function htmlResponse(status: number, body: string, method: string): Response {
  const cacheHeaders = status === 200 || status === 404
    ? CACHE_HEADERS
    : { ...CACHE_HEADERS, 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' };
  return new Response(method === 'HEAD' ? null : body, {
    status,
    headers: { ...cacheHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function notFound(method: string): Response {
  return htmlResponse(404, '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>No encontramos este catálogo</title></head><body><h1>No encontramos este catálogo</h1></body></html>', method);
}

function publicSiteOrigin(request: Request, fallbackSiteHost: string): string | null {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase();
  const isAllowedHost = (host: string) => host.length <= 180
    && !host.includes('/') && !host.includes('@')
    && (host === 'rivastock.vercel.app' || /^rivastock-[a-z0-9-]+\.vercel\.app$/.test(host));
  if (forwardedHost && isAllowedHost(forwardedHost)) return `https://${forwardedHost}`;
  const fallback = fallbackSiteHost.trim().toLowerCase();
  return isAllowedHost(fallback) ? `https://${fallback}` : null;
}

async function readJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export function createShareHandler(options: ShareHandlerOptions): (request: Request) => Promise<Response> {
  const supabaseUrl = options.supabaseUrl.replace(/\/$/, '');
  const projectHost = new URL(supabaseUrl).hostname;
  const fetcher = options.fetcher ?? fetch;

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const requestUrl = new URL(request.url);
    const origin = publicSiteOrigin(request, requestUrl.searchParams.get('siteHost') ?? '');
    if (!origin) return htmlResponse(400, '<!doctype html><title>Solicitud inválida</title>', request.method);

    const slug = requestUrl.searchParams.get('slug')?.trim() ?? '';
    const productId = requestUrl.searchParams.get('productId')?.trim() ?? '';
    if (!isValidCatalogSlug(slug) || (productId && !isValidProductId(productId))) return notFound(request.method);

    const headers = { apikey: options.publishableKey };
    const configUrl = new URL(`${supabaseUrl}/rest/v1/catalog_config`);
    configUrl.searchParams.set('select', 'slug,business_name,show_prices,tagline,logo_url,enabled');
    configUrl.searchParams.set('slug', `eq.${slug}`);
    configUrl.searchParams.set('enabled', 'eq.true');
    configUrl.searchParams.set('limit', '1');

    try {
      const configResponse = await fetcher(configUrl, { headers, signal: request.signal });
      if (!configResponse.ok) return htmlResponse(503, '<!doctype html><title>Vista previa no disponible</title>', request.method);
      const configRows = await readJson<PublicConfigRow[]>(configResponse);
      const config = Array.isArray(configRows) ? configRows[0] : null;
      if (!config?.enabled) return notFound(request.method);

      let title = `Catálogo de ${config.business_name || 'RivaStock'}`;
      let description = config.tagline?.trim() || `Mirá los productos de ${config.business_name || 'este negocio'} en RivaStock.`;
      let imageUrl = config.logo_url ?? null;
      let imageContentType: string | null = null;
      let imageAlt = `Catálogo de ${config.business_name || 'RivaStock'}`;
      let catalogPath = `/catalogo/${encodeURIComponent(slug)}`;

      if (productId) {
        const productResponse = await fetcher(`${supabaseUrl}/rest/v1/rpc/get_public_catalog_product`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_slug: slug, p_product_id: productId }),
          signal: request.signal,
        });
        if (!productResponse.ok) return htmlResponse(503, '<!doctype html><title>Vista previa no disponible</title>', request.method);
        const product = await readJson<ShareProduct | null>(productResponse);
        if (!product?.id || product.id.toLowerCase() !== productId.toLowerCase()) return notFound(request.method);

        title = `${product.name} · ${config.business_name || 'RivaStock'}`;
        const parts = [config.business_name || 'RivaStock'];
        if (config.show_prices) {
          const priceText = formatPrice(product.salePrice, '$');
          if (priceText) parts.push(priceText);
        }
        if (product.description?.trim()) parts.push(product.description.trim());
        description = parts.join(' · ');
        imageUrl = selectProductImage(product, projectHost);
        imageAlt = product.name;
        catalogPath += `/${encodeURIComponent(productId)}`;
      }

      let allowedImageUrl = imageUrl ? selectProductImage({ id: '', name: title, imageUrl }, projectHost) : null;
      if (allowedImageUrl) {
        try {
          const imageResponse = await fetcher(allowedImageUrl, { method: 'HEAD', signal: request.signal });
          const contentType = imageResponse.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
          if (imageResponse.ok && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) {
            imageContentType = contentType;
          } else {
            allowedImageUrl = null;
          }
        } catch {
          imageContentType = null;
          allowedImageUrl = null;
        }
      }

      const canonicalUrl = `${origin}/p/${encodeURIComponent(slug)}${productId ? `/${encodeURIComponent(productId)}` : ''}`;
      const html = renderShareHtml({
        canonicalUrl,
        catalogUrl: `${origin}${catalogPath}`,
        title,
        description,
        imageUrl: allowedImageUrl,
        imageContentType,
        imageAlt,
        allowedImageHost: projectHost,
      });
      return htmlResponse(200, html, request.method);
    } catch {
      return htmlResponse(503, '<!doctype html><title>Vista previa no disponible</title>', request.method);
    }
  };
}
