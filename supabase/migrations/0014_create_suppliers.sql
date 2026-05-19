-- 0014_create_suppliers.sql
-- Tabla suppliers + RPCs + RLS + trigger updated_at

BEGIN;

-- ────────────────────────────────────────────────
-- TABLA
-- ────────────────────────────────────────────────
CREATE TABLE suppliers (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          text        NOT NULL DEFAULT '',
  name_lower    text        NOT NULL DEFAULT '',
  contact_name  text        DEFAULT NULL,
  phone         text        DEFAULT NULL,
  email         text        DEFAULT NULL,
  address       text        DEFAULT NULL,
  cuit          text        DEFAULT NULL,
  category      text        DEFAULT NULL,
  notes         text        DEFAULT NULL,
  payment_terms text        DEFAULT NULL,
  catalog_url   text        DEFAULT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX suppliers_user_id_idx    ON suppliers (user_id);
CREATE INDEX suppliers_name_lower_idx ON suppliers (name_lower);
CREATE INDEX suppliers_category_idx    ON suppliers (category);
CREATE INDEX suppliers_is_active_idx   ON suppliers (is_active);

-- ────────────────────────────────────────────────
-- TRIGGER updated_at automático
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_suppliers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION handle_suppliers_updated_at();

-- ────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY suppliers_owner ON suppliers
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ────────────────────────────────────────────────
-- RPC: register_supplier
-- ────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────
-- RPC: update_supplier
-- ────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────
-- RPC: delete_supplier
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_supplier(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  DELETE FROM suppliers WHERE id = p_id AND user_id = v_uid;
END;
$$;

-- ────────────────────────────────────────────────
-- RPC: toggle_supplier_active
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION toggle_supplier_active(p_id uuid)
RETURNS suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_updated suppliers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  UPDATE suppliers
     SET is_active = NOT is_active
   WHERE id = p_id AND user_id = v_uid
   RETURNING * INTO v_updated;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado'; END IF;

  RETURN v_updated;
END;
$$;

COMMIT;