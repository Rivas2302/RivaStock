import type { PublicCatalogProduct } from '../types';
import { getPublicCatalogProduct, getPublicCatalogProducts } from './publicCatalog';
import { supabase, supabaseProjectUrl } from './supabase';

export const RIVASTOCK_CATALOG_ORIGIN = 'https://rivastock.vercel.app';

export interface RivaCatalogReference {
  slug: string;
  productId?: string;
}

export interface RivaCatalogImportProduct {
  id: string;
  name: string;
  price: number | null;
  category: string;
  imageUrl: string | null;
  imageUrls: string[];
}

export interface RivaCatalogSupplierSource {
  slug: string;
  businessName: string;
  showPrices: boolean;
  items: RivaCatalogImportProduct[];
}

const PRODUCT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseRivaCatalogReference(rawUrl: string): RivaCatalogReference | null {
  let url: URL;
  try { url = new URL(rawUrl.trim()); }
  catch { return null; }
  if (url.origin !== RIVASTOCK_CATALOG_ORIGIN || url.username || url.password) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'catalogo') return null;
  if (parts.length !== 2 && parts.length !== 3) throw new Error('Ingresá el enlace de un catálogo público de RivaStock.');

  const slug = decodeURIComponent(parts[1]);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(slug)) throw new Error('El enlace del catálogo no es válido.');
  if (parts.length === 2) return { slug };

  const productId = decodeURIComponent(parts[2]);
  if (!PRODUCT_ID_PATTERN.test(productId)) throw new Error('El enlace del producto no es válido.');
  return { slug, productId };
}

function mapPublicProduct(product: PublicCatalogProduct, showPrices: boolean): RivaCatalogImportProduct {
  const imageUrls = Array.from(new Set([
    ...(Array.isArray(product.images) ? product.images : []),
    product.imageUrl ?? '',
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
  return {
    id: product.id,
    name: product.name,
    price: showPrices && Number.isFinite(product.salePrice) ? product.salePrice : null,
    category: product.category ?? '',
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
  };
}

export async function loadRivaCatalogSupplierSource(rawUrl: string): Promise<RivaCatalogSupplierSource | null> {
  const reference = parseRivaCatalogReference(rawUrl);
  if (!reference) return null;

  const { data: config, error: configError } = await supabase
    .from('catalog_config')
    .select('business_name,show_prices')
    .eq('slug', reference.slug)
    .eq('enabled', true)
    .maybeSingle();
  if (configError || !config) throw new Error('No encontramos un catálogo público habilitado con ese enlace.');

  const products = reference.productId
    ? [await getPublicCatalogProduct(reference.slug, reference.productId)].filter((product): product is PublicCatalogProduct => product !== null)
    : await getPublicCatalogProducts(reference.slug);
  if (products.length === 0) throw new Error('Ese enlace no tiene productos visibles en el catálogo público.');

  return {
    slug: reference.slug,
    businessName: typeof config.business_name === 'string' && config.business_name.trim()
      ? config.business_name.trim()
      : 'RivaStock',
    showPrices: config.show_prices === true,
    items: products.map(product => mapPublicProduct(product, config.show_prices === true)),
  };
}

export function getRivaCatalogStoragePath(rawUrl: string, projectUrl = supabaseProjectUrl): string | null {
  try {
    const imageUrl = new URL(rawUrl);
    const project = new URL(projectUrl);
    const prefix = '/storage/v1/object/public/assets/';
    if (imageUrl.protocol !== 'https:' || imageUrl.origin !== project.origin
      || imageUrl.username || imageUrl.password || !imageUrl.pathname.startsWith(prefix)) return null;
    const path = decodeURIComponent(imageUrl.pathname.slice(prefix.length));
    const segments = path.split('/');
    if (segments.length < 4 || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\') || /[\u0000-\u001f]/.test(segment))) return null;
    return path;
  } catch {
    return null;
  }
}

export async function fetchRivaCatalogImage(rawUrl: string): Promise<File> {
  const path = getRivaCatalogStoragePath(rawUrl);
  if (!path) throw new Error('La foto no pertenece al almacenamiento público de RivaStock.');
  const { data, error } = await supabase.storage.from('assets').download(path);
  if (error || !data) throw new Error('No se pudo descargar la foto pública del catálogo.');
  const mimeType = data.type.toLocaleLowerCase('en-US').split(';')[0];
  const extension = mimeType === 'image/jpeg' ? 'jpg'
    : mimeType === 'image/png' ? 'png'
      : mimeType === 'image/webp' ? 'webp' : null;
  if (!extension || data.size <= 0 || data.size > 5 * 1024 * 1024) {
    throw new Error('La foto pública no tiene un formato compatible o supera 5 MB.');
  }
  return new File([data], `catalog-photo.${extension}`, { type: mimeType });
}
