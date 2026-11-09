-- Add configurable catalog announcement color and remembered supplier category mappings.
-- Existing catalogs keep NULL (automatic) and resolve to their primary accent color.
ALTER TABLE public.catalog_config
  ADD COLUMN IF NOT EXISTS announcement_color text;

CREATE TABLE IF NOT EXISTS public.reseller_supplier_category_mappings (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  source_category_key text NOT NULL CHECK (length(source_category_key) BETWEEN 1 AND 120),
  source_category_label text NOT NULL CHECK (length(source_category_label) BETWEEN 1 AND 120),
  target_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, supplier_id, source_category_key)
);

CREATE INDEX IF NOT EXISTS reseller_supplier_category_mappings_supplier_idx
  ON public.reseller_supplier_category_mappings(user_id, supplier_id);

ALTER TABLE public.reseller_supplier_category_mappings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reseller_supplier_category_mappings'
      AND policyname = 'reseller_supplier_category_mappings_owner_all'
  ) THEN
    CREATE POLICY reseller_supplier_category_mappings_owner_all
      ON public.reseller_supplier_category_mappings
      FOR ALL TO authenticated
      USING (user_id = public.get_owner_uid(auth.uid()))
      WITH CHECK (
        user_id = public.get_owner_uid(auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.suppliers s
          WHERE s.id = supplier_id AND s.user_id = reseller_supplier_category_mappings.user_id
        )
        AND (
          target_category_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.categories c
            WHERE c.id = target_category_id AND c.user_id = reseller_supplier_category_mappings.user_id
          )
        )
      );
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE
  ON public.reseller_supplier_category_mappings TO authenticated;

COMMENT ON COLUMN public.catalog_config.announcement_color IS
  'NULL uses the catalog primary accent; a hex color overrides the announcement ribbon background.';
