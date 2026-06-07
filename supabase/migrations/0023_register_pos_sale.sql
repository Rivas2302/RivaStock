-- 0023_register_pos_sale.sql
-- POS multi-item sale RPC. Mirrors the collaborator-aware pattern from 0020
-- (get_owner_uid + has_permission). Locks all referenced products FOR UPDATE,
-- validates stock unless p_allow_oversell=true, writes a sale with items JSONB
-- compatible with the existing format (see convert_quote_to_sale).

BEGIN;

CREATE OR REPLACE FUNCTION register_pos_sale(
  p_items            jsonb,     -- [{ productId, quantity, unitPrice, lineDiscount? }]
  p_payment_method   text,      -- nullable when status='Pendiente'
  p_status           text,      -- 'Pagado' | 'Pendiente'
  p_customer_id      uuid,      -- nullable; required when status='Pendiente'
  p_adjustment_total numeric,   -- global discount/surcharge (can be negative)
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

  -- ── 1. Lock + validate every product
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

  -- ── 2. Deduct stock + build items array + accumulate totals
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

  -- ── 3. Insert sale
  INSERT INTO sales (
    id, user_id, date,
    product_id, product_name, unit_price, quantity, adjustment, total,
    status, payment_method, client, items, created_at
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
    v_items_out, now()
  ) RETURNING * INTO v_sale;

  -- ── 4. Cash flow (only on Pagado & not credit)
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

  -- ── 5. Customer ledger (credit sale)
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

REVOKE ALL ON FUNCTION register_pos_sale(jsonb, text, text, uuid, numeric, date, boolean) FROM public;
GRANT EXECUTE ON FUNCTION register_pos_sale(jsonb, text, text, uuid, numeric, date, boolean) TO authenticated;

COMMIT;
