-- 0011_reconcile_customer_balance.sql
-- RPC to reconcile customer.current_balance against actual transaction sum.

CREATE OR REPLACE FUNCTION reconcile_customer_balance(p_customer_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_balance numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM customer_transactions
    WHERE customer_id = p_customer_id AND user_id = v_uid;
  UPDATE customers SET current_balance = v_balance, updated_at = now()
    WHERE id = p_customer_id AND user_id = v_uid;
  RETURN v_balance;
END;
$$;
