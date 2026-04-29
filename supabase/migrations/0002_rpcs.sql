-- 0002_rpcs.sql
-- RivaStock: transactional RPCs for multi-table operations
-- All functions: SECURITY DEFINER, validate auth.uid(), stock with FOR UPDATE,
-- error messages in Spanish.

-- ────────────────────────────────────────────────────────
-- HELPER: description for a single-product sale
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _sale_description(p_name text, p_qty int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'Venta: ' || p_name || ' x' || p_qty::text;
$$;

-- ────────────────────────────────────────────────────────
-- 1. REGISTER_SALE
-- ────────────────────────────────────────────────────────
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
  v_uid  uuid := auth.uid();
  v_prod products%ROWTYPE;
  v_total numeric;
  v_sale_id uuid;
  v_desc text;
  v_sale sales%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_prod
    FROM products
   WHERE id = p_product_id AND user_id = v_uid
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;
  IF v_prod.stock < p_quantity THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponible: %, solicitado: %',
      v_prod.stock, p_quantity;
  END IF;

  v_total   := (p_quantity * p_unit_price) + p_adjustment;
  v_sale_id := gen_random_uuid();
  v_desc    := _sale_description(v_prod.name, p_quantity);

  INSERT INTO sales (
    id, user_id, date, product_id, product_name,
    unit_price, quantity, adjustment, total,
    status, payment_method, client, created_at
  ) VALUES (
    v_sale_id, v_uid, p_date, p_product_id::text, v_prod.name,
    p_unit_price, p_quantity, p_adjustment, v_total,
    p_status, p_payment_method, p_client, now()
  ) RETURNING * INTO v_sale;

  UPDATE products
     SET stock = stock - p_quantity, updated_at = now()
   WHERE id = p_product_id;

  -- Cash flow only for Pagado (non-credit path)
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

  -- Customer credit ledger
  IF p_customer_id IS NOT NULL THEN
    PERFORM id FROM customers
      WHERE id = p_customer_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente no encontrado';
    END IF;

    INSERT INTO customer_transactions (
      id, user_id, customer_id, type, amount, description,
      related_sale_id, date, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, p_customer_id,
      'sale', v_total, v_desc,
      v_sale_id, p_date, now()
    );

    UPDATE customers
       SET current_balance = current_balance + v_total, updated_at = now()
     WHERE id = p_customer_id;
  END IF;

  RETURN NEXT v_sale;
END;
$$;

-- ────────────────────────────────────────────────────────
-- 2. EDIT_SALE
-- Reverts old sale effects and applies new ones atomically.
-- Stock is always held regardless of status.
-- ────────────────────────────────────────────────────────
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
  IF v_sale.product_id::uuid IS DISTINCT FROM p_new_product_id THEN
    -- Different product: restore old stock, deduct new
    UPDATE products
       SET stock = stock + v_sale.quantity, updated_at = now()
     WHERE id = v_sale.product_id::uuid AND user_id = v_uid;

    SELECT * INTO v_new_prod
      FROM products
     WHERE id = p_new_product_id AND user_id = v_uid
     FOR UPDATE;
    IF NOT FOUND THEN
      -- Rollback old product restore
      UPDATE products
         SET stock = stock - v_sale.quantity, updated_at = now()
       WHERE id = v_sale.product_id::uuid AND user_id = v_uid;
      RAISE EXCEPTION 'Producto destino no encontrado';
    END IF;
    IF v_new_prod.stock < p_new_quantity THEN
      UPDATE products
         SET stock = stock - v_sale.quantity, updated_at = now()
       WHERE id = v_sale.product_id::uuid AND user_id = v_uid;
      RAISE EXCEPTION 'Stock insuficiente en el producto destino. Disponible: %',
        v_new_prod.stock;
    END IF;
    UPDATE products
       SET stock = stock - p_new_quantity, updated_at = now()
     WHERE id = p_new_product_id;
  ELSE
    -- Same product: net delta (restore old qty, deduct new qty)
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
    -- Record old contribution before any changes
    SELECT COALESCE(SUM(amount), 0) INTO v_old_contribution
      FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid;

    -- Update the sale transaction
    UPDATE customer_transactions
       SET amount      = v_new_total,
           description = v_new_desc,
           date        = COALESCE(p_new_date, v_sale.date)
     WHERE id = v_sale_tx.id;

    IF p_new_status = 'Pagado' THEN
      -- Transitioning to or staying Pagado: ensure offsetting payment tx exists
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
        -- Remove any duplicate payment transactions
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
      -- Transitioning to or staying pending: remove payment transactions
      DELETE FROM customer_transactions
       WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment';
    END IF;

    -- Recalculate and apply balance delta
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
         product_id     = p_new_product_id::text,
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

-- ────────────────────────────────────────────────────────
-- 3. TOGGLE_SALE_STATUS
-- ────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────
-- 4. DELETE_SALE
-- Restores stock, removes cash_flow, reverses customer balance,
-- deletes customer_transactions, deletes sale.
-- ────────────────────────────────────────────────────────
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
     WHERE id = v_sale.product_id::uuid AND user_id = v_uid;
  END IF;

  -- ── Remove cash flow ──────────────────────────────────
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

-- ────────────────────────────────────────────────────────
-- 5. REGISTER_CUSTOMER_PAYMENT
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION register_customer_payment(
  p_customer_id    uuid,
  p_amount         numeric,
  p_payment_method text,
  p_description    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_cust customers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_cust
    FROM customers
   WHERE id = p_customer_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;

  INSERT INTO customer_transactions (
    id, user_id, customer_id, type, amount, description,
    payment_method, date, created_at
  ) VALUES (
    gen_random_uuid(), v_uid, p_customer_id,
    'payment', -p_amount, p_description,
    p_payment_method, CURRENT_DATE, now()
  );

  UPDATE customers
     SET current_balance = current_balance - p_amount, updated_at = now()
   WHERE id = p_customer_id;

  INSERT INTO cash_flow (
    id, user_id, date, type, source, description, category,
    amount, payment_method, status, created_at
  ) VALUES (
    gen_random_uuid(), v_uid, CURRENT_DATE,
    'Ingreso', 'Venta', 'Cobro cuenta corriente: ' || v_cust.name,
    'Cuenta Corriente', p_amount, p_payment_method, 'Pagado', now()
  );
END;
$$;

-- ────────────────────────────────────────────────────────
-- 6. INTAKE_STOCK
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION intake_stock(
  p_product_id     uuid,
  p_quantity       int,
  p_purchase_price numeric,
  p_supplier       text DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_date           date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_prod products%ROWTYPE;
  v_date date := COALESCE(p_date, CURRENT_DATE);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_prod
    FROM products
   WHERE id = p_product_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

  INSERT INTO stock_intakes (
    id, user_id, date, product_id, product_name,
    quantity, purchase_price, supplier, notes, created_at
  ) VALUES (
    gen_random_uuid(), v_uid, v_date, p_product_id::text, v_prod.name,
    p_quantity, p_purchase_price, p_supplier, p_notes, now()
  );

  UPDATE products
     SET stock          = stock + p_quantity,
         purchase_price = p_purchase_price,
         updated_at     = now()
   WHERE id = p_product_id;
END;
$$;

-- ────────────────────────────────────────────────────────
-- 7. CONVERT_QUOTE_TO_SALE
-- Validates and locks all products, deducts stock atomically,
-- creates sale with items JSONB, handles cash_flow or customer ledger.
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION convert_quote_to_sale(
  p_quote_id       uuid,
  p_status         text,
  p_payment_method text DEFAULT NULL
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_quote     quotes%ROWTYPE;
  v_i         int;
  v_len       int;
  v_item      jsonb;
  v_pid       uuid;
  v_qty       int;
  v_prod      products%ROWTYPE;
  v_sale_id   uuid;
  v_sale      sales%ROWTYPE;
  v_items_out jsonb := '[]'::jsonb;
  v_first_pid uuid;
  v_first_name text;
  v_disp_name  text;
  v_total      numeric;
  v_desc       text;
  v_customer   customers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_quote
    FROM quotes
   WHERE id = p_quote_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presupuesto no encontrado'; END IF;
  IF v_quote.converted_to_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este presupuesto ya fue convertido a venta';
  END IF;

  v_len := jsonb_array_length(v_quote.items);
  IF v_len = 0 THEN RAISE EXCEPTION 'El presupuesto no tiene productos'; END IF;

  -- ── Validate stock for all items (lock order: by id ASC to avoid deadlocks) ──
  FOR v_i IN 0..v_len-1 LOOP
    v_item := v_quote.items->v_i;
    v_pid  := (v_item->>'productId')::uuid;
    v_qty  := (v_item->>'quantity')::int;

    SELECT * INTO v_prod
      FROM products
     WHERE id = v_pid AND user_id = v_uid
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado: %', COALESCE(v_item->>'productName', v_pid::text);
    END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
        v_prod.name, v_prod.stock, v_qty;
    END IF;
  END LOOP;

  -- ── Deduct stock + build items array ──────────────────
  FOR v_i IN 0..v_len-1 LOOP
    v_item := v_quote.items->v_i;
    v_pid  := (v_item->>'productId')::uuid;
    v_qty  := (v_item->>'quantity')::int;

    UPDATE products
       SET stock = stock - v_qty, updated_at = now()
     WHERE id = v_pid AND user_id = v_uid;

    v_items_out := v_items_out || jsonb_build_array(
      jsonb_build_object(
        'productId',   v_pid,
        'productName', v_item->>'productName',
        'quantity',    v_qty,
        'price',       (v_item->>'unitPrice')::numeric
      )
    );
  END LOOP;

  v_first_pid  := (v_quote.items->0->>'productId')::uuid;
  v_first_name := v_quote.items->0->>'productName';
  v_total      := v_quote.total;
  v_sale_id    := gen_random_uuid();
  v_desc       := 'Venta (' || v_quote.number || '): ' || v_quote.client_name;
  v_disp_name  := CASE WHEN v_len = 1
                    THEN v_first_name
                    ELSE 'Presupuesto ' || v_quote.number
                  END;

  -- ── Insert sale ───────────────────────────────────────
  INSERT INTO sales (
    id, user_id, date,
    product_id, product_name, unit_price, quantity, adjustment, total,
    status, payment_method, client, items, created_at
  ) VALUES (
    v_sale_id, v_uid, CURRENT_DATE,
    COALESCE(v_first_pid::text, ''), v_disp_name,
    v_total, 1, 0, v_total,
    p_status, p_payment_method, v_quote.client_name,
    v_items_out, now()
  ) RETURNING * INTO v_sale;

  -- ── Cash flow or customer ledger ──────────────────────
  IF p_status = 'Pagado' THEN
    INSERT INTO cash_flow (
      id, user_id, date, type, source, description, category,
      amount, payment_method, status, sale_id, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, CURRENT_DATE,
      'Ingreso', 'Venta', v_desc, 'Venta Externa',
      v_total, COALESCE(p_payment_method, 'Efectivo'), 'Pagado',
      v_sale_id, now()
    );
  ELSIF v_quote.client_id <> '' THEN
    BEGIN
      v_pid := v_quote.client_id::uuid;
      SELECT * INTO v_customer
        FROM customers
       WHERE id = v_pid AND user_id = v_uid
       FOR UPDATE;
      IF FOUND THEN
        INSERT INTO customer_transactions (
          id, user_id, customer_id, type, amount, description,
          related_sale_id, related_quote_id, date, created_at
        ) VALUES (
          gen_random_uuid(), v_uid, v_pid,
          'sale', v_total, v_desc,
          v_sale_id, p_quote_id::text, CURRENT_DATE, now()
        );
        UPDATE customers
           SET current_balance = current_balance + v_total, updated_at = now()
         WHERE id = v_pid;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL; -- client_id not a valid uuid, skip
    END;
  END IF;

  -- ── Update quote status ───────────────────────────────
  UPDATE quotes
     SET converted_to_sale_id = v_sale_id,
         status               = 'accepted',
         updated_at           = now()
   WHERE id = p_quote_id;

  RETURN NEXT v_sale;
END;
$$;
