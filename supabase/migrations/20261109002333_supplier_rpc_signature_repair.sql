-- Repair supplier RPC signatures without dropping overloads or changing rows.
BEGIN;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text;

CREATE OR REPLACE FUNCTION public.register_supplier(
  p_name text,
  p_contact_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_cuit text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_payment_terms text DEFAULT NULL,
  p_catalog_url text DEFAULT NULL,
  p_facebook_url text DEFAULT NULL,
  p_instagram_url text DEFAULT NULL
)
RETURNS public.suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid uuid;
  v_new public.suppliers%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := public.get_owner_uid(v_caller);
  IF NOT public.has_permission(v_caller, 'proveedores', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar proveedores';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF p_email IS NOT NULL AND trim(p_email) <> ''
     AND p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Formato de email inválido';
  END IF;

  INSERT INTO public.suppliers (
    user_id, name, name_lower, contact_name, phone, email,
    address, cuit, category, notes, payment_terms, catalog_url,
    facebook_url, instagram_url
  ) VALUES (
    v_uid, trim(p_name), lower(trim(p_name)),
    NULLIF(trim(p_contact_name), ''), NULLIF(trim(p_phone), ''),
    NULLIF(trim(p_email), ''), NULLIF(trim(p_address), ''),
    NULLIF(trim(p_cuit), ''), NULLIF(trim(p_category), ''),
    NULLIF(trim(p_notes), ''), NULLIF(trim(p_payment_terms), ''),
    NULLIF(trim(p_catalog_url), ''), NULLIF(trim(p_facebook_url), ''),
    NULLIF(trim(p_instagram_url), '')
  ) RETURNING * INTO v_new;
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_supplier(
  p_id uuid,
  p_name text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_cuit text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_payment_terms text DEFAULT NULL,
  p_catalog_url text DEFAULT NULL,
  p_facebook_url text DEFAULT NULL,
  p_instagram_url text DEFAULT NULL
)
RETURNS public.suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid uuid;
  v_existing public.suppliers%ROWTYPE;
  v_updated public.suppliers%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := public.get_owner_uid(v_caller);
  IF NOT public.has_permission(v_caller, 'proveedores', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para actualizar proveedores';
  END IF;

  SELECT * INTO v_existing
  FROM public.suppliers
  WHERE id = p_id AND user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado'; END IF;

  IF p_email IS NOT NULL AND trim(p_email) <> ''
     AND p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Formato de email inválido';
  END IF;

  UPDATE public.suppliers SET
    name = COALESCE(NULLIF(trim(p_name), ''), name),
    name_lower = COALESCE(NULLIF(trim(lower(p_name)), ''), name_lower),
    contact_name = NULLIF(trim(p_contact_name), ''),
    phone = NULLIF(trim(p_phone), ''),
    email = NULLIF(trim(p_email), ''),
    address = NULLIF(trim(p_address), ''),
    cuit = NULLIF(trim(p_cuit), ''),
    category = NULLIF(trim(p_category), ''),
    notes = NULLIF(trim(p_notes), ''),
    payment_terms = NULLIF(trim(p_payment_terms), ''),
    catalog_url = NULLIF(trim(p_catalog_url), ''),
    facebook_url = NULLIF(trim(p_facebook_url), ''),
    instagram_url = NULLIF(trim(p_instagram_url), '')
  WHERE id = p_id AND user_id = v_uid
  RETURNING * INTO v_updated;
  RETURN v_updated;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
