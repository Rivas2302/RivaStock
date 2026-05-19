-- 0015_add_catalog_url_to_suppliers.sql
-- Agrega catalog_url a suppliers y re-crea delete_supplier
-- con lógica correcta (sin chequear stock_intakes que tiene supplier text)

BEGIN;

-- Agregar columna catalog_url si no existe
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS catalog_url text DEFAULT NULL;

-- Recrear delete_supplier sin la referencia a stock_intakes.supplier_id
-- (stock_intakes.supplier es text, no hay FK a suppliers)
DROP FUNCTION IF EXISTS delete_supplier(uuid);
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

COMMIT;