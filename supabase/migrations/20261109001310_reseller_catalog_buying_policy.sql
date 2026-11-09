-- Store reseller purchase terms on the existing price-list configuration.
-- Existing rows remain NULL and use the approved default in the public getter/UI.
BEGIN;

ALTER TABLE public.price_lists
  ADD COLUMN buying_policy text,
  ADD CONSTRAINT price_lists_buying_policy_length_check
    CHECK (buying_policy IS NULL OR char_length(buying_policy) <= 5000);

CREATE OR REPLACE FUNCTION public.get_public_reseller_buying_policy(
  p_slug text,
  p_access_code text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(price_list.buying_policy, $policy$
Pedís cuando quieras y pagás por adelantado (se coordina por WhatsApp).
Cada proveedor tiene un mínimo de compra. Si tu pedido no llega al mínimo, queda “En espera”.
Los precios son por unidad.
El envío se cobra una vez que el pedido llega a General Pico, antes de la entrega.
Retiro en General Pico.
Si falta un producto, elegís devolución o saldo a favor.
Los productos con falla tienen la garantía del proveedor.$policy$)
  FROM public.catalog_config AS catalog
  JOIN public.price_lists AS price_list
    ON price_list.user_id = catalog.user_id
   AND price_list.kind = 'reseller'
  WHERE catalog.slug = btrim(p_slug)
    AND catalog.enabled
    AND price_list.public_enabled
    AND (
      price_list.access_code_hash = encode(
        extensions.digest(lower(btrim(COALESCE(p_access_code, ''))), 'sha256'),
        'hex'
      )
      OR EXISTS (
        SELECT 1
        FROM public.reseller_supplier_lists AS supplier_list
        JOIN public.reseller_supplier_order_rounds AS round
          ON round.supplier_list_id = supplier_list.id
         AND round.user_id = supplier_list.user_id
        WHERE supplier_list.price_list_id = price_list.id
          AND supplier_list.user_id = catalog.user_id
          AND supplier_list.enabled
          AND round.audience_code_hash = encode(
            extensions.digest(lower(btrim(COALESCE(p_access_code, ''))), 'sha256'),
            'hex'
          )
          AND round.status = 'open'
          AND round.closes_at > now()
      )
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_reseller_buying_policy(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_reseller_buying_policy(text, text) TO anon, authenticated;

COMMIT;
