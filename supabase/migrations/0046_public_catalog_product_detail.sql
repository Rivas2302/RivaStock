BEGIN;

-- Same retail visibility and safe projection as 0045, but bounded by product
-- id. Never grant anonymous SELECT on the underlying products table.
CREATE OR REPLACE FUNCTION get_public_catalog_product(p_slug text, p_product_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'categoryId', p.category_id,
    'category', p.category,
    'salePrice', round(GREATEST(p.sale_price, 0)),
    'stock', p.stock,
    'imageUrl', p.image_url,
    'images', COALESCE(to_jsonb(p.images), '[]'::jsonb),
    'description', p.description,
    'availability', CASE WHEN p.stock > 0 THEN 'in_stock' ELSE 'out_of_stock' END
  )
  FROM catalog_config cc
  JOIN products p ON p.user_id = cc.user_id
  WHERE cc.slug = btrim(p_slug)
    AND cc.enabled
    AND p.id = p_product_id
    AND p.show_in_catalog
    AND NOT p.catalog_only
    AND (cc.show_out_of_stock OR p.stock > 0)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_public_catalog_product(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_catalog_product(text, uuid) TO anon, authenticated;

COMMIT;
