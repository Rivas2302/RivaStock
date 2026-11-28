ALTER TABLE public.catalog_config
  ADD COLUMN IF NOT EXISTS reseller_category_settings jsonb
  NOT NULL DEFAULT '{"mode":"all","categoryIds":[],"showOtherProducts":true}'::jsonb;

COMMENT ON COLUMN public.catalog_config.reseller_category_settings IS
  'Per-channel category display preferences for the reseller catalog.';
