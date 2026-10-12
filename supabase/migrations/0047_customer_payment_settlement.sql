-- Atomic account receipts, FIFO invoice settlement and immutable financial history.
-- No historic cash receipt is recreated or deleted. Historic payments are assigned
-- during reconciliation or the next account receipt, preserving ledger totals.
BEGIN;

CREATE TABLE customer_financial_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, idempotency_key)
);
ALTER TABLE customer_financial_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_financial_commands FROM PUBLIC, anon, authenticated;
ALTER TABLE customer_transactions ADD COLUMN financial_command_id uuid REFERENCES customer_financial_commands(id);
ALTER TABLE customer_transactions ADD COLUMN account_payment boolean NOT NULL DEFAULT false;
ALTER TABLE cash_flow ADD COLUMN financial_command_id uuid REFERENCES customer_financial_commands(id);
CREATE INDEX customer_tx_command_idx ON customer_transactions(financial_command_id);

-- Internal: all caller RPCs lock sales first, then the customer, before entering.
CREATE FUNCTION allocate_customer_receipts(p_customer_id uuid, p_user_id uuid, p_sale_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_payment customer_transactions%ROWTYPE;
  v_sale record;
  v_left numeric;
  v_part numeric;
  v_guard text := current_setting('app.finance_write', true);
BEGIN
  PERFORM set_config('app.finance_write', 'rpc', true);
  FOR v_payment IN SELECT * FROM customer_transactions
    WHERE customer_id = p_customer_id AND user_id = p_user_id
      AND type = 'payment' AND amount < 0 AND related_sale_id IS NULL
    ORDER BY date, created_at, id FOR UPDATE
  LOOP
    v_left := -v_payment.amount;
    FOR v_sale IN
      SELECT s.id, GREATEST(0, sum(t.amount)) AS remaining
      FROM sales s JOIN customer_transactions t ON t.related_sale_id = s.id
      WHERE s.user_id = p_user_id AND t.user_id = p_user_id
        AND t.customer_id = p_customer_id AND t.type IN ('sale', 'payment')
        AND s.status IN ('Pendiente', 'No Pagado')
        AND (p_sale_id IS NULL OR s.id = p_sale_id)
      GROUP BY s.id, s.date, s.created_at
      HAVING sum(t.amount) > 0
      ORDER BY s.date, s.created_at, s.id
    LOOP
      EXIT WHEN v_left <= 0;
      PERFORM assert_attributed_sale_access(v_sale.id, p_user_id);
      v_part := LEAST(v_left, v_sale.remaining);
      INSERT INTO customer_transactions (user_id, customer_id, type, amount, description,
        payment_method, related_sale_id, date, created_at, financial_command_id, account_payment)
      VALUES (p_user_id, p_customer_id, 'payment', -v_part, v_payment.description,
        v_payment.payment_method, v_sale.id, v_payment.date, v_payment.created_at,
        v_payment.financial_command_id, true);
      v_left := v_left - v_part;
      IF v_part = v_sale.remaining THEN
        UPDATE sales SET status = 'Pagado', payment_method = v_payment.payment_method WHERE id = v_sale.id;
      END IF;
    END LOOP;
    IF v_left = 0 THEN DELETE FROM customer_transactions WHERE id = v_payment.id;
    ELSE UPDATE customer_transactions SET amount = -v_left, account_payment = true WHERE id = v_payment.id;
    END IF;
  END LOOP;
  -- Repair a stale status even if the invoice already has linked payments.
  FOR v_sale IN SELECT s.id FROM sales s
  WHERE s.user_id = p_user_id AND s.status IN ('Pendiente', 'No Pagado')
    AND (p_sale_id IS NULL OR s.id = p_sale_id)
    AND EXISTS (SELECT 1 FROM customer_transactions t WHERE t.related_sale_id = s.id
      AND t.user_id = p_user_id AND t.customer_id = p_customer_id AND t.type = 'sale')
    AND (SELECT sum(t.amount) FROM customer_transactions t WHERE t.related_sale_id = s.id
      AND t.user_id = p_user_id AND t.customer_id = p_customer_id AND t.type IN ('sale','payment')) <= 0
  LOOP
    PERFORM assert_attributed_sale_access(v_sale.id, p_user_id);
    UPDATE sales SET status = 'Pagado' WHERE id = v_sale.id;
  END LOOP;
  PERFORM set_config('app.finance_write', COALESCE(v_guard, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION allocate_customer_receipts(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION register_customer_payment_v2(
  p_customer_id uuid, p_amount numeric, p_payment_method text, p_description text,
  p_idempotency_key text, p_sale_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_customer customers%ROWTYPE;
  v_existing customer_financial_commands%ROWTYPE;
  v_payload jsonb;
  v_command uuid;
  v_remaining numeric;
  v_tx record;
  v_guard text := current_setting('app.finance_write', true);
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_owner := get_owner_uid(v_actor);
  IF NOT has_permission(v_actor, 'clientes', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar pagos de cliente';
  END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_amount <= 0 OR round(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'Monto inválido: usá un importe positivo con hasta dos decimales';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Otro')
    OR p_description IS NULL OR btrim(p_description) = ''
    OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'Datos del cobro incompletos';
  END IF;
  v_payload := jsonb_build_object('customer', p_customer_id, 'amount', p_amount,
    'method', p_payment_method, 'description', btrim(p_description), 'sale', p_sale_id, 'kind', 'payment');
  -- Serialize the command before replay checking. No retry can duplicate money.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_idempotency_key, 0));
  SELECT * INTO v_existing FROM customer_financial_commands
    WHERE user_id = v_owner AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payload <> v_payload THEN RAISE EXCEPTION 'Clave de cobro reutilizada con otros datos'; END IF;
    RETURN;
  END IF;
  -- Match the sale RPCs' sale-before-customer lock order, avoiding lock inversion.
  PERFORM s.id FROM sales s WHERE s.user_id = v_owner AND EXISTS (
    SELECT 1 FROM customer_transactions t WHERE t.related_sale_id = s.id
      AND t.user_id = v_owner AND t.customer_id = p_customer_id AND t.type = 'sale'
  ) ORDER BY s.id FOR UPDATE;
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  IF p_sale_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM customer_transactions WHERE customer_id = p_customer_id
      AND user_id = v_owner AND type = 'payment' AND amount < 0 AND related_sale_id IS NULL) THEN
      RAISE EXCEPTION 'Hay cobros anteriores sin asignar. Conciliá la cuenta antes de cobrar esta venta.';
    END IF;
    SELECT sum(t.amount) INTO v_remaining FROM customer_transactions t JOIN sales s ON s.id = t.related_sale_id
    WHERE t.related_sale_id = p_sale_id AND t.user_id = v_owner AND t.customer_id = p_customer_id
      AND t.type IN ('sale', 'payment') AND s.status IN ('Pendiente', 'No Pagado');
    IF v_remaining IS NULL OR v_remaining <= 0 OR p_amount > v_remaining THEN
      RAISE EXCEPTION 'La venta no tiene ese importe pendiente para este cliente';
    END IF;
    PERFORM assert_attributed_sale_access(p_sale_id, v_owner);
  END IF;
  INSERT INTO customer_financial_commands(user_id, customer_id, idempotency_key, payload)
  VALUES (v_owner, p_customer_id, p_idempotency_key, v_payload) RETURNING id INTO v_command;
  PERFORM set_config('app.finance_write', 'rpc', true);
  INSERT INTO customer_transactions(user_id, customer_id, type, amount, description,
    payment_method, date, financial_command_id, account_payment)
  VALUES (v_owner, p_customer_id, 'payment', -p_amount, btrim(p_description),
    p_payment_method, CURRENT_DATE, v_command, true);
  -- Allocate existing credit before the new receipt. Only this command creates cash.
  PERFORM allocate_customer_receipts(p_customer_id, v_owner, p_sale_id);
  FOR v_tx IN SELECT related_sale_id, -sum(amount) AS collected FROM customer_transactions
    WHERE financial_command_id = v_command GROUP BY related_sale_id
  LOOP
    INSERT INTO cash_flow(user_id, date, type, source, description, category, amount,
      payment_method, status, sale_id, financial_command_id)
    VALUES (v_owner, CURRENT_DATE, 'Ingreso', 'Venta', 'Cobro cuenta corriente: ' || v_customer.name,
      'Cuenta Corriente', v_tx.collected, p_payment_method, 'Pagado', v_tx.related_sale_id, v_command);
  END LOOP;
  UPDATE customers SET current_balance = current_balance - p_amount, updated_at = now() WHERE id = p_customer_id;
  PERFORM set_config('app.finance_write', COALESCE(v_guard, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION register_customer_payment_v2(uuid,numeric,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION register_customer_payment_v2(uuid,numeric,text,text,text,uuid) TO authenticated;

-- Old callers still receive the corrected transactional behavior.
CREATE OR REPLACE FUNCTION register_customer_payment(p_customer_id uuid, p_amount numeric,
  p_payment_method text, p_description text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM register_customer_payment_v2(p_customer_id, p_amount, p_payment_method,
    p_description, 'legacy:' || gen_random_uuid()::text);
END;
$$;

CREATE FUNCTION register_customer_adjustment(p_customer_id uuid, p_amount numeric,
  p_description text, p_idempotency_key text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_payload jsonb;
  v_existing customer_financial_commands%ROWTYPE;
  v_command uuid;
  v_balance numeric;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_owner := get_owner_uid(v_actor);
  IF NOT has_permission(v_actor, 'clientes', 'write') THEN RAISE EXCEPTION 'Sin permiso para ajustar saldo'; END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount = 0
    OR round(p_amount,2) <> p_amount OR p_description IS NULL OR btrim(p_description) = ''
    OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'Datos del ajuste inválidos';
  END IF;
  v_payload := jsonb_build_object('kind','adjustment','customer',p_customer_id,'amount',p_amount,'description',btrim(p_description));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_idempotency_key, 0));
  SELECT * INTO v_existing FROM customer_financial_commands WHERE user_id = v_owner AND idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing.payload <> v_payload THEN RAISE EXCEPTION 'Clave de ajuste reutilizada con otros datos'; END IF;
  SELECT current_balance INTO v_balance FROM customers WHERE id = p_customer_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  IF v_existing.id IS NOT NULL THEN RETURN v_balance; END IF;
  INSERT INTO customer_financial_commands(user_id,customer_id,idempotency_key,payload)
    VALUES(v_owner,p_customer_id,p_idempotency_key,v_payload) RETURNING id INTO v_command;
  INSERT INTO customer_transactions(user_id,customer_id,type,amount,description,date,financial_command_id)
    VALUES(v_owner,p_customer_id,'adjustment',p_amount,btrim(p_description),CURRENT_DATE,v_command);
  UPDATE customers SET current_balance = current_balance + p_amount, updated_at = now()
    WHERE id = p_customer_id RETURNING current_balance INTO v_balance;
  RETURN v_balance;
END;
$$;
REVOKE ALL ON FUNCTION register_customer_adjustment(uuid,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION register_customer_adjustment(uuid,numeric,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION reconcile_customer_balance(p_customer_id uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid; v_balance numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_owner := get_owner_uid(auth.uid());
  IF NOT has_permission(auth.uid(), 'clientes', 'write') THEN RAISE EXCEPTION 'Sin permiso para conciliar saldo'; END IF;
  PERFORM s.id FROM sales s WHERE s.user_id = v_owner AND EXISTS (
    SELECT 1 FROM customer_transactions t WHERE t.related_sale_id = s.id
      AND t.customer_id = p_customer_id AND t.user_id = v_owner AND t.type = 'sale'
  ) ORDER BY s.id FOR UPDATE;
  PERFORM id FROM customers WHERE id = p_customer_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  PERFORM allocate_customer_receipts(p_customer_id, v_owner);
  SELECT COALESCE(sum(amount), 0) INTO v_balance FROM customer_transactions
    WHERE customer_id = p_customer_id AND user_id = v_owner;
  UPDATE customers SET current_balance = v_balance, updated_at = now() WHERE id = p_customer_id;
  RETURN v_balance;
END;
$$;

CREATE FUNCTION protect_account_payment_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (OLD.account_payment OR OLD.financial_command_id IS NOT NULL)
    AND current_setting('app.finance_write',true) IS DISTINCT FROM 'rpc' THEN
    RAISE EXCEPTION 'El movimiento está protegido. No se puede borrar ni reescribir su historial de pagos.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_account_payment_history BEFORE UPDATE OR DELETE ON customer_transactions
FOR EACH ROW EXECUTE FUNCTION protect_account_payment_history();

CREATE FUNCTION protect_settled_sale() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'Pagado'
    AND current_setting('app.finance_write',true) IS DISTINCT FROM 'rpc'
    AND EXISTS (SELECT 1 FROM customer_transactions WHERE related_sale_id = OLD.id AND type = 'sale') THEN
    RAISE EXCEPTION 'Las ventas de cuenta corriente se cobran desde la ficha del cliente, no cambiando su estado.';
  END IF;
  IF current_setting('app.finance_write',true) IS DISTINCT FROM 'rpc' AND EXISTS (
    SELECT 1 FROM customer_transactions WHERE related_sale_id = OLD.id AND account_payment
  ) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'La venta tiene cobros registrados. No se puede eliminar.'; END IF;
    IF (NEW.total, NEW.status, NEW.items, NEW.product_id, NEW.quantity, NEW.date, NEW.payment_method)
      IS DISTINCT FROM (OLD.total, OLD.status, OLD.items, OLD.product_id, OLD.quantity, OLD.date, OLD.payment_method) THEN
      RAISE EXCEPTION 'La venta tiene cobros registrados. No se puede reescribir ni volver a cobrar.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_settled_sale BEFORE UPDATE OR DELETE ON sales
FOR EACH ROW EXECUTE FUNCTION protect_settled_sale();

CREATE OR REPLACE FUNCTION block_sale_cashflow_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.source = 'Venta' OR OLD.sale_id IS NOT NULL OR OLD.financial_command_id IS NOT NULL)
    AND current_setting('app.bypass_check',true) IS DISTINCT FROM 'rpc'
    AND current_setting('app.finance_write',true) IS DISTINCT FROM 'rpc' THEN
    RAISE EXCEPTION 'El cobro se gestiona desde la venta o cuenta corriente, no desde Caja.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION block_sale_cashflow_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.source = 'Venta' OR OLD.sale_id IS NOT NULL OR OLD.financial_command_id IS NOT NULL)
    AND current_setting('app.bypass_check',true) IS DISTINCT FROM 'rpc'
    AND current_setting('app.finance_write',true) IS DISTINCT FROM 'rpc' THEN
    RAISE EXCEPTION 'El cobro se gestiona desde la venta o cuenta corriente, no desde Caja.';
  END IF;
  RETURN OLD;
END;
$$;
-- Partial receipts recognize proportional cost, not the full invoice cost.
CREATE OR REPLACE FUNCTION refresh_sale_cash_flow_allocations(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_cash cash_flow%ROWTYPE;
  v_share record;
  v_share_count integer;
  v_share_index integer;
  v_cash_count integer;
  v_cash_index integer := 0;
  v_total_cash numeric;
  v_total_revenue numeric;
  v_remaining_amount numeric;
  v_remaining_costs jsonb := '{}'::jsonb;
  v_amount numeric;
  v_cost_amount numeric;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN RETURN; END IF;

  UPDATE cash_flow_allocations
  SET reversed_at = now(), reversal_reason = 'finance_refresh'
  WHERE user_id = v_sale.user_id
    AND sale_id_snapshot = v_sale.id
    AND reversed_at IS NULL;

  SELECT count(*), COALESCE(sum(revenue), 0)
  INTO v_share_count, v_total_revenue
  FROM (
    SELECT inventory_owner_id_snapshot, sum(revenue_share) AS revenue
    FROM sale_item_allocations
    WHERE user_id = v_sale.user_id
      AND sale_id_snapshot = v_sale.id
      AND reversed_at IS NULL
    GROUP BY inventory_owner_id_snapshot
  ) owner_shares;

  IF v_share_count = 0 THEN RETURN; END IF;

  SELECT count(*), COALESCE(sum(amount), 0)
  INTO v_cash_count, v_total_cash
  FROM cash_flow
  WHERE user_id = v_sale.user_id AND sale_id = v_sale.id;

  SELECT COALESCE(jsonb_object_agg(inventory_owner_id_snapshot::text, cost), '{}'::jsonb)
  INTO v_remaining_costs
  FROM (
    SELECT inventory_owner_id_snapshot, round(sum(cost_share) * LEAST(1, COALESCE(v_total_cash / NULLIF(v_sale.total, 0), 0)), 2) AS cost
    FROM sale_item_allocations
    WHERE user_id = v_sale.user_id
      AND sale_id_snapshot = v_sale.id
      AND reversed_at IS NULL
    GROUP BY inventory_owner_id_snapshot
  ) owner_costs;

  FOR v_cash IN
    SELECT * FROM cash_flow
    WHERE user_id = v_sale.user_id AND sale_id = v_sale.id
    ORDER BY id
  LOOP
    v_cash_index := v_cash_index + 1;
    v_remaining_amount := round(v_cash.amount, 2);
    v_share_index := 0;

    FOR v_share IN
      SELECT
        allocation.inventory_owner_id,
        allocation.inventory_owner_id_snapshot,
        min(allocation.inventory_owner_name_snapshot) AS owner_name,
        sum(allocation.revenue_share) AS revenue,
        sum(allocation.cost_share) AS cost,
        min(allocation.actor_uid::text)::uuid AS actor_uid,
        min(allocation.allocation_source) AS snapshot_source,
        min(allocation.snapshot_reason) AS snapshot_reason
      FROM sale_item_allocations allocation
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
        ELSE round(v_cash.amount * v_share.revenue / v_total_revenue, 2)
      END;
      v_remaining_amount := round(v_remaining_amount - v_amount, 2);
      v_cost_amount := CASE
        WHEN v_cash_index = v_cash_count
          THEN COALESCE((v_remaining_costs->>v_share.inventory_owner_id_snapshot::text)::numeric, 0)
        WHEN v_total_cash = 0 THEN 0
        ELSE round(v_share.cost * v_cash.amount / NULLIF(v_sale.total, 0), 2)
      END;
      v_remaining_costs := jsonb_set(
        v_remaining_costs,
        ARRAY[v_share.inventory_owner_id_snapshot::text],
        to_jsonb(round(
          COALESCE((v_remaining_costs->>v_share.inventory_owner_id_snapshot::text)::numeric, 0)
          - v_cost_amount,
          2
        ))
      );

      INSERT INTO cash_flow_allocations (
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

-- Preserve the existing product-lock wrapper while fixing its legacy worker.
CREATE OR REPLACE FUNCTION register_sale_unlocked(
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

  -- A paid customer invoice must not leave a debt in the account ledger.
  IF p_customer_id IS NOT NULL AND p_status = 'Pagado' THEN
    INSERT INTO customer_transactions(user_id,customer_id,type,amount,description,payment_method,related_sale_id,date)
    VALUES(v_uid,p_customer_id,'payment',-v_total,'Cobro de venta',COALESCE(p_payment_method,'Efectivo'),v_sale.id,p_date);
    UPDATE customers SET current_balance=current_balance-v_total,updated_at=now() WHERE id=p_customer_id;
    INSERT INTO cash_flow(user_id,date,type,source,description,category,amount,payment_method,status,sale_id)
    VALUES(v_uid,p_date,'Ingreso','Venta','Cobro de venta','Cuenta Corriente',v_total,COALESCE(p_payment_method,'Efectivo'),'Pagado',v_sale.id);
  END IF;

  RETURN NEXT v_sale;
END;
$$;

COMMIT;
