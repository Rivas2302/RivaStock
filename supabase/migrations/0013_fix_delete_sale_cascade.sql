-- 0013_fix_delete_sale_cascade.sql
-- Fix delete_sale: set bypass_check before deleting cash_flow
-- so the trigger block_sale_cashflow_delete allows the operation.

CREATE OR REPLACE FUNCTION delete_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_sale  sales%ROWTYPE;
  v_item  jsonb;
  v_i     int;
  v_len   int;
  v_pid   uuid;
  v_qty   int;
  v_tx    customer_transactions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_sale
    FROM sales
   WHERE id = p_sale_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  -- ── Restore stock ─────────────────────────────────────
  IF v_sale.items IS NOT NULL AND jsonb_array_length(v_sale.items) > 0 THEN
    v_len := jsonb_array_length(v_sale.items);
    FOR v_i IN 0..v_len-1 LOOP
      v_item := v_sale.items->v_i;
      v_pid  := (v_item->>'productId')::uuid;
      v_qty  := (v_item->>'quantity')::int;
      UPDATE products
         SET stock = stock + v_qty, updated_at = now()
       WHERE id = v_pid AND user_id = v_uid;
    END LOOP;
  ELSE
    UPDATE products
       SET stock = stock + v_sale.quantity, updated_at = now()
     WHERE id = v_sale.product_id AND user_id = v_uid;
  END IF;

  -- ── Remove cash flow (bypass trigger lock) ────────────
  PERFORM set_config('app.bypass_check', 'rpc', true);
  DELETE FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid;

  -- ── Reverse customer balances ─────────────────────────
  FOR v_tx IN
    SELECT * FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid
  LOOP
    UPDATE customers
       SET current_balance = current_balance - v_tx.amount, updated_at = now()
     WHERE id = v_tx.customer_id AND user_id = v_uid;
  END LOOP;

  -- ── Delete customer transactions ──────────────────────
  DELETE FROM customer_transactions
   WHERE related_sale_id = p_sale_id AND user_id = v_uid;

  -- ── Delete sale ───────────────────────────────────────
  DELETE FROM sales WHERE id = p_sale_id AND user_id = v_uid;
END;
$$;
