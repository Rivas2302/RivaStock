-- Persist owner-defined reseller profit rules without changing existing prices.
BEGIN;

ALTER TABLE public.price_lists
  ADD COLUMN margin_rules jsonb NOT NULL DEFAULT '{
    "tiers": [
      {"id":"cost-5000","maximumCost":5000,"mode":"percent","value":40,"minimumProfit":null,"maximumProfit":null},
      {"id":"cost-15000","maximumCost":15000,"mode":"percent","value":30,"minimumProfit":null,"maximumProfit":null},
      {"id":"cost-30000","maximumCost":30000,"mode":"fixed","value":5000,"minimumProfit":null,"maximumProfit":null},
      {"id":"cost-over-30000","maximumCost":null,"mode":"percent","value":18,"minimumProfit":null,"maximumProfit":null}
    ],
    "categoryOverrides": {},
    "productOverrides": {},
    "rounding": "none"
  }'::jsonb,
  ADD CONSTRAINT price_lists_margin_rules_shape_check CHECK (
    COALESCE(jsonb_typeof(margin_rules) = 'object', false)
    AND COALESCE(jsonb_typeof(margin_rules -> 'tiers') = 'array', false)
    AND CASE WHEN jsonb_typeof(margin_rules -> 'tiers') = 'array'
      THEN jsonb_array_length(margin_rules -> 'tiers') BETWEEN 2 AND 10
      ELSE false
    END
    AND COALESCE(jsonb_typeof(margin_rules -> 'categoryOverrides') = 'object', false)
    AND COALESCE(jsonb_typeof(margin_rules -> 'productOverrides') = 'object', false)
    AND COALESCE(margin_rules ->> 'rounding' IN ('none', '100', '500'), false)
  );

COMMIT;
