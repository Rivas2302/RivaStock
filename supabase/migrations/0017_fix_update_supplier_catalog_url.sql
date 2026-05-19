-- 0017_fix_update_supplier_catalog_url.sql
-- Recrea update_supplier y register_supplier para asegurar
-- que el schema cache de Supabase tenga la firma correcta

BEGIN;

CREATE OR REPLACE FUNCTION register_supplier(
  p_name          text,
  p_contact_name  text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_email         text DEFAULT NULL,
  p_address       text DEFAULT NULL,
  p_cuit          text DEFAULT NULL,
  p_category      text DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_payment_terms text DEFAULT NULL,
  p_catalog_url   text DEFAULT NULL
)
RETURNS suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_new   suppliers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF p_email IS NOT NULL AND trim(p_email) <> '' AND p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Formato de email inválido';
  END IF;

  INSERT INTO suppliers (
    user_id, name, name_lower, contact_name, phone, email,
    address, cuit, category, notes, payment_terms, catalog_url
  ) VALUES (
    v_uid, trim(p_name), lower(trim(p_name)),
    NULLIF(trim(p_contact_name), '')::text,
    NULLIF(trim(p_phone), '')::text,
    NULLIF(trim(p_email), '')::text,
    NULLIF(trim(p_address), '')::text,
    NULLIF(trim(p_cuit), '')::text,
    NULLIF(trim(p_category), '')::text,
    NULLIF(trim(p_notes), '')::text,
    NULLIF(trim(p_payment_terms), '')::text,
    NULLIF(trim(p_catalog_url), '')::text
  ) RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION update_supplier(
  p_id            uuid,
  p_name          text DEFAULT NULL,
  p_contact_name  text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_email         text DEFAULT NULL,
  p_address       text DEFAULT NULL,
  p_cuit          text DEFAULT NULL,
  p_category      text DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_payment_terms text DEFAULT NULL,
  p_catalog_url   text DEFAULT NULL
)
RETURNS suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_existing suppliers%ROWTYPE;
  v_updated suppliers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_existing
    FROM suppliers
   WHERE id = p_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado'; END IF;

  IF p_email IS NOT NULL AND trim(p_email) <> '' AND p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Formato de email inválido';
  END IF;

  UPDATE suppliers SET
    name          = COALESCE(NULLIF(trim(p_name), ''), name),
    name_lower    = COALESCE(NULLIF(trim(lower(p_name)), ''), name_lower),
    contact_name  = NULLIF(trim(p_contact_name), '')::text,
    phone         = NULLIF(trim(p_phone), '')::text,
    email         = NULLIF(trim(p_email), '')::text,
    address       = NULLIF(trim(p_address), '')::text,
    cuit          = NULLIF(trim(p_cuit), '')::text,
    category      = NULLIF(trim(p_category), '')::text,
    notes         = NULLIF(trim(p_notes), '')::text,
    payment_terms = NULLIF(trim(p_payment_terms), '')::text,
    catalog_url   = NULLIF(trim(p_catalog_url), '')::text
  WHERE id = p_id AND user_id = v_uid
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$$;

COMMIT;