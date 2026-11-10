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

export const DEFAULT_SHARE_IMAGE_URL = 'https://rivastock.vercel.app/og-default.png';

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

export function getPublicShareImageUrl(value: unknown, projectHost: string): string | null {
  return getPublicAssetUrl(value, projectHost) ?? (value === DEFAULT_SHARE_IMAGE_URL ? DEFAULT_SHARE_IMAGE_URL : null);
}

export function selectProductImage(product: ShareProduct, projectHost: string): string | null {
  for (const candidate of [product.imageUrl, ...(Array.isArray(product.images) ? product.images : [])]) {
    const image = getPublicAssetUrl(candidate, projectHost);
    if (image) return image;
  }
  return null;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

function validDimensions(width: number, height: number): ImageDimensions | null {
  return Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0 && width <= 20_000 && height <= 20_000
    ? { width, height }
    : null;
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return validDimensions(view.getUint32(16), view.getUint32(20));
  }

  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return validDimensions(bytes[6] | (bytes[7] << 8), bytes[8] | (bytes[9] << 8));
  }

  if (bytes.length >= 30 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      return validDimensions(uint24le(bytes, 24) + 1, uint24le(bytes, 27) + 1);
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      const height = 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
      return validDimensions(width, height);
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return validDimensions((bytes[26] | (bytes[27] << 8)) & 0x3fff, (bytes[28] | (bytes[29] << 8)) & 0x3fff);
    }
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if (frameMarkers.has(marker) && segmentLength >= 7) {
        const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        return validDimensions(width, height);
      }
      offset += segmentLength;
    }
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
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageAlt?: string | null;
  allowedImageHost: string;
}

export function renderShareHtml(input: ShareHtmlInput): string {
  const title = escapeHtml(truncate(input.title, 120));
  const description = escapeHtml(truncate(input.description, 240));
  const canonicalUrl = escapeHtml(input.canonicalUrl);
  const catalogUrl = escapeHtml(input.catalogUrl);
  const safeImage = input.imageUrl ? getPublicShareImageUrl(input.imageUrl, input.allowedImageHost) : null;
  const imageTags = safeImage
    ? [
      `<meta property="og:image" content="${escapeHtml(safeImage)}">`,
      `<meta property="og:image:secure_url" content="${escapeHtml(safeImage)}">`,
      ...(input.imageContentType && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(input.imageContentType)
        ? [`<meta property="og:image:type" content="${escapeHtml(input.imageContentType)}">`]
        : []),
      ...(input.imageWidth && input.imageHeight
        ? [`<meta property="og:image:width" content="${input.imageWidth}">`, `<meta property="og:image:height" content="${input.imageHeight}">`]
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
