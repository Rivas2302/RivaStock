export interface ShareCatalogConfig {
  slug: string;
  business_name: string;
  show_prices: boolean;
  tagline?: string | null;
  welcome_message?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  user_id?: string;
  currency_symbol?: string | null;
}

export interface ShareProduct {
  id: string;
  name: string;
  salePrice?: number | string | null;
  description?: string | null;
  imageUrl?: string | null;
  images?: unknown[] | null;
}

export function isValidCatalogSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/i.test(value);
}

export function isValidProductId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function getPublicAssetUrl(value: unknown, projectHost: string): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const image = new URL(value);
    if (image.protocol !== 'https:' || image.hostname !== projectHost
      || image.port !== '' || image.username !== '' || image.password !== ''
      || !image.pathname.startsWith('/storage/v1/object/public/assets/')) return null;

    image.pathname = image.pathname.replace(/\.thumb\.webp$/i, '.webp');
    image.search = '';
    image.hash = '';
    return image.toString();
  } catch {
    return null;
  }
}

export function selectProductImage(product: ShareProduct, projectHost: string): string | null {
  for (const candidate of [product.imageUrl, ...(Array.isArray(product.images) ? product.images : [])]) {
    const image = getPublicAssetUrl(candidate, projectHost);
    if (image) return image;
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
}

export interface ShareHtmlInput {
  canonicalUrl: string;
  catalogUrl: string;
  title: string;
  description: string;
  imageUrl?: string | null;
  imageContentType?: string | null;
  imageAlt?: string | null;
  allowedImageHost: string;
}

export function renderShareHtml(input: ShareHtmlInput): string {
  const title = escapeHtml(truncate(input.title, 120));
  const description = escapeHtml(truncate(input.description, 240));
  const canonicalUrl = escapeHtml(input.canonicalUrl);
  const catalogUrl = escapeHtml(input.catalogUrl);
  const safeImage = input.imageUrl ? getPublicAssetUrl(input.imageUrl, input.allowedImageHost) : null;
  const imageTags = safeImage
    ? [
      `<meta property="og:image" content="${escapeHtml(safeImage)}">`,
      `<meta property="og:image:secure_url" content="${escapeHtml(safeImage)}">`,
      ...(input.imageContentType && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(input.imageContentType)
        ? [`<meta property="og:image:type" content="${escapeHtml(input.imageContentType)}">`]
        : []),
      `<meta property="og:image:alt" content="${escapeHtml(truncate(input.imageAlt || input.title, 120))}">`,
      '<meta name="twitter:card" content="summary_large_image">',
    ].join('\n    ')
    : '<meta name="twitter:card" content="summary">';

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${canonicalUrl}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="RivaStock">
    <meta property="og:locale" content="es_AR">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonicalUrl}">
    ${imageTags}
    <meta http-equiv="refresh" content="0;url=${catalogUrl}">
  </head>
  <body>
    <p>Abriendo el catálogo… <a href="${catalogUrl}">Continuar</a></p>
  </body>
</html>`;
}

export function formatPrice(value: unknown, currencySymbol: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const price = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(price) || price < 0) return null;
  const formatted = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(price));
  return `${(currencySymbol || '$').slice(0, 4)} ${formatted}`;
}
