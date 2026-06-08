-- 0026_edit_pos_sale.sql
-- New RPC to edit a multi-item POS sale.
-- Restores stock for old items, validates/applies new items, updates totals,
-- handles cash_flow + customer_transactions like edit_sale does.

BEGIN;

CREATE OR REPLACE FUNCTION edit_pos_sale(
  p_sale_id            uuid,
  p_new_items          jsonb,     -- [{ productId, quantity, unitPrice, lineDiscount }]
  p_new_adjustment     numeric,
  p_new_status         text,
  p_new_payment_method text,
  p_new_customer_id    uuid,
  p_new_date           date
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_uid        uuid;
  v_sale       sales%ROWTYPE;
  v_i          int;
  v_len        int;
  v_item       jsonb;
  v_pid        uuid;
  v_qty        int;
  v_uprice     numeric;
  v_ldisc      numeric;
  v_prod       products%ROWTYPE;
  v_pname      text;
  v_items_out  jsonb := '[]'::jsonb;
  v_lines_sum  numeric := 0;
  v_new_total  numeric;
  v_first_pid  uuid;
  v_first_name text;
  v_disp_name  text;
  v_desc       text;
  v_old_qty_by_pid  jsonb;
  v_new_qty_by_pid  jsonb;
  v_key        text;
  v_old_qty    int;
  v_new_qty    int;
  v_delta      int;
  v_cf_id      uuid;
  v_sale_tx    customer_transactions%ROWTYPE;
  v_pay_tx     customer_transactions%ROWTYPE;
  v_old_contribution numeric;
  v_new_contribution numeric;
  v_delta_amount numeric;
  v_updated    sales%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para editar ventas';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  IF v_sale.source <> 'pos' THEN
    RAISE EXCEPTION 'Esta venta no es del POS';
  END IF;

  IF p_new_items IS NULL OR jsonb_typeof(p_new_items) <> 'array' THEN
    RAISE EXCEPTION 'Items inválidos';
  END IF;
  v_len := jsonb_array_length(p_new_items);
  IF v_len = 0 THEN RAISE EXCEPTION 'La venta debe tener al menos un ítem'; END IF;

  IF p_new_status NOT IN ('Pagado','Pendiente') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_new_status;
  END IF;
  IF p_new_status = 'Pendiente' AND p_new_customer_id IS NULL THEN
    RAISE EXCEPTION 'Cuenta corriente requiere cliente';
  END IF;

  -- ── 1. Build old/new quantity maps per product
  v_old_qty_by_pid := COALESCE(v_sale.items, '[]'::jsonb);
  v_new_qty_by_pid := jsonb_build_object();

  FOR v_i IN 0..v_len-1 LOOP
    v_item := p_new_items->v_i;
    v_pid  := (v_item->>'productId')::uuid;
    v_qty  := (v_item->>'quantity')::int;
    IF v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'Cantidad inválida en línea %', v_i + 1;
    END IF;
    v_new_qty_by_pid := v_new_qty_by_pid || jsonb_build_object(v_pid::text, v_qty);
  END LOOP;

  -- ── 2. Restore stock for items removed or reduced
  FOR v_key IN SELECT jsonb_object_keys(v_old_qty_by_pid) LOOP
    v_old_qty := (v_old_qty_by_pid->>v_key)::int;
    v_new_qty := COALESCE((v_new_qty_by_pid->>v_key)::int, 0);
    v_delta   := v_old_qty - v_new_qty;
    IF v_delta <> 0 THEN
      UPDATE products
         SET stock = stock + v_delta, updated_at = now()
       WHERE id = v_key::uuid AND user_id = v_uid;
    END IF;
  END LOOP;

  -- ── 3. Deduct stock for items added or increased + lock + validate
  FOR v_i IN 0..v_len-1 LOOP
    v_item   := p_new_items->v_i;
    v_pid    := (v_item->>'productId')::uuid;
    v_qty    := (v_item->>'quantity')::int;
    v_uprice := COALESCE((v_item->>'unitPrice')::numeric, 0);
    v_ldisc  := COALESCE((v_item->>'lineDiscount')::numeric, 0);

    v_new_qty := v_qty;
    v_old_qty := COALESCE((v_old_qty_by_pid->>v_pid::text)::int, 0);
    v_delta   := v_new_qty - v_old_qty;

    IF v_delta > 0 THEN
      SELECT * INTO v_prod
        FROM products WHERE id = v_pid AND user_id = v_uid FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_pid;
      END IF;
      IF v_prod.stock < v_delta THEN
        RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
          v_prod.name, v_prod.stock, v_delta;
      END IF;
      UPDATE products
         SET stock = stock - v_delta, updated_at = now()
       WHERE id = v_pid AND user_id = v_uid;
    END IF;

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

  v_new_total := v_lines_sum + COALESCE(p_new_adjustment, 0);

  v_first_pid := (p_new_items->0->>'productId')::uuid;
  SELECT name INTO v_first_name FROM products WHERE id = v_first_pid AND user_id = v_uid;
  v_disp_name := CASE WHEN v_len = 1 THEN v_first_name ELSE 'POS x' || v_len::text END;
  v_desc      := CASE WHEN v_len = 1
                    THEN 'Venta POS: ' || v_first_name
                    ELSE 'Venta POS (' || v_len::text || ' ítems)'
                  END;

  PERFORM set_config('app.bypass_check', 'rpc', true);

  -- ── 4. Cash flow (only on Pagado without credit customer)
  SELECT id INTO v_cf_id FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid LIMIT 1;

  IF p_new_status = 'Pagado' AND p_new_customer_id IS NULL THEN
    IF v_cf_id IS NOT NULL THEN
      UPDATE cash_flow SET
        date = COALESCE(p_new_date, v_sale.date), description = v_desc,
        amount = v_new_total, payment_method = COALESCE(p_new_payment_method, 'Efectivo')
        WHERE id = v_cf_id;
    ELSE
      INSERT INTO cash_flow (id, user_id, date, type, source, description, category, amount, payment_method, status, sale_id, created_at)
      VALUES (gen_random_uuid(), v_uid, COALESCE(p_new_date, v_sale.date), 'Ingreso', 'Venta', v_desc, 'Venta POS',
        v_new_total, COALESCE(p_new_payment_method, 'Efectivo'), 'Pagado', p_sale_id, now());
    END IF;
  ELSE
    DELETE FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid;
  END IF;

  -- ── 5. Customer ledger (credit sale)
  SELECT * INTO v_sale_tx FROM customer_transactions
    WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'sale' LIMIT 1 FOR UPDATE;

  IF v_sale_tx.id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_old_contribution
      FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid;
    UPDATE customer_transactions SET amount = v_new_total, description = v_desc, date = COALESCE(p_new_date, v_sale.date)
      WHERE id = v_sale_tx.id;
    IF p_new_status = 'Pagado' THEN
      SELECT * INTO v_pay_tx FROM customer_transactions
        WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment' LIMIT 1;
      IF v_pay_tx.id IS NOT NULL THEN
        UPDATE customer_transactions SET amount = -v_new_total, description = 'Cobro de ' || v_desc,
          payment_method = COALESCE(p_new_payment_method, v_pay_tx.payment_method, 'Efectivo')
          WHERE id = v_pay_tx.id;
        DELETE FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment' AND id <> v_pay_tx.id;
      ELSE
        INSERT INTO customer_transactions (id, user_id, customer_id, type, amount, description, payment_method, related_sale_id, date, created_at)
        VALUES (gen_random_uuid(), v_uid, v_sale_tx.customer_id, 'payment', -v_new_total, 'Cobro de ' || v_desc,
          COALESCE(p_new_payment_method, 'Efectivo'), p_sale_id, CURRENT_DATE, now());
      END IF;
    ELSE
      DELETE FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment';
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_new_contribution
      FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid;
    v_delta_amount := v_new_contribution - v_old_contribution;
    IF v_delta_amount <> 0 THEN
      UPDATE customers SET current_balance = current_balance + v_delta_amount, updated_at = now()
        WHERE id = v_sale_tx.customer_id AND user_id = v_uid;
    END IF;
  END IF;

  -- ── 6. Update the sale row
  UPDATE sales SET
    date = COALESCE(p_new_date, date),
    product_id  = v_first_pid,
    product_name = v_disp_name,
    unit_price  = CASE WHEN v_len = 1 THEN (p_new_items->0->>'unitPrice')::numeric ELSE v_new_total END,
    quantity    = CASE WHEN v_len = 1 THEN (p_new_items->0->>'quantity')::int      ELSE 1 END,
    adjustment  = COALESCE(p_new_adjustment, 0),
    total       = v_new_total,
    status      = p_new_status,
    payment_method = p_new_payment_method,
    client      = CASE
                    WHEN p_new_customer_id IS NOT NULL
                    THEN (SELECT name FROM customers WHERE id = p_new_customer_id AND user_id = v_uid)
                    ELSE client
                  END,
    items       = v_items_out
  WHERE id = p_sale_id RETURNING * INTO v_updated;

  RETURN NEXT v_updated;
END;
$$;

REVOKE ALL ON FUNCTION edit_pos_sale(uuid, jsonb, numeric, text, text, uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION edit_pos_sale(uuid, jsonb, numeric, text, text, uuid, date) TO authenticated;

COMMIT;
