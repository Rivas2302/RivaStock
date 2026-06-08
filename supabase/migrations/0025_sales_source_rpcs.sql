-- 0025_sales_source_rpcs.sql
-- Update existing RPCs (register_sale, register_pos_sale, convert_quote_to_sale)
-- to set the source column correctly.

BEGIN;

-- ─── register_sale: manual (classic single-item modal) ────────────────────────
CREATE OR REPLACE FUNCTION register_sale(
  p_date           date,
  p_product_id     uuid,
  p_quantity       int,
  p_unit_price     numeric,
  p_adjustment     numeric,
  p_status         text,
  p_payment_method text DEFAULT NULL,
  p_client         text DEFAULT NULL,
  p_customer_id    uuid DEFAULT NULL
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid    uuid;
  v_prod   products%ROWTYPE;
  v_total  numeric;
  v_sale_id uuid;
  v_desc   text;
  v_sale   sales%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar ventas';
  END IF;

  SELECT * INTO v_prod
    FROM products
   WHERE id = p_product_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  IF v_prod.stock < p_quantity THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponible: %, solicitado: %', v_prod.stock, p_quantity;
  END IF;

  v_total   := (p_quantity * p_unit_price) + p_adjustment;
  v_sale_id := gen_random_uuid();
  v_desc    := _sale_description(v_prod.name, p_quantity);

  INSERT INTO sales (
    id, user_id, date, product_id, product_name,
    unit_price, quantity, adjustment, total,
    status, payment_method, client, source, created_at
  ) VALUES (
    v_sale_id, v_uid, p_date, p_product_id, v_prod.name,
    p_unit_price, p_quantity, p_adjustment, v_total,
    p_status, p_payment_method, p_client, 'manual', now()
  ) RETURNING * INTO v_sale;

  UPDATE products SET stock = stock - p_quantity, updated_at = now() WHERE id = p_product_id;

  IF p_status = 'Pagado' AND p_customer_id IS NULL THEN
    INSERT INTO cash_flow (
      id, user_id, date, type, source, description, category,
      amount, payment_method, status, sale_id, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, p_date,
      'Ingreso', 'Venta', v_desc, 'Venta Externa',
      v_total, COALESCE(p_payment_method, 'Efectivo'), 'Pagado',
      v_sale_id, now()
    );
  END IF;

  IF p_customer_id IS NOT NULL THEN
    PERFORM id FROM customers WHERE id = p_customer_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
    INSERT INTO customer_transactions (
      id, user_id, customer_id, type, amount, description,
      related_sale_id, date, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, p_customer_id,
      'sale', v_total, v_desc,
      v_sale_id, p_date, now()
    );
    UPDATE customers SET current_balance = current_balance + v_total, updated_at = now()
      WHERE id = p_customer_id;
  END IF;

  RETURN NEXT v_sale;
END;
$$;

-- ─── register_pos_sale: POS multi-item ──────────────────────────────────────
-- Updated from 0023 to set source='pos'
CREATE OR REPLACE FUNCTION register_pos_sale(
  p_items            jsonb,
  p_payment_method   text,
  p_status           text,
  p_customer_id      uuid,
  p_adjustment_total numeric,
  p_date             date,
  p_allow_oversell   boolean
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_uid        uuid;
  v_i          int;
  v_len        int;
  v_item       jsonb;
  v_pid        uuid;
  v_qty        int;
  v_uprice     numeric;
  v_ldisc      numeric;
  v_prod       products%ROWTYPE;
  v_sale_id    uuid;
  v_sale       sales%ROWTYPE;
  v_items_out  jsonb := '[]'::jsonb;
  v_first_pid  uuid;
  v_first_name text;
  v_pname      text;
  v_lines_sum  numeric := 0;
  v_total      numeric;
  v_desc       text;
  v_disp_name  text;
  v_customer   customers%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar ventas';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Carrito inválido';
  END IF;
  v_len := jsonb_array_length(p_items);
  IF v_len = 0 THEN RAISE EXCEPTION 'El carrito está vacío'; END IF;
  IF p_status NOT IN ('Pagado','Pendiente') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;
  IF p_status = 'Pendiente' AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Cuenta corriente requiere cliente';
  END IF;

  FOR v_i IN 0..v_len-1 LOOP
    v_item := p_items->v_i;
    v_pid  := (v_item->>'productId')::uuid;
    v_qty  := (v_item->>'quantity')::int;

    IF v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'Cantidad inválida en línea %', v_i + 1;
    END IF;

    SELECT * INTO v_prod
      FROM products
     WHERE id = v_pid AND user_id = v_uid
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado: %',
        COALESCE(v_item->>'productName', v_pid::text);
    END IF;

    IF v_prod.stock < v_qty AND NOT p_allow_oversell THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
        v_prod.name, v_prod.stock, v_qty;
    END IF;
  END LOOP;

  FOR v_i IN 0..v_len-1 LOOP
    v_item   := p_items->v_i;
    v_pid    := (v_item->>'productId')::uuid;
    v_qty    := (v_item->>'quantity')::int;
    v_uprice := COALESCE((v_item->>'unitPrice')::numeric, 0);
    v_ldisc  := COALESCE((v_item->>'lineDiscount')::numeric, 0);

    UPDATE products
       SET stock = stock - v_qty, updated_at = now()
     WHERE id = v_pid AND user_id = v_uid;

    SELECT name INTO v_pname FROM products WHERE id = v_pid AND user_id = v_uid;

    v_lines_sum := v_lines_sum + (v_qty * (v_uprice - v_ldisc));

    v_items_out := v_items_out || jsonb_build_array(
      jsonb_build_object(
        'productId',   v_pid,
        'productName', v_pname,
        'quantity',    v_qty,
        'price',       v_uprice,
        'discount',    v_ldisc
      )
    );
  END LOOP;

  v_total     := v_lines_sum + COALESCE(p_adjustment_total, 0);
  v_sale_id   := gen_random_uuid();
  v_first_pid := (p_items->0->>'productId')::uuid;
  SELECT name INTO v_first_name FROM products WHERE id = v_first_pid AND user_id = v_uid;
  v_disp_name := CASE WHEN v_len = 1 THEN v_first_name ELSE 'POS x' || v_len::text END;
  v_desc      := CASE WHEN v_len = 1
                    THEN 'Venta POS: ' || v_first_name
                    ELSE 'Venta POS (' || v_len::text || ' ítems)'
                  END;

  INSERT INTO sales (
    id, user_id, date,
    product_id, product_name, unit_price, quantity, adjustment, total,
    status, payment_method, client, items, source, created_at
  ) VALUES (
    v_sale_id, v_uid, COALESCE(p_date, CURRENT_DATE),
    v_first_pid, v_disp_name,
    CASE WHEN v_len = 1 THEN (p_items->0->>'unitPrice')::numeric ELSE v_total END,
    CASE WHEN v_len = 1 THEN (p_items->0->>'quantity')::int      ELSE 1 END,
    COALESCE(p_adjustment_total, 0),
    v_total,
    p_status,
    p_payment_method,
    CASE
      WHEN p_customer_id IS NOT NULL
      THEN (SELECT name FROM customers WHERE id = p_customer_id AND user_id = v_uid)
      ELSE NULL
    END,
    v_items_out, 'pos', now()
  ) RETURNING * INTO v_sale;

  IF p_status = 'Pagado' AND p_customer_id IS NULL THEN
    INSERT INTO cash_flow (
      id, user_id, date, type, source, description, category,
      amount, payment_method, status, sale_id, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, COALESCE(p_date, CURRENT_DATE),
      'Ingreso', 'Venta', v_desc, 'Venta POS',
      v_total, COALESCE(p_payment_method, 'Efectivo'), 'Pagado',
      v_sale_id, now()
    );
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer
      FROM customers WHERE id = p_customer_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;

    INSERT INTO customer_transactions (
      id, user_id, customer_id, type, amount, description,
      related_sale_id, date, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, p_customer_id,
      'sale', v_total, v_desc,
      v_sale_id, COALESCE(p_date, CURRENT_DATE), now()
    );

    UPDATE customers
       SET current_balance = current_balance + v_total, updated_at = now()
     WHERE id = p_customer_id;
  END IF;

  RETURN NEXT v_sale;
END;
$$;

-- ─── convert_quote_to_sale: from quote ──────────────────────────────────────
-- Updated to set source='quote'
CREATE OR REPLACE FUNCTION convert_quote_to_sale(
  p_quote_id uuid
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_uid        uuid;
  v_quote      quotes%ROWTYPE;
  v_items      jsonb := '[]'::jsonb;
  v_i          int;
  v_item       jsonb;
  v_sale_id    uuid;
  v_sale       sales%ROWTYPE;
  v_total      numeric;
  v_disp_name  text;
  v_desc       text;
  v_client_id  uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar ventas';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presupuesto no encontrado'; END IF;

  IF v_quote.converted_to_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este presupuesto ya fue convertido a venta';
  END IF;

  -- Build items JSONB in the same shape as register_pos_sale
  IF v_quote.items IS NOT NULL AND jsonb_typeof(v_quote.items) = 'array' THEN
    FOR v_i IN 0..jsonb_array_length(v_quote.items)-1 LOOP
      v_item := v_quote.items->v_i;
      v_items := v_items || jsonb_build_array(
        jsonb_build_object(
          'productId',   v_item->>'productId',
          'productName', v_item->>'productName',
          'quantity',    (v_item->>'quantity')::int,
          'price',       (v_item->>'unitPrice')::numeric,
          'discount',    0
        )
      );
    END LOOP;
  END IF;

  v_total     := v_quote.total;
  v_sale_id   := gen_random_uuid();
  v_disp_name := CASE WHEN jsonb_array_length(v_items) = 1
                    THEN (v_items->0->>'productName')
                    ELSE 'Presupuesto ' || v_quote.number
                  END;
  v_desc      := 'Venta desde presupuesto ' || v_quote.number;
  v_client_id := NULLIF(v_quote.client_id, '')::uuid;

  INSERT INTO sales (
    id, user_id, date,
    product_id, product_name, unit_price, quantity, adjustment, total,
    status, payment_method, client, items, source, created_at
  ) VALUES (
    v_sale_id, v_uid, CURRENT_DATE,
    (v_items->0->>'productId')::uuid, v_disp_name,
    CASE WHEN jsonb_array_length(v_items) = 1 THEN (v_items->0->>'price')::numeric ELSE v_total END,
    CASE WHEN jsonb_array_length(v_items) = 1 THEN (v_items->0->>'quantity')::int  ELSE 1 END,
    0, v_total,
    'Pagado', NULL,
    v_quote.client_name,
    v_items, 'quote', now()
  ) RETURNING * INTO v_sale;

  UPDATE quotes SET converted_to_sale_id = v_sale_id, status = 'accepted', updated_at = now()
    WHERE id = p_quote_id;

  -- Cash flow entry
  INSERT INTO cash_flow (
    id, user_id, date, type, source, description, category,
    amount, payment_method, status, sale_id, created_at
  ) VALUES (
    gen_random_uuid(), v_uid, CURRENT_DATE,
    'Ingreso', 'Venta', v_desc, 'Presupuesto',
    v_total, 'Efectivo', 'Pagado', v_sale_id, now()
  );

  -- Customer ledger (if quote has a client)
  IF v_client_id IS NOT NULL THEN
    INSERT INTO customer_transactions (
      id, user_id, customer_id, type, amount, description,
      related_sale_id, date, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, v_client_id,
      'sale', v_total, v_desc, v_sale_id, CURRENT_DATE, now()
    );
    UPDATE customers SET current_balance = current_balance + v_total, updated_at = now()
      WHERE id = v_client_id;
  END IF;

  RETURN NEXT v_sale;
END;
$$;

COMMIT;
