import { supabase } from './supabase';

const RESERVED_CATALOG_SLUGS = new Set([
  'login', 'admin', 'api', 'catalogo', 'p', 'auth', 'assets', 'downloads',
  'plataforma', 'config', 'stock', 'ventas', 'pedidos', 'proveedores', 'revendedores', 'ia',
]);

export function normalizeCatalogSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function validateCatalogSlug(value: string): string | null {
  if (RESERVED_CATALOG_SLUGS.has(value)) return 'Ese nombre está reservado. Elegí otro link.';
  if (value.length < 3 || value.length > 40) return 'El link debe tener entre 3 y 40 caracteres.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) return 'Usá solo letras minúsculas, números y guiones.';
  return null;
}

export function isCatalogSlugConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /catalog_slug_registry|catalog_config_slug_key_unique|23505|duplicate key|Ese link ya está en uso/i.test(message);
}

export async function isCatalogSlugAvailable(slug: string, currentSlug?: string): Promise<boolean> {
  const args: { p_slug: string; p_current_slug?: string } = { p_slug: slug };
  if (currentSlug) args.p_current_slug = currentSlug;
  const { data, error } = await supabase.rpc('catalog_slug_available', args);
  if (error) throw new Error(`[catalog_slug_available] ${error.message}`);
  return data === true;
}

export async function suggestCatalogSlug(nameOrSlug: string, currentSlug?: string): Promise<string> {
  const args: { p_base_slug: string; p_current_slug?: string } = { p_base_slug: normalizeCatalogSlug(nameOrSlug) };
  if (currentSlug) args.p_current_slug = currentSlug;
  const { data, error } = await supabase.rpc('suggest_catalog_slug', args);
  if (error) throw new Error(`[suggest_catalog_slug] ${error.message}`);
  if (typeof data !== 'string') throw new Error('No se pudo sugerir un link disponible.');
  return data;
}
