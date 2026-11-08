import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261108221034_i42_public_rivastock_catalog_supplier_import.sql', 'utf8');

describe('public catalog supplier import migration', () => {
  it('only replaces the public retail catalog readers and retains tenant/public visibility guards', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_public_catalog_products(p_slug text)');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_public_catalog_product(p_slug text, p_product_id uuid)');
    expect(sql).toContain('JOIN public.products p ON p.user_id = cc.user_id');
    expect(sql).toContain('cc.slug = btrim(p_slug)');
    expect(sql).toContain('AND cc.enabled');
    expect(sql).toContain('AND p.show_in_catalog');
    expect(sql).toContain('p.id = p_product_id');
    expect(sql).toContain("p.custom_fields->>'rivaCatalogSupplierImport' = 'true'");
    expect(sql).toContain('cc.show_out_of_stock');
    expect(sql).toContain("THEN 'on_order'");
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\s+(?:INTO\s+)?(?:public\.)?(?:products|catalog_config)/i);
  });

  it('returns only the established public product projection and keeps RPC grants bounded', () => {
    expect(sql).toContain("'id', p.id");
    expect(sql).toContain("'name', p.name");
    expect(sql).toContain("'salePrice', round(GREATEST(p.sale_price, 0))");
    expect(sql).toContain("'imageUrl', p.image_url");
    expect(sql).toContain("'images', COALESCE(to_jsonb(p.images), '[]'::jsonb)");
    expect(sql).not.toContain('purchase_price');
    expect(sql).not.toContain("'customFields'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_public_catalog_products(text) FROM PUBLIC');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_public_catalog_products(text) TO anon, authenticated');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_public_catalog_product(text, uuid) FROM PUBLIC');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_public_catalog_product(text, uuid) TO anon, authenticated');
  });
});
