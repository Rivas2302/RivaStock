import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc } }));

import { isCatalogSlugAvailable, isCatalogSlugConflict, normalizeCatalogSlug, suggestCatalogSlug, validateCatalogSlug } from './catalogSlug';

describe('catalog slugs', () => {
  beforeEach(() => rpc.mockReset());

  it('builds a lowercase URL slug and removes accents', () => {
    expect(normalizeCatalogSlug('  Bazar Lucía  ')).toBe('bazar-lucia');
    expect(normalizeCatalogSlug('Tienda Ñandú')).toBe('tienda-nandu');
  });

  it('validates size, allowed characters, and reserved words', () => {
    expect(validateCatalogSlug('ab')).toContain('3 y 40');
    expect(validateCatalogSlug('bazar-lucia')).toBeNull();
    expect(validateCatalogSlug(`${'a'.repeat(41)}`)).toContain('3 y 40');
    expect(validateCatalogSlug('bazar_lucia')).toContain('minúsculas');
    for (const slug of ['login', 'admin', 'api', 'catalogo', 'p']) {
      expect(validateCatalogSlug(slug)).toContain('reservado');
    }
  });

  it('checks live availability and requests a collision-safe name suggestion', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: 'bazar-lucia-2', error: null });
    await expect(isCatalogSlugAvailable('bazar-lucia', 'riva-actual')).resolves.toBe(false);
    await expect(suggestCatalogSlug('Bazar Lucía', 'riva-actual')).resolves.toBe('bazar-lucia-2');
    expect(rpc).toHaveBeenNthCalledWith(1, 'catalog_slug_available', { p_slug: 'bazar-lucia', p_current_slug: 'riva-actual' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'suggest_catalog_slug', { p_base_slug: 'bazar-lucia', p_current_slug: 'riva-actual' });
  });

  it('recognizes a uniqueness race returned by the database', () => {
    expect(isCatalogSlugConflict(new Error('duplicate key value violates catalog_slug_registry_pkey'))).toBe(true);
    expect(isCatalogSlugConflict(new Error('falló la conexión'))).toBe(false);
  });
});
