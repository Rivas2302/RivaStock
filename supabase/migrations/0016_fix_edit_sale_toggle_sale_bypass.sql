-- 0016_fix_edit_sale_toggle_sale_bypass.sql
-- Agrega bypass_check a edit_sale y toggle_sale_status
-- Ya existe la función en 0002_rpcs.sql, solo se actualiza

BEGIN;

CREATE OR REPLACE FUNCTION edit_sale(
  p_sale_id            uuid,
  p_new_product_id     uuid,
  p_new_quantity       int,
  p_new_unit_price     numeric,
  p_new_adjustment     numeric,
  p_new_status         text,
  p_new_payment_method text DEFAULT NULL,
  p_new_client         text DEFAULT NULL,
  p_new_date           date DEFAULT NULL
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_sale     sales%ROWTYPE;
  v_new_prod products%ROWTYPE;
  v_new_total numeric;
  v_new_desc  text;
  v_cf_id     uuid;
  v_updated   sales%ROWTYPE;
  v_new_name  text;
  -- customer ledger
  v_sale_tx   customer_transactions%ROWTYPE;
  v_old_contribution numeric;
  v_new_contribution numeric;
  v_delta     numeric;
  v_pay_tx    customer_transactions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_sale
    FROM sales
   WHERE id = p_sale_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  -- ── Stock management ──────────────────────────────────
  IF v_sale.product_id IS DISTINCT FROM p_new_product_id THEN
    UPDATE products
       SET stock = stock + v_sale.quantity, updated_at = now()
     WHERE id = v_sale.product_id AND user_id = v_uid;

    SELECT * INTO v_new_prod
      FROM products
     WHERE id = p_new_product_id AND user_id = v_uid
     FOR UPDATE;
    IF NOT FOUND THEN
      UPDATE products
         SET stock = stock - v_sale.quantity, updated_at = now()
       WHERE id = v_sale.product_id AND user_id = v_uid;
      RAISE EXCEPTION 'Producto destino no encontrado';
    END IF;
    IF v_new_prod.stock < p_new_quantity THEN
      UPDATE products
         SET stock = stock - v_sale.quantity, updated_at = now()
       WHERE id = v_sale.product_id AND user_id = v_uid;
      RAISE EXCEPTION 'Stock insuficiente en el producto destino. Disponible: %',
        v_new_prod.stock;
    END IF;
    UPDATE products
       SET stock = stock - p_new_quantity, updated_at = now()
     WHERE id = p_new_product_id;
  ELSE
    SELECT * INTO v_new_prod
      FROM products
     WHERE id = p_new_product_id AND user_id = v_uid
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_new_prod.stock + v_sale.quantity < p_new_quantity THEN
      RAISE EXCEPTION 'Stock insuficiente. Disponible efectivo: %',
        v_new_prod.stock + v_sale.quantity;
    END IF;
    UPDATE products
       SET stock = stock + v_sale.quantity - p_new_quantity, updated_at = now()
     WHERE id = p_new_product_id;
  END IF;

  v_new_name  := (SELECT name FROM products WHERE id = p_new_product_id AND user_id = v_uid);
  v_new_total := (p_new_quantity * p_new_unit_price) + p_new_adjustment;
  v_new_desc  := _sale_description(v_new_name, p_new_quantity);

  -- ── Cash flow management ──────────────────────────────
  PERFORM set_config('app.bypass_check', 'rpc', true);

  SELECT id INTO v_cf_id
    FROM cash_flow
   WHERE sale_id = p_sale_id AND user_id = v_uid
   LIMIT 1;

  IF v_sale.status = 'Pagado' AND p_new_status = 'Pagado' THEN
    IF v_cf_id IS NOT NULL THEN
      UPDATE cash_flow
         SET date           = COALESCE(p_new_date, v_sale.date),
             description    = v_new_desc,
             amount         = v_new_total,
             payment_method = COALESCE(p_new_payment_method, 'Efectivo')
       WHERE id = v_cf_id;
    ELSE
      INSERT INTO cash_flow (
        id, user_id, date, type, source, description, category,
        amount, payment_method, status, sale_id, created_at
      ) VALUES (
        gen_random_uuid(), v_uid, COALESCE(p_new_date, v_sale.date),
        'Ingreso', 'Venta', v_new_desc, 'Venta Externa',
        v_new_total, COALESCE(p_new_payment_method, 'Efectivo'), 'Pagado',
        p_sale_id, now()
      );
    END IF;
  ELSIF v_sale.status = 'Pagado' AND p_new_status <> 'Pagado' THEN
    DELETE FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid;
  ELSIF v_sale.status <> 'Pagado' AND p_new_status = 'Pagado' THEN
    INSERT INTO cash_flow (
      id, user_id, date, type, source, description, category,
      amount, payment_method, status, sale_id, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, COALESCE(p_new_date, v_sale.date),
      'Ingreso', 'Venta', v_new_desc, 'Venta Externa',
      v_new_total, COALESCE(p_new_payment_method, 'Efectivo'), 'Pagado',
      p_sale_id, now()
    );
  END IF;

  -- ── Customer ledger sync ──────────────────────────────
  SELECT * INTO v_sale_tx
    FROM customer_transactions
   WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'sale'
   LIMIT 1 FOR UPDATE;

  IF v_sale_tx.id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_old_contribution
      FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid;

    UPDATE customer_transactions
       SET amount      = v_new_total,
           description = v_new_desc,
           date        = COALESCE(p_new_date, v_sale.date)
     WHERE id = v_sale_tx.id;

    IF p_new_status = 'Pagado' THEN
      SELECT * INTO v_pay_tx
        FROM customer_transactions
       WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment'
       LIMIT 1;

      IF v_pay_tx.id IS NOT NULL THEN
        UPDATE customer_transactions
           SET amount         = -v_new_total,
               description    = 'Cobro de ' || v_new_desc,
               payment_method = COALESCE(p_new_payment_method,
                                         v_pay_tx.payment_method, 'Efectivo')
         WHERE id = v_pay_tx.id;
        DELETE FROM customer_transactions
         WHERE related_sale_id = p_sale_id AND user_id = v_uid
           AND type = 'payment' AND id <> v_pay_tx.id;
      ELSE
        INSERT INTO customer_transactions (
          id, user_id, customer_id, type, amount, description,
          payment_method, related_sale_id, date, created_at
        ) VALUES (
          gen_random_uuid(), v_uid, v_sale_tx.customer_id,
          'payment', -v_new_total, 'Cobro de ' || v_new_desc,
          COALESCE(p_new_payment_method, 'Efectivo'),
          p_sale_id, CURRENT_DATE, now()
        );
      END IF;
    ELSE
      DELETE FROM customer_transactions
       WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_new_contribution
      FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid;

    v_delta := v_new_contribution - v_old_contribution;
    IF v_delta <> 0 THEN
      UPDATE customers
         SET current_balance = current_balance + v_delta, updated_at = now()
       WHERE id = v_sale_tx.customer_id AND user_id = v_uid;
    END IF;
  END IF;

  -- ── Update sale row ───────────────────────────────────
  UPDATE sales
     SET date           = COALESCE(p_new_date, date),
         product_id     = p_new_product_id,
         product_name   = v_new_name,
         unit_price     = p_new_unit_price,
         quantity       = p_new_quantity,
         adjustment     = p_new_adjustment,
         total          = v_new_total,
         status         = p_new_status,
         payment_method = p_new_payment_method,
         client         = p_new_client
   WHERE id = p_sale_id
   RETURNING * INTO v_updated;

  RETURN NEXT v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION toggle_sale_status(
  p_sale_id    uuid,
  p_new_status text
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_sale    sales%ROWTYPE;
  v_updated sales%ROWTYPE;
  v_desc    text;
  v_sale_tx customer_transactions%ROWTYPE;
  v_old_contribution numeric;
  v_new_contribution numeric;
  v_delta   numeric;
  v_pay_tx  customer_transactions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_sale
    FROM sales
   WHERE id = p_sale_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  v_desc := _sale_description(v_sale.product_name, v_sale.quantity);

  UPDATE sales
     SET status         = p_new_status,
         payment_method = COALESCE(payment_method, 'Efectivo')
   WHERE id = p_sale_id
   RETURNING * INTO v_updated;

  -- ── Cash flow ─────────────────────────────────────────
  PERFORM set_config('app.bypass_check', 'rpc', true);
  IF p_new_status = 'Pagado' AND v_sale.status <> 'Pagado' THEN
    IF NOT EXISTS (
      SELECT 1 FROM cash_flow
       WHERE sale_id = p_sale_id AND user_id = v_uid
    ) THEN
      INSERT INTO cash_flow (
        id, user_id, date, type, source, description, category,
        amount, payment_method, status, sale_id, created_at
      ) VALUES (
        gen_random_uuid(), v_uid, v_sale.date,
        'Ingreso', 'Venta', v_desc, 'Venta Externa',
        v_sale.total, COALESCE(v_sale.payment_method, 'Efectivo'), 'Pagado',
        p_sale_id, now()
      );
    END IF;
  ELSIF p_new_status <> 'Pagado' AND v_sale.status = 'Pagado' THEN
    DELETE FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid;
  END IF;

  -- ── Customer ledger sync ──────────────────────────────
  SELECT * INTO v_sale_tx
    FROM customer_transactions
   WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'sale'
   LIMIT 1 FOR UPDATE;

  IF v_sale_tx.id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_old_contribution
      FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid;

    IF p_new_status = 'Pagado' AND v_sale.status <> 'Pagado' THEN
      SELECT * INTO v_pay_tx
        FROM customer_transactions
       WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment'
       LIMIT 1;

      IF v_pay_tx.id IS NOT NULL THEN
        UPDATE customer_transactions
           SET amount = -v_sale.total,
               payment_method = COALESCE(v_sale.payment_method, 'Efectivo')
         WHERE id = v_pay_tx.id;
        DELETE FROM customer_transactions
         WHERE related_sale_id = p_sale_id AND user_id = v_uid
           AND type = 'payment' AND id <> v_pay_tx.id;
      ELSE
        INSERT INTO customer_transactions (
          id, user_id, customer_id, type, amount, description,
          payment_method, related_sale_id, date, created_at
        ) VALUES (
          gen_random_uuid(), v_uid, v_sale_tx.customer_id,
          'payment', -v_sale.total, 'Cobro de ' || v_desc,
          COALESCE(v_sale.payment_method, 'Efectivo'),
          p_sale_id, CURRENT_DATE, now()
        );
      END IF;
    ELSIF p_new_status <> 'Pagado' AND v_sale.status = 'Pagado' THEN
      DELETE FROM customer_transactions
       WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_new_contribution
      FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid;

    v_delta := v_new_contribution - v_old_contribution;
    IF v_delta <> 0 THEN
      UPDATE customers
         SET current_balance = current_balance + v_delta, updated_at = now()
       WHERE id = v_sale_tx.customer_id AND user_id = v_uid;
    END IF;
  END IF;

  RETURN NEXT v_updated;
END;
$$;

COMMIT;