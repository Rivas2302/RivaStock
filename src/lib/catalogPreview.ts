export interface PublicCatalogConfigPreview {
  business_name?: string | null;
  tagline?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  show_prices?: boolean | null;
}

export interface PublicCatalogProductPreview {
  id?: string;
  name?: string;
  description?: string | null;
  salePrice?: number | string | null;
  imageUrl?: string | null;
  images?: string[] | null;
}

export interface CatalogPreviewMetadata {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
}

interface CatalogPreviewOptions {
  slug: string;
  productId?: string;
  origin: string;
  supabaseUrl: string;
  publishableKey: string;
  indexHtml: string;
  fetcher?: typeof fetch;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaTag(attribute: 'name' | 'property', name: string, value: string): string {
  return '<meta ' + attribute + '="' + name + '" content="' + escapeHtml(value) + '" />';
}

export function buildCatalogPreviewHtml(indexHtml: string, metadata: CatalogPreviewMetadata): string {
  const headEnd = indexHtml.toLowerCase().indexOf('</head>');
  if (headEnd < 0) throw new Error('The application HTML has no closing head tag');

  const htmlWithoutExistingSocialTags = indexHtml.replace(
    /<meta\b(?=[^>]*(?:property|name)\s*=\s*["'](?:og:|twitter:)[^"']+["'])[^>]*>\s*/gi,
    '',
  );
  const updatedHeadEnd = htmlWithoutExistingSocialTags.toLowerCase().indexOf('</head>');
  const tags = [
    metaTag('property', 'og:type', 'website'),
    metaTag('property', 'og:title', metadata.title),
    metaTag('property', 'og:description', metadata.description),
    metaTag('property', 'og:url', metadata.url),
    metaTag('property', 'og:image', metadata.image),
    metaTag('property', 'og:image:secure_url', metadata.image),
    metaTag('property', 'og:image:type', 'image/jpeg'),
    metaTag('property', 'og:image:width', '1200'),
    metaTag('property', 'og:image:height', '630'),
    metaTag('property', 'og:image:alt', metadata.imageAlt),
    metaTag('name', 'twitter:card', 'summary_large_image'),
    metaTag('name', 'twitter:title', metadata.title),
    metaTag('name', 'twitter:description', metadata.description),
    metaTag('name', 'twitter:image', metadata.image),
  ].join('\n    ');

  return htmlWithoutExistingSocialTags.slice(0, updatedHeadEnd)
    + '    '
    + tags
    + '\n  '
    + htmlWithoutExistingSocialTags.slice(updatedHeadEnd);
}

export function isPublicCatalogAssetUrl(value: string, supabaseUrl: string): boolean {
  if (!value || value.length > 2048) return false;
  try {
    const source = new URL(value);
    const project = new URL(supabaseUrl);
    return source.protocol === 'https:'
      && source.origin === project.origin
      && source.username === ''
      && source.password === ''
      && source.pathname.startsWith('/storage/v1/object/public/assets/')
      && source.pathname.length > '/storage/v1/object/public/assets/'.length;
  } catch {
    return false;
  }
}

function getFirstValidImage(values: Array<string | null | undefined>, supabaseUrl: string): string | null {
  return values.find((value): value is string => typeof value === 'string'
    && isPublicCatalogAssetUrl(value, supabaseUrl)) ?? null;
}

function buildImageUrl(origin: string, sourceUrl: string | null): string {
  if (!sourceUrl) return new URL('/catalog-preview-default.jpg', origin).toString();
  const previewUrl = new URL('/api/catalog-preview-image', origin);
  previewUrl.searchParams.set('source', sourceUrl);
  return previewUrl.toString();
}

function buildProductDescription(product: PublicCatalogProductPreview, config: PublicCatalogConfigPreview): string {
  const parts = [cleanText(product.description)];
  if (config.show_prices !== false && Number.isFinite(Number(product.salePrice))) {
    parts.push(new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 0,
    }).format(Number(product.salePrice)));
  }
  parts.push(cleanText(config.business_name));
  return parts.filter(Boolean).join(' · ').slice(0, 240);
}

function jsonHeaders(publishableKey: string): HeadersInit {
  return { apikey: publishableKey, accept: 'application/json' };
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, s-maxage=60' },
  });
}

export async function createCatalogPreviewResponse(options: CatalogPreviewOptions): Promise<Response> {
  const { slug, productId, origin, supabaseUrl, publishableKey, indexHtml } = options;
  const fetcher = options.fetcher ?? fetch;
  if (!slug || slug.length > 200 || !indexHtml.toLowerCase().includes('</head>')) return notFound();
  if (productId && !UUID_PATTERN.test(productId)) return notFound();

  const configUrl = new URL('/rest/v1/catalog_config', supabaseUrl);
  configUrl.searchParams.set('select', 'business_name,tagline,logo_url,banner_url,show_prices');
  configUrl.searchParams.set('slug', 'eq.' + slug);
  configUrl.searchParams.set('enabled', 'eq.true');
  configUrl.searchParams.set('limit', '1');

  let configResponse: Response;
  try {
    configResponse = await fetcher(configUrl, { headers: jsonHeaders(publishableKey) });
  } catch {
    return new Response('Catalog unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  if (!configResponse.ok) {
    return new Response('Catalog unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  const configs = await configResponse.json() as PublicCatalogConfigPreview[];
  const config = configs[0];
  if (!config) return notFound();

  let product: PublicCatalogProductPreview | null = null;
  if (productId) {
    const productUrl = new URL('/rest/v1/rpc/get_public_catalog_product', supabaseUrl);
    let productResponse: Response;
    try {
      productResponse = await fetcher(productUrl, {
        method: 'POST',
        headers: { ...jsonHeaders(publishableKey), 'content-type': 'application/json' },
        body: JSON.stringify({ p_slug: slug, p_product_id: productId }),
      });
    } catch {
      return new Response('Catalog unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
    }
    if (!productResponse.ok) {
      return new Response('Catalog unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
    }
    product = await productResponse.json() as PublicCatalogProductPreview | null;
    if (!product) return notFound();
  }

  const businessName = cleanText(config.business_name) || 'RivaStock';
  const title = product
    ? cleanText(product.name) + ' — ' + businessName
    : businessName + ' — Catálogo';
  const description = product
    ? buildProductDescription(product, config)
    : cleanText(config.tagline) || 'Catálogo público de ' + businessName;
  const url = new URL('/catalogo/' + encodeURIComponent(slug)
    + (productId ? '/' + encodeURIComponent(productId) : ''), origin).toString();
  const productImage = product
    ? getFirstValidImage([...(product.images ?? []), product.imageUrl], supabaseUrl)
    : null;
  const catalogImage = getFirstValidImage([config.banner_url, config.logo_url], supabaseUrl);
  const metadata: CatalogPreviewMetadata = {
    title,
    description,
    url,
    image: buildImageUrl(origin, productImage ?? catalogImage),
    imageAlt: product ? cleanText(product.name) : businessName,
  };

  let html: string;
  try {
    html = buildCatalogPreviewHtml(indexHtml, metadata);
  } catch {
    return new Response('Application unavailable', { status: 500, headers: { 'cache-control': 'no-store' } });
  }
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
    },
  });
}
