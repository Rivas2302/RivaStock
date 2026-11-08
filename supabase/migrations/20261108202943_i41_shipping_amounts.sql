BEGIN;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS shipping_amount numeric NOT NULL DEFAULT 0
  CHECK (shipping_amount >= 0);

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS shipping_amount numeric NOT NULL DEFAULT 0
  CHECK (shipping_amount >= 0);

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS app_private.sale_shipping_commands (
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('register', 'edit')),
  request_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_key)
);
ALTER TABLE app_private.sale_shipping_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.sale_shipping_commands FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.apply_sale_shipping(
  p_sale_id uuid,
  p_base_total numeric,
  p_shipping_amount numeric
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid uuid;
  v_sale public.sales%ROWTYPE;
  v_total numeric;
  v_delta numeric;
  v_customer_id uuid;
  v_tx_id uuid;
  v_flow_id uuid;
  v_flow record;
  v_remaining numeric;
  v_take numeric;
  v_description text;
  v_finance_guard text := current_setting('app.finance_write', true);
  v_bypass_guard text := current_setting('app.bypass_check', true);
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar ventas';
  END IF;
  IF p_base_total IS NULL OR p_base_total < 0 OR p_shipping_amount IS NULL OR p_shipping_amount < 0 THEN
    RAISE EXCEPTION 'El total y el costo de envio deben ser mayores o iguales a cero';
  END IF;

  v_uid := get_owner_uid(v_caller);
  SELECT * INTO v_sale
  FROM public.sales
  WHERE user_id = v_uid AND id = p_sale_id
  FOR UPDATE;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  v_total := round(p_base_total + p_shipping_amount, 2);
  v_delta := v_total - v_sale.total;
  PERFORM set_config('app.finance_write', 'rpc', true);
  PERFORM set_config('app.bypass_check', 'rpc', true);
  UPDATE public.sales
  SET shipping_amount = p_shipping_amount, total = v_total
  WHERE user_id = v_uid AND id = p_sale_id
  RETURNING * INTO v_sale;

  SELECT transaction.customer_id INTO v_customer_id
  FROM public.customer_transactions AS transaction
  WHERE transaction.user_id = v_uid
    AND transaction.related_sale_id = p_sale_id
    AND transaction.type = 'sale'
  ORDER BY transaction.created_at, transaction.id
  LIMIT 1;

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.customer_transactions
    SET amount = v_total
    WHERE user_id = v_uid AND related_sale_id = p_sale_id AND type = 'sale';

    IF v_sale.status = 'Pagado' AND v_delta <> 0 THEN
      SELECT transaction.id INTO v_tx_id
      FROM public.customer_transactions AS transaction
      WHERE transaction.user_id = v_uid
        AND transaction.related_sale_id = p_sale_id
        AND transaction.type = 'payment'
        AND transaction.amount < 0
      ORDER BY transaction.date DESC, transaction.created_at DESC, transaction.id DESC
      LIMIT 1
      FOR UPDATE;
      IF v_tx_id IS NULL THEN RAISE EXCEPTION 'No se encontró el cobro asociado a la venta'; END IF;

      IF v_delta > 0 THEN
        UPDATE public.customer_transactions SET amount = amount - v_delta WHERE id = v_tx_id;
      ELSE
        v_remaining := -v_delta;
        FOR v_flow IN
          SELECT transaction.id, transaction.amount
          FROM public.customer_transactions AS transaction
          WHERE transaction.user_id = v_uid
            AND transaction.related_sale_id = p_sale_id
            AND transaction.type = 'payment'
            AND transaction.amount < 0
          ORDER BY transaction.date DESC, transaction.created_at DESC, transaction.id DESC
          FOR UPDATE
        LOOP
          v_take := LEAST(v_remaining, ABS(v_flow.amount));
          UPDATE public.customer_transactions
          SET amount = amount + v_take
          WHERE id = v_flow.id;
          v_remaining := v_remaining - v_take;
          EXIT WHEN v_remaining <= 0;
        END LOOP;
        IF v_remaining > 0 THEN RAISE EXCEPTION 'El total cobrado no alcanza para ajustar el costo de envio'; END IF;
      END IF;
    ELSIF v_delta <> 0 THEN
      UPDATE public.customers
      SET current_balance = current_balance + v_delta, updated_at = now()
      WHERE user_id = v_uid AND id = v_customer_id;
    END IF;
  END IF;

  IF v_sale.status = 'Pagado' THEN
    IF v_delta > 0 THEN
      SELECT flow.id INTO v_flow_id
      FROM public.cash_flow AS flow
      WHERE flow.user_id = v_uid AND flow.sale_id = p_sale_id
        AND flow.type = 'Ingreso' AND flow.status = 'Pagado'
      ORDER BY flow.created_at DESC, flow.id DESC
      LIMIT 1
      FOR UPDATE;
      IF v_flow_id IS NULL THEN RAISE EXCEPTION 'No se encontró el ingreso asociado a la venta'; END IF;
      UPDATE public.cash_flow SET amount = amount + v_delta WHERE id = v_flow_id;
    ELSIF v_delta < 0 THEN
      v_remaining := -v_delta;
      FOR v_flow IN
        SELECT flow.id, flow.amount
        FROM public.cash_flow AS flow
        WHERE flow.user_id = v_uid AND flow.sale_id = p_sale_id
          AND flow.type = 'Ingreso' AND flow.status = 'Pagado' AND flow.amount > 0
        ORDER BY flow.created_at DESC, flow.id DESC
        FOR UPDATE
      LOOP
        v_take := LEAST(v_remaining, v_flow.amount);
        UPDATE public.cash_flow SET amount = amount - v_take WHERE id = v_flow.id;
        v_remaining := v_remaining - v_take;
        EXIT WHEN v_remaining <= 0;
      END LOOP;
      IF v_remaining > 0 THEN RAISE EXCEPTION 'Los ingresos asociados no alcanzan para ajustar el costo de envio'; END IF;
    END IF;

    SELECT flow.id, flow.description INTO v_flow_id, v_description
    FROM public.cash_flow AS flow
    WHERE flow.user_id = v_uid AND flow.sale_id = p_sale_id
      AND flow.type = 'Ingreso' AND flow.status = 'Pagado'
    ORDER BY flow.created_at DESC, flow.id DESC
    LIMIT 1
    FOR UPDATE;
    IF v_flow_id IS NULL AND p_shipping_amount > 0 THEN
      RAISE EXCEPTION 'No se encontró el ingreso asociado a la venta';
    END IF;
    IF v_flow_id IS NOT NULL THEN
      v_description := regexp_replace(COALESCE(v_description, ''), ' · incluye envío \$[^·]*$', '');
      IF p_shipping_amount > 0 THEN
        v_description := v_description || ' · incluye envío $' || trim(to_char(p_shipping_amount, 'FM999999999999990D00'));
      END IF;
      UPDATE public.cash_flow SET description = v_description WHERE id = v_flow_id;
    END IF;
  END IF;

  PERFORM set_config('app.finance_write', COALESCE(v_finance_guard, ''), true);
  PERFORM set_config('app.bypass_check', COALESCE(v_bypass_guard, ''), true);
  RETURN v_sale;
END;
$$;
REVOKE ALL ON FUNCTION app_private.apply_sale_shipping(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_sale_cash_flow_allocations(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_cash public.cash_flow%ROWTYPE;
  v_share record;
  v_share_count integer;
  v_share_index integer;
  v_cash_count integer;
  v_cash_index integer := 0;
  v_total_cash numeric;
  v_total_revenue numeric;
  v_product_total numeric;
  v_remaining_amount numeric;
  v_remaining_costs jsonb := '{}'::jsonb;
  v_amount numeric;
  v_product_cash_amount numeric;
  v_cost_amount numeric;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN RETURN; END IF;

  UPDATE public.cash_flow_allocations
  SET reversed_at = now(), reversal_reason = 'finance_refresh'
  WHERE user_id = v_sale.user_id AND sale_id_snapshot = v_sale.id AND reversed_at IS NULL;

  SELECT count(*), COALESCE(sum(revenue), 0)
  INTO v_share_count, v_total_revenue
  FROM (
    SELECT inventory_owner_id_snapshot, sum(revenue_share) AS revenue
    FROM public.sale_item_allocations
    WHERE user_id = v_sale.user_id AND sale_id_snapshot = v_sale.id AND reversed_at IS NULL
    GROUP BY inventory_owner_id_snapshot
  ) owner_shares;
  IF v_share_count = 0 THEN RETURN; END IF;

  v_product_total := GREATEST(v_sale.total - v_sale.shipping_amount, 0);

  SELECT count(*), COALESCE(sum(
    CASE WHEN v_sale.total > 0
      THEN round(flow.amount * v_product_total / v_sale.total, 2)
      ELSE flow.amount
    END
  ), 0)
  INTO v_cash_count, v_total_cash
  FROM public.cash_flow AS flow
  WHERE flow.user_id = v_sale.user_id AND flow.sale_id = v_sale.id;

  SELECT COALESCE(jsonb_object_agg(inventory_owner_id_snapshot::text, cost), '{}'::jsonb)
  INTO v_remaining_costs
  FROM (
    SELECT inventory_owner_id_snapshot,
      round(sum(cost_share) * LEAST(1, COALESCE(v_total_cash / NULLIF(v_product_total, 0), 0)), 2) AS cost
    FROM public.sale_item_allocations
    WHERE user_id = v_sale.user_id AND sale_id_snapshot = v_sale.id AND reversed_at IS NULL
    GROUP BY inventory_owner_id_snapshot
  ) owner_costs;

  FOR v_cash IN
    SELECT * FROM public.cash_flow
    WHERE user_id = v_sale.user_id AND sale_id = v_sale.id
    ORDER BY id
  LOOP
    v_cash_index := v_cash_index + 1;
    v_product_cash_amount := CASE WHEN v_sale.total > 0
      THEN round(v_cash.amount * v_product_total / v_sale.total, 2)
      ELSE v_cash.amount
    END;
    v_remaining_amount := v_product_cash_amount;
    v_share_index := 0;

    FOR v_share IN
      SELECT allocation.inventory_owner_id,
        allocation.inventory_owner_id_snapshot,
        min(allocation.inventory_owner_name_snapshot) AS owner_name,
        sum(allocation.revenue_share) AS revenue,
        sum(allocation.cost_share) AS cost,
        min(allocation.actor_uid::text)::uuid AS actor_uid,
        min(allocation.allocation_source) AS snapshot_source,
        min(allocation.snapshot_reason) AS snapshot_reason
      FROM public.sale_item_allocations AS allocation
      WHERE allocation.user_id = v_sale.user_id
        AND allocation.sale_id_snapshot = v_sale.id
        AND allocation.reversed_at IS NULL
      GROUP BY allocation.inventory_owner_id, allocation.inventory_owner_id_snapshot
      ORDER BY allocation.inventory_owner_id_snapshot
    LOOP
      v_share_index := v_share_index + 1;
      v_amount := CASE
        WHEN v_share_index = v_share_count THEN v_remaining_amount
        WHEN v_total_revenue = 0 THEN 0
        ELSE round(v_product_cash_amount * v_share.revenue / v_total_revenue, 2)
      END;
      v_remaining_amount := round(v_remaining_amount - v_amount, 2);
      v_cost_amount := CASE
        WHEN v_cash_index = v_cash_count
          THEN COALESCE((v_remaining_costs->>v_share.inventory_owner_id_snapshot::text)::numeric, 0)
        WHEN v_product_total = 0 THEN 0
        ELSE round(v_share.cost * v_product_cash_amount / v_product_total, 2)
      END;
      v_remaining_costs := jsonb_set(
        v_remaining_costs,
        ARRAY[v_share.inventory_owner_id_snapshot::text],
        to_jsonb(round(
          COALESCE((v_remaining_costs->>v_share.inventory_owner_id_snapshot::text)::numeric, 0) - v_cost_amount,
          2
        ))
      );

      INSERT INTO public.cash_flow_allocations (
        user_id, cash_flow_id, cash_flow_id_snapshot, sale_id_snapshot,
        inventory_owner_id, inventory_owner_id_snapshot,
        inventory_owner_name_snapshot, amount, cost_amount, actor_uid,
        snapshot_source, snapshot_reason
      ) VALUES (
        v_sale.user_id, v_cash.id, v_cash.id, v_sale.id,
        v_share.inventory_owner_id, v_share.inventory_owner_id_snapshot,
        v_share.owner_name, v_amount, v_cost_amount, v_share.actor_uid,
        v_share.snapshot_source, v_share.snapshot_reason
      );
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_sale_cash_flow_allocations(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_sale_with_shipping(
  p_date date,
  p_product_id uuid,
  p_quantity integer,
  p_unit_price numeric,
  p_adjustment numeric,
  p_status text,
  p_shipping_amount numeric,
  p_payment_method text DEFAULT NULL,
  p_client text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL
)
RETURNS SETOF public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM public.register_sale(
    p_date, p_product_id, p_quantity, p_unit_price, p_adjustment,
    p_status, p_payment_method, p_client, p_customer_id
  ) LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No se pudo registrar la venta'; END IF;
  v_sale := app_private.apply_sale_shipping(v_sale.id, v_sale.total, p_shipping_amount);
  RETURN NEXT v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_pos_sale_with_shipping(
  p_items jsonb,
  p_payment_method text,
  p_status text,
  p_customer_id uuid,
  p_adjustment_total numeric,
  p_shipping_amount numeric,
  p_date date,
  p_allow_oversell boolean
)
RETURNS SETOF public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM public.register_pos_sale(
    p_items, p_payment_method, p_status, p_customer_id,
    p_adjustment_total, p_date, p_allow_oversell
  ) LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No se pudo registrar la venta'; END IF;
  v_sale := app_private.apply_sale_shipping(v_sale.id, v_sale.total, p_shipping_amount);
  RETURN NEXT v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_attributed_sale_with_shipping(
  p_items jsonb,
  p_payment_method text,
  p_status text,
  p_customer_id uuid,
  p_adjustment_total numeric,
  p_date date,
  p_source text,
  p_shipping_amount numeric,
  p_idempotency_key text
)
RETURNS SETOF public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid uuid;
  v_payload jsonb;
  v_fingerprint text;
  v_command app_private.sale_shipping_commands%ROWTYPE;
  v_sale public.sales%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN RAISE EXCEPTION 'Sin permiso para registrar ventas'; END IF;
  IF char_length(p_idempotency_key) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Clave de idempotencia invalida'; END IF;
  v_uid := get_owner_uid(v_caller);
  v_payload := jsonb_build_object(
    'items', p_items, 'paymentMethod', p_payment_method, 'status', p_status,
    'customerId', p_customer_id, 'adjustmentTotal', p_adjustment_total,
    'date', p_date, 'source', p_source, 'shippingAmount', p_shipping_amount
  );
  v_fingerprint := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  PERFORM lock_inventory_commands(v_uid, ARRAY[p_idempotency_key]);

  SELECT * INTO v_command FROM app_private.sale_shipping_commands
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_command.operation <> 'register' OR v_command.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    v_sale := jsonb_populate_record(NULL::public.sales, v_command.result);
    RETURN NEXT v_sale;
    RETURN;
  END IF;
  IF p_shipping_amount > 0 AND EXISTS (
    SELECT 1 FROM public.attributed_sale_commands
    WHERE user_id = v_uid AND idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'La solicitud anterior no registró costo de envio; revisá la venta antes de reintentar';
  END IF;

  SELECT * INTO v_sale FROM public.register_attributed_sale(
    p_items, p_payment_method, p_status, p_customer_id,
    p_adjustment_total, p_date, p_source, p_idempotency_key
  ) LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No se pudo registrar la venta'; END IF;
  v_sale := app_private.apply_sale_shipping(v_sale.id, v_sale.total, p_shipping_amount);
  UPDATE public.attributed_sale_commands
  SET result = to_jsonb(v_sale)
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key AND operation = 'register';
  INSERT INTO app_private.sale_shipping_commands(user_id, idempotency_key, operation, request_fingerprint, result)
  VALUES (v_uid, p_idempotency_key, 'register', v_fingerprint, to_jsonb(v_sale));
  RETURN NEXT v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_sale_with_shipping(
  p_sale_id uuid,
  p_new_product_id uuid,
  p_new_quantity integer,
  p_new_unit_price numeric,
  p_new_adjustment numeric,
  p_new_status text,
  p_new_payment_method text,
  p_new_client text,
  p_new_date date,
  p_shipping_amount numeric
)
RETURNS SETOF public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_sale public.sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM public.edit_sale(
    p_sale_id, p_new_product_id, p_new_quantity, p_new_unit_price,
    p_new_adjustment, p_new_status, p_new_payment_method, p_new_client, p_new_date
  ) LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No se pudo editar la venta'; END IF;
  v_sale := app_private.apply_sale_shipping(v_sale.id, v_sale.total, p_shipping_amount);
  RETURN NEXT v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_pos_sale_with_shipping(
  p_sale_id uuid,
  p_new_items jsonb,
  p_new_adjustment numeric,
  p_new_status text,
  p_new_payment_method text,
  p_new_customer_id uuid,
  p_new_date date,
  p_shipping_amount numeric
)
RETURNS SETOF public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_sale public.sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM public.edit_pos_sale(
    p_sale_id, p_new_items, p_new_adjustment, p_new_status,
    p_new_payment_method, p_new_customer_id, p_new_date
  ) LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No se pudo editar la venta'; END IF;
  v_sale := app_private.apply_sale_shipping(v_sale.id, v_sale.total, p_shipping_amount);
  RETURN NEXT v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_attributed_sale_with_shipping(
  p_sale_id uuid,
  p_items jsonb,
  p_adjustment_total numeric,
  p_status text,
  p_payment_method text,
  p_customer_id uuid,
  p_client text,
  p_date date,
  p_shipping_amount numeric,
  p_idempotency_key text
)
RETURNS SETOF public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid uuid;
  v_payload jsonb;
  v_fingerprint text;
  v_command app_private.sale_shipping_commands%ROWTYPE;
  v_sale public.sales%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN RAISE EXCEPTION 'Sin permiso para editar ventas'; END IF;
  IF char_length(p_idempotency_key) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Clave de idempotencia invalida'; END IF;
  v_uid := get_owner_uid(v_caller);
  v_payload := jsonb_build_object(
    'saleId', p_sale_id, 'items', p_items, 'adjustmentTotal', p_adjustment_total,
    'status', p_status, 'paymentMethod', p_payment_method, 'customerId', p_customer_id,
    'client', p_client, 'date', p_date, 'shippingAmount', p_shipping_amount
  );
  v_fingerprint := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  PERFORM lock_inventory_commands(v_uid, ARRAY[p_idempotency_key]);

  SELECT * INTO v_command FROM app_private.sale_shipping_commands
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_command.operation <> 'edit' OR v_command.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    v_sale := jsonb_populate_record(NULL::public.sales, v_command.result);
    RETURN NEXT v_sale;
    RETURN;
  END IF;
  IF p_shipping_amount > 0 AND EXISTS (
    SELECT 1 FROM public.attributed_sale_commands
    WHERE user_id = v_uid AND idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'La solicitud anterior no registró costo de envio; revisá la venta antes de reintentar';
  END IF;

  SELECT * INTO v_sale FROM public.edit_attributed_sale(
    p_sale_id, p_items, p_adjustment_total, p_status, p_payment_method,
    p_customer_id, p_client, p_date, p_idempotency_key
  ) LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No se pudo editar la venta'; END IF;
  v_sale := app_private.apply_sale_shipping(v_sale.id, v_sale.total, p_shipping_amount);
  UPDATE public.attributed_sale_commands
  SET result = to_jsonb(v_sale)
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key AND operation = 'edit';
  INSERT INTO app_private.sale_shipping_commands(user_id, idempotency_key, operation, request_fingerprint, result)
  VALUES (v_uid, p_idempotency_key, 'edit', v_fingerprint, to_jsonb(v_sale));
  RETURN NEXT v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_quote_to_sale_with_shipping(
  p_quote_id uuid,
  p_status text,
  p_payment_method text DEFAULT NULL
)
RETURNS SETOF public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid uuid;
  v_quote public.quotes%ROWTYPE;
  v_sale public.sales%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN RAISE EXCEPTION 'Sin permiso para registrar ventas'; END IF;
  v_uid := get_owner_uid(v_caller);
  SELECT * INTO v_quote FROM public.quotes
  WHERE user_id = v_uid AND id = p_quote_id
  FOR UPDATE;
  IF v_quote.id IS NULL THEN RAISE EXCEPTION 'Presupuesto no encontrado'; END IF;
  SELECT * INTO v_sale FROM public.convert_quote_to_sale(
    p_quote_id, p_status, p_payment_method
  ) LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No se pudo convertir el presupuesto'; END IF;
  v_sale := app_private.apply_sale_shipping(
    v_sale.id,
    GREATEST(0, v_quote.total - v_quote.shipping_amount),
    v_quote.shipping_amount
  );
  RETURN NEXT v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_quote_with_shipping(p_quote_id uuid)
RETURNS TABLE (
  id uuid,
  number text,
  client_name text,
  client_phone text,
  client_email text,
  items jsonb,
  subtotal numeric,
  discount numeric,
  shipping_amount numeric,
  total numeric,
  expires_at timestamptz,
  notes text,
  created_at timestamptz,
  business_name text,
  business_phone text,
  email_contact text,
  currency_symbol text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT q.id, q.number, q.client_name, q.client_phone, q.client_email,
    q.items, q.subtotal, q.discount, q.shipping_amount, q.total,
    q.expires_at, q.notes, q.created_at, profile.business_name,
    profile.phone, profile.email_contact, profile.currency_symbol
  FROM public.quotes AS q
  LEFT JOIN public.profiles AS profile ON profile.id = q.user_id
  WHERE q.id = p_quote_id;
$$;

CREATE OR REPLACE FUNCTION public.get_collected_shipping_report(p_from date, p_to date)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid uuid;
  v_total numeric;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(v_caller, 'ventas', 'read') THEN RAISE EXCEPTION 'Sin permiso para leer ventas'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN RAISE EXCEPTION 'Rango de fechas invalido'; END IF;
  v_uid := get_owner_uid(v_caller);

  WITH paid_by_sale AS (
    SELECT flow.sale_id, SUM(flow.amount) AS paid_amount
    FROM public.cash_flow AS flow
    WHERE flow.user_id = v_uid
      AND flow.sale_id IS NOT NULL
      AND flow.type = 'Ingreso'
      AND flow.status = 'Pagado'
      AND flow.date BETWEEN p_from AND p_to
    GROUP BY flow.sale_id
  )
  SELECT COALESCE(SUM(
    CASE WHEN sale.total > 0 THEN
      sale.shipping_amount * LEAST(paid.paid_amount, sale.total) / sale.total
    ELSE 0 END
  ), 0)
  INTO v_total
  FROM public.sales AS sale
  JOIN paid_by_sale AS paid ON paid.sale_id = sale.id
  WHERE sale.user_id = v_uid;
  RETURN round(v_total, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.register_sale_with_shipping(date, uuid, integer, numeric, numeric, text, numeric, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_pos_sale_with_shipping(jsonb, text, text, uuid, numeric, numeric, date, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_attributed_sale_with_shipping(jsonb, text, text, uuid, numeric, date, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_sale_with_shipping(uuid, uuid, integer, numeric, numeric, text, text, text, date, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_pos_sale_with_shipping(uuid, jsonb, numeric, text, text, uuid, date, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_attributed_sale_with_shipping(uuid, jsonb, numeric, text, text, uuid, text, date, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.convert_quote_to_sale_with_shipping(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_quote_with_shipping(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_collected_shipping_report(date, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.register_sale_with_shipping(date, uuid, integer, numeric, numeric, text, numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_pos_sale_with_shipping(jsonb, text, text, uuid, numeric, numeric, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_attributed_sale_with_shipping(jsonb, text, text, uuid, numeric, date, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_sale_with_shipping(uuid, uuid, integer, numeric, numeric, text, text, text, date, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_pos_sale_with_shipping(uuid, jsonb, numeric, text, text, uuid, date, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_attributed_sale_with_shipping(uuid, jsonb, numeric, text, text, uuid, text, date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_quote_to_sale_with_shipping(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_quote_with_shipping(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_collected_shipping_report(date, date) TO authenticated;

COMMIT;
