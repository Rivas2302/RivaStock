-- Products created for supplier order lists are valid sellable catalog records,
-- but they do not become inventory until the operator explicitly promotes them.

BEGIN;

ALTER TABLE products
  ADD COLUMN catalog_only boolean NOT NULL DEFAULT false,
  ADD COLUMN catalog_cost numeric CHECK (catalog_cost IS NULL OR catalog_cost >= 0);

CREATE INDEX products_catalog_only_idx
  ON products(user_id, catalog_only)
  WHERE catalog_only;

CREATE OR REPLACE FUNCTION promote_reseller_catalog_product(
  p_product_id uuid
)
RETURNS products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_product products;
  v_price_list_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para incorporar productos al stock';
  END IF;

  SELECT * INTO v_product
  FROM products
  WHERE id = p_product_id AND user_id = v_uid
  FOR UPDATE;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;
  IF NOT v_product.catalog_only THEN
    RAISE EXCEPTION 'El producto ya pertenece al stock';
  END IF;
  IF v_product.stock <= 0 THEN
    RAISE EXCEPTION 'Carga una cantidad mayor que cero antes de incorporar el producto al stock';
  END IF;

  SELECT supplier_list.price_list_id INTO v_price_list_id
  FROM reseller_supplier_list_items supplier_item
  JOIN reseller_supplier_lists supplier_list
    ON supplier_list.id = supplier_item.supplier_list_id
   AND supplier_list.user_id = supplier_item.user_id
  WHERE supplier_item.user_id = v_uid
    AND supplier_item.product_id = p_product_id
  LIMIT 1;

  DELETE FROM reseller_supplier_list_items
  WHERE user_id = v_uid AND product_id = p_product_id;

  UPDATE price_list_items
  SET supplier_list_id = NULL,
      availability = 'in_stock',
      updated_at = now()
  WHERE user_id = v_uid AND product_id = p_product_id;

  -- A paused supplier list has no active price_list_item. Keep the product in
  -- the reseller catalog after promotion, but detach it from future list toggles.
  IF v_price_list_id IS NOT NULL THEN
    INSERT INTO price_list_items (
      user_id, price_list_id, product_id, availability, sort_order, supplier_list_id
    ) VALUES (
      v_uid,
      v_price_list_id,
      p_product_id,
      'in_stock',
      COALESCE((SELECT max(sort_order) + 1 FROM price_list_items WHERE price_list_id = v_price_list_id), 0),
      NULL
    )
    ON CONFLICT (price_list_id, product_id) DO UPDATE
      SET availability = 'in_stock',
          supplier_list_id = NULL,
          updated_at = now();
  END IF;

  UPDATE products
  SET catalog_only = false,
      catalog_cost = NULL,
      updated_at = now()
  WHERE id = p_product_id AND user_id = v_uid
  RETURNING * INTO v_product;

  RETURN v_product;
END;
$$;

CREATE OR REPLACE FUNCTION get_public_catalog_products(p_slug text)
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
      'availability', CASE WHEN p.stock > 0 THEN 'in_stock' ELSE 'out_of_stock' END
    ) ORDER BY p.created_at, p.name
  ), '[]'::jsonb)
  FROM catalog_config cc
  JOIN products p ON p.user_id = cc.user_id
  WHERE cc.slug = btrim(p_slug)
    AND cc.enabled
    AND p.show_in_catalog
    AND NOT p.catalog_only
    AND (cc.show_out_of_stock OR p.stock > 0);
$$;

REVOKE ALL ON FUNCTION promote_reseller_catalog_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION promote_reseller_catalog_product(uuid) TO authenticated;

COMMIT;
