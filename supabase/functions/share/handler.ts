import {
  formatPrice,
  DEFAULT_SHARE_IMAGE_URL,
  getCatalogShareImageEndpoint,
  getPublicAssetUrl,
  getPublicShareImageUrl,
  isValidCatalogSlug,
  isValidProductId,
  readEmbeddedShareImage,
  renderShareHtml,
  readImageDimensions,
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

type ShareImageCandidate = {
  url: string;
  embedded?: ReturnType<typeof readEmbeddedShareImage>;
};

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

function redirectToCanonical(origin: string, slug: string, productId: string, route: 'p' | 'catalogo'): Response {
  const path = `/${route}/${encodeURIComponent(slug)}${productId ? `/${encodeURIComponent(productId)}` : ''}`;
  return new Response(null, {
    status: 308,
    headers: { ...CACHE_HEADERS, 'Cache-Control': 'public, max-age=0, s-maxage=300', Location: `${origin}${path}` },
  });
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

function catalogImageCandidates(config: PublicConfigRow, projectHost: string, supabaseUrl: string, slug: string, siteHost: string): ShareImageCandidate[] {
  const presentation = config.presentation && typeof config.presentation === 'object'
    ? config.presentation as { heroImageUrl?: unknown }
    : {};
  const candidates = [presentation.heroImageUrl, config.banner_url, config.logo_url];
  const result: ShareImageCandidate[] = [];
  const seen = new Set<string>();
  for (const value of candidates) {
    const assetUrl = getPublicAssetUrl(value, projectHost);
    if (assetUrl && !seen.has(assetUrl)) {
      seen.add(assetUrl);
      result.push({ url: assetUrl });
      continue;
    }
    const embedded = readEmbeddedShareImage(value);
    if (embedded && typeof value === 'string' && !seen.has(value)) {
      seen.add(value);
      result.push({ url: getCatalogShareImageEndpoint(supabaseUrl, slug, siteHost), embedded });
    }
  }
  if (result.length === 0) result.push({ url: DEFAULT_SHARE_IMAGE_URL });
  return result;
}

function imageResponse(image: NonNullable<ReturnType<typeof readEmbeddedShareImage>>, method: string): Response {
  return new Response(method === 'HEAD' ? null : image.bytes, {
    status: 200,
    headers: {
      ...CACHE_HEADERS,
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.byteLength),
      'Content-Disposition': 'inline',
    },
  });
}

async function readJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function readImagePrefix(response: Response, maxBytes = 512 * 1024): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - total;
      const chunk = value.subarray(0, remaining);
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
    const imageMode = requestUrl.searchParams.get('image') ?? '';
    if (!isValidCatalogSlug(slug) || (productId && !isValidProductId(productId))
      || (imageMode && imageMode !== 'catalog') || (imageMode && productId)) return notFound(request.method);

    const headers = { apikey: options.publishableKey };
    const configUrl = new URL(`${supabaseUrl}/rest/v1/catalog_config`);
    configUrl.searchParams.set('select', 'slug,business_name,show_prices,tagline,welcome_message,logo_url,banner_url,presentation,enabled');
    configUrl.searchParams.set('slug', `eq.${slug}`);
    configUrl.searchParams.set('enabled', 'eq.true');
    configUrl.searchParams.set('limit', '1');

    try {
      const configResponse = await fetcher(configUrl, { headers, signal: request.signal });
      if (!configResponse.ok) return htmlResponse(503, '<!doctype html><title>Vista previa no disponible</title>', request.method);
      const configRows = await readJson<PublicConfigRow[]>(configResponse);
      const config = Array.isArray(configRows) ? configRows[0] : null;
      if (!config?.enabled) {
        const resolveUrl = `${supabaseUrl}/rest/v1/rpc/resolve_public_catalog_slug`;
        const resolveResponse = await fetcher(resolveUrl, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_slug: slug }),
          signal: request.signal,
        });
        if (!resolveResponse.ok) return htmlResponse(503, '<!doctype html><title>Vista previa no disponible</title>', request.method);
        const canonicalSlug = await readJson<string>(resolveResponse);
        if (!canonicalSlug) return notFound(request.method);
        if (canonicalSlug !== slug) {
          const canonicalRoute = requestUrl.searchParams.get('canonical') === 'catalogo' ? 'catalogo' : 'p';
          return redirectToCanonical(origin, canonicalSlug, productId, canonicalRoute);
        }
        return notFound(request.method);
      }

      const catalogImages = catalogImageCandidates(config, projectHost, supabaseUrl, slug, new URL(origin).host);
      if (imageMode === 'catalog') {
        const embeddedImage = catalogImages.find(candidate => candidate.embedded)?.embedded;
        return embeddedImage ? imageResponse(embeddedImage, request.method) : notFound(request.method);
      }

      let title = `Catálogo de ${config.business_name || 'RivaStock'}`;
      let description = config.tagline?.trim() || config.welcome_message?.trim() || `Mirá los productos de ${config.business_name || 'este negocio'}.`;
      let imageCandidates = catalogImages;
      let imageContentType: string | null = null;
      let imageWidth: number | null = null;
      let imageHeight: number | null = null;
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
        const productImage = selectProductImage(product, projectHost);
        imageCandidates = productImage ? [{ url: productImage }, ...catalogImages] : catalogImages;
        imageAlt = product.name;
        catalogPath += `/${encodeURIComponent(productId)}`;
      }

      let allowedImageUrl: string | null = null;
      for (const candidate of imageCandidates) {
        const embedded = candidate.embedded;
        if (embedded) {
          allowedImageUrl = candidate.url;
          imageContentType = embedded.contentType;
          imageWidth = embedded.width;
          imageHeight = embedded.height;
          break;
        }
        const safeCandidate = getPublicShareImageUrl(candidate.url, projectHost);
        if (!safeCandidate) continue;
        try {
          const imageResponse = await fetcher(safeCandidate, {
            headers: { Range: 'bytes=0-524287' },
            signal: request.signal,
          });
          const contentType = imageResponse.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
          if (!imageResponse.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) continue;
          const dimensions = readImageDimensions(await readImagePrefix(imageResponse));
          if (!dimensions) continue;
          allowedImageUrl = safeCandidate;
          imageContentType = contentType;
          imageWidth = dimensions.width;
          imageHeight = dimensions.height;
          break;
        } catch {
          continue;
        }
      }

      const canonicalRoute = requestUrl.searchParams.get('canonical') === 'catalogo' ? 'catalogo' : 'p';
      const canonicalUrl = `${origin}/${canonicalRoute}/${encodeURIComponent(slug)}${productId ? `/${encodeURIComponent(productId)}` : ''}`;
      const html = renderShareHtml({
        canonicalUrl,
        catalogUrl: `${origin}${catalogPath}`,
        title,
        description,
        imageUrl: allowedImageUrl,
        imageContentType,
        imageWidth,
        imageHeight,
        imageAlt,
        allowedImageHost: projectHost,
      });
      return htmlResponse(200, html, request.method);
    } catch {
      return htmlResponse(503, '<!doctype html><title>Vista previa no disponible</title>', request.method);
    }
  };
}
