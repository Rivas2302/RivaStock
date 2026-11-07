ALTER TABLE public.catalog_config
  ADD COLUMN IF NOT EXISTS presentation jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.get_public_catalog_products(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'categoryId', p.category_id,
      'category', p.category,
      'salePrice', round(GREATEST(p.sale_price, 0)),
      'stock', p.stock,
      'imageUrl', p.image_url,
      'images', COALESCE(to_jsonb(p.images), '[]'::jsonb),
      'description', p.description,
      'availability', CASE WHEN p.stock > 0 THEN 'in_stock' ELSE 'out_of_stock' END,
      'createdAt', p.created_at
    ) ORDER BY p.created_at, p.name
  ), '[]'::jsonb)
  FROM public.catalog_config cc
  JOIN public.products p ON p.user_id = cc.user_id
  WHERE cc.slug = btrim(p_slug)
    AND cc.enabled
    AND p.show_in_catalog
    AND NOT p.catalog_only
    AND (cc.show_out_of_stock OR p.stock > 0);
$$;

REVOKE ALL ON FUNCTION public.get_public_catalog_products(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_catalog_products(text) TO anon, authenticated;
