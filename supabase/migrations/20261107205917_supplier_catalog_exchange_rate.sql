BEGIN;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS catalog_exchange_rate numeric(14, 4);

ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_catalog_exchange_rate_positive
  CHECK (catalog_exchange_rate IS NULL OR catalog_exchange_rate > 0);

COMMENT ON COLUMN public.suppliers.catalog_exchange_rate IS
  'Última cotización local detectada o ingresada para importar el catálogo de este proveedor.';

COMMIT;
