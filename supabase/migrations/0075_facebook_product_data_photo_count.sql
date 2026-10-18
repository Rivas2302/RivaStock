-- Count JSON object keys with a PostgreSQL-supported expression.
CREATE OR REPLACE FUNCTION replace_facebook_product_data_photos(
  p_product uuid,
  p_replacements jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_owner uuid:=get_owner_uid(auth.uid());
  v_product products%ROWTYPE;
BEGIN
  IF NOT facebook_product_allowed(auth.uid(),p_product,true) THEN
    RAISE EXCEPTION 'Sin permiso para actualizar las fotos de este producto';
  END IF;
  IF jsonb_typeof(p_replacements) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_replacements)) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'Reemplazos de fotos inválidos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(p_replacements) AS replacement(old_url,new_url)
    WHERE old_url !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
      OR new_url !~ '^https://[A-Za-z0-9-]+\.supabase\.co/storage/v1/object/public/assets/[A-Za-z0-9._~%/-]+$'
  ) THEN
    RAISE EXCEPTION 'Solo se permiten fotos del producto guardadas en Storage';
  END IF;

  SELECT * INTO v_product
  FROM products
  WHERE id=p_product AND user_id=v_owner
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto inexistente'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_replacements) AS replacement(old_url)
    WHERE old_url IS DISTINCT FROM v_product.image_url
      AND NOT old_url=ANY(COALESCE(v_product.images,ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Las fotos del producto cambiaron. Actualizá y volvé a intentar';
  END IF;

  UPDATE products
  SET image_url=CASE
        WHEN image_url IS NOT NULL AND p_replacements ? image_url THEN p_replacements->>image_url
        ELSE image_url
      END,
      images=CASE WHEN images IS NULL THEN NULL ELSE ARRAY(
        SELECT CASE WHEN p_replacements ? photo THEN p_replacements->>photo ELSE photo END
        FROM unnest(images) WITH ORDINALITY AS current_photo(photo,position)
        ORDER BY position
      ) END
  WHERE id=p_product AND user_id=v_owner;
END;
$$;

REVOKE ALL ON FUNCTION replace_facebook_product_data_photos(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION replace_facebook_product_data_photos(uuid,jsonb) TO authenticated;
