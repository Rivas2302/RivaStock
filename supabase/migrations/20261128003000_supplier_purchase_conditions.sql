-- Add optional buying conditions to supplier records without changing existing data.
BEGIN;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS minimum_order text,
  ADD COLUMN IF NOT EXISTS delivery_method text,
  ADD COLUMN IF NOT EXISTS usual_lead_time text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'suppliers_delivery_method_check'
       AND conrelid = 'public.suppliers'::regclass
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_delivery_method_check
      CHECK (delivery_method IS NULL OR delivery_method IN ('shipping', 'pickup', 'both'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_supplier_purchase_conditions(
  p_id uuid,
  p_minimum_order text DEFAULT NULL,
  p_delivery_method text DEFAULT NULL,
  p_usual_lead_time text DEFAULT NULL
)
RETURNS public.suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid uuid;
  v_updated public.suppliers%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'proveedores', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para actualizar las condiciones de compra';
  END IF;

  IF p_delivery_method IS NOT NULL
     AND p_delivery_method NOT IN ('shipping', 'pickup', 'both') THEN
    RAISE EXCEPTION 'Método de entrega inválido';
  END IF;

  UPDATE public.suppliers
     SET minimum_order = NULLIF(trim(p_minimum_order), ''),
         delivery_method = NULLIF(trim(p_delivery_method), ''),
         usual_lead_time = NULLIF(trim(p_usual_lead_time), '')
   WHERE id = p_id
     AND user_id = v_uid
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proveedor no encontrado';
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_supplier_purchase_conditions(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_supplier_purchase_conditions(uuid, text, text, text) TO authenticated;

COMMIT;
