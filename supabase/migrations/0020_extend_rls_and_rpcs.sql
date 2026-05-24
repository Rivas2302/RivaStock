-- 0020_extend_rls_and_rpcs.sql
-- Drop and recreate all per-table SELECT policies to include collaborators;
-- recreate all existing write RPCs with get_owner_uid + has_permission;
-- add new owner-only RPCs; add get_owner_profile RPC; extend storage policies.

BEGIN;

-- ─────────── 1. RLS EXTENSIONS ────────────────────────────

-- CATEGORIES
DROP POLICY IF EXISTS "categories_owner" ON categories;
CREATE POLICY "categories_select" ON categories
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = categories.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "categories_modify_owner" ON categories
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "categories_update_owner" ON categories
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "categories_delete_owner" ON categories
  FOR DELETE USING (user_id = auth.uid());

-- PRICE_RANGES
DROP POLICY IF EXISTS "price_ranges_owner" ON price_ranges;
CREATE POLICY "price_ranges_select" ON price_ranges
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = price_ranges.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "price_ranges_modify_owner" ON price_ranges
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "price_ranges_update_owner" ON price_ranges
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "price_ranges_delete_owner" ON price_ranges
  FOR DELETE USING (user_id = auth.uid());

-- PRODUCTS
DROP POLICY IF EXISTS "products_owner" ON products;
CREATE POLICY "products_select" ON products
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = products.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "products_modify_owner" ON products
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "products_update_owner" ON products
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "products_delete_owner" ON products
  FOR DELETE USING (user_id = auth.uid());

-- SALES
DROP POLICY IF EXISTS "sales_owner" ON sales;
CREATE POLICY "sales_select" ON sales
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = sales.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "sales_modify_owner" ON sales
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "sales_update_owner" ON sales
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "sales_delete_owner" ON sales
  FOR DELETE USING (user_id = auth.uid());

-- CASH_FLOW
DROP POLICY IF EXISTS "cash_flow_owner" ON cash_flow;
CREATE POLICY "cash_flow_select" ON cash_flow
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = cash_flow.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "cash_flow_modify_owner" ON cash_flow
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "cash_flow_update_owner" ON cash_flow
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "cash_flow_delete_owner" ON cash_flow
  FOR DELETE USING (user_id = auth.uid());

-- STOCK_INTAKES
DROP POLICY IF EXISTS "stock_intakes_owner" ON stock_intakes;
CREATE POLICY "stock_intakes_select" ON stock_intakes
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = stock_intakes.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "stock_intakes_modify_owner" ON stock_intakes
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "stock_intakes_update_owner" ON stock_intakes
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "stock_intakes_delete_owner" ON stock_intakes
  FOR DELETE USING (user_id = auth.uid());

-- CUSTOMERS
DROP POLICY IF EXISTS "customers_owner" ON customers;
CREATE POLICY "customers_select" ON customers
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = customers.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "customers_modify_owner" ON customers
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "customers_update_owner" ON customers
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "customers_delete_owner" ON customers
  FOR DELETE USING (user_id = auth.uid());

-- CUSTOMER_TRANSACTIONS
DROP POLICY IF EXISTS "customer_transactions_owner" ON customer_transactions;
CREATE POLICY "customer_transactions_select" ON customer_transactions
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = customer_transactions.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "customer_transactions_modify_owner" ON customer_transactions
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "customer_transactions_update_owner" ON customer_transactions
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "customer_transactions_delete_owner" ON customer_transactions
  FOR DELETE USING (user_id = auth.uid());

-- QUOTES
DROP POLICY IF EXISTS "quotes_owner" ON quotes;
CREATE POLICY "quotes_select" ON quotes
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = quotes.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "quotes_modify_owner" ON quotes
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "quotes_update_owner" ON quotes
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "quotes_delete_owner" ON quotes
  FOR DELETE USING (user_id = auth.uid());

-- ORDERS
DROP POLICY IF EXISTS "orders_owner" ON orders;
CREATE POLICY "orders_select" ON orders
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = orders.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "orders_modify_owner" ON orders
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "orders_update_owner" ON orders
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "orders_delete_owner" ON orders
  FOR DELETE USING (user_id = auth.uid());

-- CATALOG_CONFIG
DROP POLICY IF EXISTS "catalog_config_owner" ON catalog_config;
CREATE POLICY "catalog_config_select" ON catalog_config
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = catalog_config.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "catalog_config_modify_owner" ON catalog_config
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "catalog_config_update_owner" ON catalog_config
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "catalog_config_delete_owner" ON catalog_config
  FOR DELETE USING (user_id = auth.uid());

-- SUPPLIERS
DROP POLICY IF EXISTS "suppliers_owner" ON suppliers;
CREATE POLICY "suppliers_select" ON suppliers
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid() AND c.owner_uid = suppliers.user_id AND c.revoked_at IS NULL
    )
  );
CREATE POLICY "suppliers_modify_owner" ON suppliers
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "suppliers_update_owner" ON suppliers
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "suppliers_delete_owner" ON suppliers
  FOR DELETE USING (user_id = auth.uid());

-- ─────────── 2. RPCS: register_sale ────────────────────────────
DROP FUNCTION IF EXISTS register_sale(date, uuid, int, numeric, numeric, text, text, text, uuid);
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
    status, payment_method, client, created_at
  ) VALUES (
    v_sale_id, v_uid, p_date, p_product_id, v_prod.name,
    p_unit_price, p_quantity, p_adjustment, v_total,
    p_status, p_payment_method, p_client, now()
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

-- ─────────── 3. RPCS: edit_sale ────────────────────────────
DROP FUNCTION IF EXISTS edit_sale(uuid, uuid, int, numeric, numeric, text, text, text, date);
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
  v_caller      uuid := auth.uid();
  v_uid         uuid;
  v_sale        sales%ROWTYPE;
  v_new_prod    products%ROWTYPE;
  v_new_total   numeric;
  v_new_desc    text;
  v_cf_id       uuid;
  v_updated    sales%ROWTYPE;
  v_new_name    text;
  v_sale_tx     customer_transactions%ROWTYPE;
  v_old_contribution numeric;
  v_new_contribution numeric;
  v_delta       numeric;
  v_pay_tx      customer_transactions%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para editar ventas';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  -- Stock management
  IF v_sale.product_id IS DISTINCT FROM p_new_product_id THEN
    UPDATE products SET stock = stock + v_sale.quantity, updated_at = now()
      WHERE id = v_sale.product_id AND user_id = v_uid;
    SELECT * INTO v_new_prod FROM products WHERE id = p_new_product_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
      UPDATE products SET stock = stock - v_sale.quantity, updated_at = now()
        WHERE id = v_sale.product_id AND user_id = v_uid;
      RAISE EXCEPTION 'Producto destino no encontrado';
    END IF;
    IF v_new_prod.stock < p_new_quantity THEN
      UPDATE products SET stock = stock - v_sale.quantity, updated_at = now()
        WHERE id = v_sale.product_id AND user_id = v_uid;
      RAISE EXCEPTION 'Stock insuficiente en el producto destino. Disponible: %', v_new_prod.stock;
    END IF;
    UPDATE products SET stock = stock - p_new_quantity, updated_at = now()
      WHERE id = p_new_product_id;
  ELSE
    SELECT * INTO v_new_prod FROM products WHERE id = p_new_product_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_new_prod.stock + v_sale.quantity < p_new_quantity THEN
      RAISE EXCEPTION 'Stock insuficiente. Disponible efectivo: %', v_new_prod.stock + v_sale.quantity;
    END IF;
    UPDATE products SET stock = stock + v_sale.quantity - p_new_quantity, updated_at = now()
      WHERE id = p_new_product_id;
  END IF;

  v_new_name  := (SELECT name FROM products WHERE id = p_new_product_id AND user_id = v_uid);
  v_new_total := (p_new_quantity * p_new_unit_price) + p_new_adjustment;
  v_new_desc  := _sale_description(v_new_name, p_new_quantity);

  PERFORM set_config('app.bypass_check', 'rpc', true);

  SELECT id INTO v_cf_id FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid LIMIT 1;

  IF v_sale.status = 'Pagado' AND p_new_status = 'Pagado' THEN
    IF v_cf_id IS NOT NULL THEN
      UPDATE cash_flow SET
        date = COALESCE(p_new_date, v_sale.date), description = v_new_desc,
        amount = v_new_total, payment_method = COALESCE(p_new_payment_method, 'Efectivo')
        WHERE id = v_cf_id;
    ELSE
      INSERT INTO cash_flow (id, user_id, date, type, source, description, category, amount, payment_method, status, sale_id, created_at)
      VALUES (gen_random_uuid(), v_uid, COALESCE(p_new_date, v_sale.date), 'Ingreso', 'Venta', v_new_desc, 'Venta Externa', v_new_total, COALESCE(p_new_payment_method, 'Efectivo'), 'Pagado', p_sale_id, now());
    END IF;
  ELSIF v_sale.status = 'Pagado' AND p_new_status <> 'Pagado' THEN
    DELETE FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid;
  ELSIF v_sale.status <> 'Pagado' AND p_new_status = 'Pagado' THEN
    INSERT INTO cash_flow (id, user_id, date, type, source, description, category, amount, payment_method, status, sale_id, created_at)
    VALUES (gen_random_uuid(), v_uid, COALESCE(p_new_date, v_sale.date), 'Ingreso', 'Venta', v_new_desc, 'Venta Externa', v_new_total, COALESCE(p_new_payment_method, 'Efectivo'), 'Pagado', p_sale_id, now());
  END IF;

  SELECT * INTO v_sale_tx FROM customer_transactions
    WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'sale' LIMIT 1 FOR UPDATE;

  IF v_sale_tx.id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_old_contribution
      FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid;
    UPDATE customer_transactions SET amount = v_new_total, description = v_new_desc, date = COALESCE(p_new_date, v_sale.date)
      WHERE id = v_sale_tx.id;
    IF p_new_status = 'Pagado' THEN
      SELECT * INTO v_pay_tx FROM customer_transactions
        WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment' LIMIT 1;
      IF v_pay_tx.id IS NOT NULL THEN
        UPDATE customer_transactions SET amount = -v_new_total, description = 'Cobro de ' || v_new_desc,
          payment_method = COALESCE(p_new_payment_method, v_pay_tx.payment_method, 'Efectivo')
          WHERE id = v_pay_tx.id;
        DELETE FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment' AND id <> v_pay_tx.id;
      ELSE
        INSERT INTO customer_transactions (id, user_id, customer_id, type, amount, description, payment_method, related_sale_id, date, created_at)
        VALUES (gen_random_uuid(), v_uid, v_sale_tx.customer_id, 'payment', -v_new_total, 'Cobro de ' || v_new_desc,
          COALESCE(p_new_payment_method, 'Efectivo'), p_sale_id, CURRENT_DATE, now());
      END IF;
    ELSE
      DELETE FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment';
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_new_contribution
      FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid;
    v_delta := v_new_contribution - v_old_contribution;
    IF v_delta <> 0 THEN
      UPDATE customers SET current_balance = current_balance + v_delta, updated_at = now()
        WHERE id = v_sale_tx.customer_id AND user_id = v_uid;
    END IF;
  END IF;

  UPDATE sales SET
    date = COALESCE(p_new_date, date), product_id = p_new_product_id, product_name = v_new_name,
    unit_price = p_new_unit_price, quantity = p_new_quantity, adjustment = p_new_adjustment,
    total = v_new_total, status = p_new_status, payment_method = p_new_payment_method, client = p_new_client
    WHERE id = p_sale_id RETURNING * INTO v_updated;
  RETURN NEXT v_updated;
END;
$$;

-- ─────────── 4. RPCS: toggle_sale_status ────────────────────────────
DROP FUNCTION IF EXISTS toggle_sale_status(uuid, text);
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
  v_caller uuid := auth.uid();
  v_uid    uuid;
  v_sale   sales%ROWTYPE;
  v_updated sales%ROWTYPE;
  v_desc   text;
  v_sale_tx customer_transactions%ROWTYPE;
  v_old_contribution numeric;
  v_new_contribution numeric;
  v_delta   numeric;
  v_pay_tx  customer_transactions%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para cambiar estado de venta';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  v_desc := _sale_description(v_sale.product_name, v_sale.quantity);

  UPDATE sales SET status = p_new_status, payment_method = COALESCE(payment_method, 'Efectivo')
    WHERE id = p_sale_id RETURNING * INTO v_updated;

  PERFORM set_config('app.bypass_check', 'rpc', true);

  IF p_new_status = 'Pagado' AND v_sale.status <> 'Pagado' THEN
    IF NOT EXISTS (SELECT 1 FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid) THEN
      INSERT INTO cash_flow (id, user_id, date, type, source, description, category, amount, payment_method, status, sale_id, created_at)
      VALUES (gen_random_uuid(), v_uid, v_sale.date, 'Ingreso', 'Venta', v_desc, 'Venta Externa', v_sale.total, COALESCE(v_sale.payment_method, 'Efectivo'), 'Pagado', p_sale_id, now());
    END IF;
  ELSIF p_new_status <> 'Pagado' AND v_sale.status = 'Pagado' THEN
    DELETE FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid;
  END IF;

  SELECT * INTO v_sale_tx FROM customer_transactions
    WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'sale' LIMIT 1 FOR UPDATE;

  IF v_sale_tx.id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_old_contribution
      FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid;
    IF p_new_status = 'Pagado' AND v_sale.status <> 'Pagado' THEN
      SELECT * INTO v_pay_tx FROM customer_transactions
        WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment' LIMIT 1;
      IF v_pay_tx.id IS NOT NULL THEN
        UPDATE customer_transactions SET amount = -v_sale.total, payment_method = COALESCE(v_sale.payment_method, 'Efectivo')
          WHERE id = v_pay_tx.id;
        DELETE FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment' AND id <> v_pay_tx.id;
      ELSE
        INSERT INTO customer_transactions (id, user_id, customer_id, type, amount, description, payment_method, related_sale_id, date, created_at)
        VALUES (gen_random_uuid(), v_uid, v_sale_tx.customer_id, 'payment', -v_sale.total, 'Cobro de ' || v_desc,
          COALESCE(v_sale.payment_method, 'Efectivo'), p_sale_id, CURRENT_DATE, now());
      END IF;
    ELSIF p_new_status <> 'Pagado' AND v_sale.status = 'Pagado' THEN
      DELETE FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment';
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_new_contribution
      FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid;
    v_delta := v_new_contribution - v_old_contribution;
    IF v_delta <> 0 THEN
      UPDATE customers SET current_balance = current_balance + v_delta, updated_at = now()
        WHERE id = v_sale_tx.customer_id AND user_id = v_uid;
    END IF;
  END IF;

  RETURN NEXT v_updated;
END;
$$;

-- ─────────── 5. RPCS: delete_sale ────────────────────────────
DROP FUNCTION IF EXISTS delete_sale(uuid);
CREATE OR REPLACE FUNCTION delete_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid    uuid;
  v_sale   sales%ROWTYPE;
  v_item   jsonb;
  v_i      int;
  v_len    int;
  v_pid    uuid;
  v_qty    int;
  v_tx     customer_transactions%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'delete') THEN
    RAISE EXCEPTION 'Sin permiso para eliminar ventas';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  IF v_sale.items IS NOT NULL AND jsonb_array_length(v_sale.items) > 0 THEN
    v_len := jsonb_array_length(v_sale.items);
    FOR v_i IN 0..v_len-1 LOOP
      v_item := v_sale.items->v_i;
      v_pid  := (v_item->>'productId')::uuid;
      v_qty  := (v_item->>'quantity')::int;
      UPDATE products SET stock = stock + v_qty, updated_at = now()
        WHERE id = v_pid AND user_id = v_uid;
    END LOOP;
  ELSE
    UPDATE products SET stock = stock + v_sale.quantity, updated_at = now()
      WHERE id = v_sale.product_id AND user_id = v_uid;
  END IF;

  PERFORM set_config('app.bypass_check', 'rpc', true);
  DELETE FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid;

  FOR v_tx IN SELECT * FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid LOOP
    UPDATE customers SET current_balance = current_balance - v_tx.amount, updated_at = now()
      WHERE id = v_tx.customer_id AND user_id = v_uid;
  END LOOP;

  DELETE FROM customer_transactions WHERE related_sale_id = p_sale_id AND user_id = v_uid;
  DELETE FROM sales WHERE id = p_sale_id AND user_id = v_uid;
END;
$$;

-- ─────────── 6. RPCS: register_customer_payment ────────────────────────────
DROP FUNCTION IF EXISTS register_customer_payment(uuid, numeric, text, text);
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
  v_caller uuid := auth.uid();
  v_uid    uuid;
  v_cust   customers%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'clientes', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar pagos de cliente';
  END IF;

  SELECT * INTO v_cust FROM customers WHERE id = p_customer_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;

  INSERT INTO customer_transactions (
    id, user_id, customer_id, type, amount, description,
    payment_method, date, created_at
  ) VALUES (
    gen_random_uuid(), v_uid, p_customer_id,
    'payment', -p_amount, p_description,
    p_payment_method, CURRENT_DATE, now()
  );

  UPDATE customers SET current_balance = current_balance - p_amount, updated_at = now()
    WHERE id = p_customer_id;

  INSERT INTO cash_flow (id, user_id, date, type, source, description, category, amount, payment_method, status, created_at)
  VALUES (gen_random_uuid(), v_uid, CURRENT_DATE, 'Ingreso', 'Venta', 'Cobro cuenta corriente: ' || v_cust.name,
    'Cuenta Corriente', p_amount, p_payment_method, 'Pagado', now());
END;
$$;

-- ─────────── 7. RPCS: reconcile_customer_balance ────────────────────────────
DROP FUNCTION IF EXISTS reconcile_customer_balance(uuid);
CREATE OR REPLACE FUNCTION reconcile_customer_balance(p_customer_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_uid     uuid;
  v_balance numeric;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'clientes', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para conciliar saldo de cliente';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM customer_transactions WHERE customer_id = p_customer_id AND user_id = v_uid;
  UPDATE customers SET current_balance = v_balance, updated_at = now()
    WHERE id = p_customer_id AND user_id = v_uid;
  RETURN v_balance;
END;
$$;

-- ─────────── 8. RPCS: intake_stock ────────────────────────────
DROP FUNCTION IF EXISTS intake_stock(uuid, int, numeric, text, text, date);
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
  v_caller uuid := auth.uid();
  v_uid    uuid;
  v_prod   products%ROWTYPE;
  v_date   date := COALESCE(p_date, CURRENT_DATE);
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ingresos', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar ingresos de stock';
  END IF;

  SELECT * INTO v_prod FROM products WHERE id = p_product_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

  INSERT INTO stock_intakes (
    id, user_id, date, product_id, product_name,
    quantity, purchase_price, supplier, notes, created_at
  ) VALUES (
    gen_random_uuid(), v_uid, v_date, p_product_id, v_prod.name,
    p_quantity, p_purchase_price, p_supplier, p_notes, now()
  );

  UPDATE products SET stock = stock + p_quantity, purchase_price = p_purchase_price, updated_at = now()
    WHERE id = p_product_id;
END;
$$;

-- ─────────── 9. RPCS: convert_quote_to_sale ────────────────────────────
DROP FUNCTION IF EXISTS convert_quote_to_sale(uuid, text, text);
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
  v_caller     uuid := auth.uid();
  v_uid        uuid;
  v_quote      quotes%ROWTYPE;
  v_i          int;
  v_len        int;
  v_item       jsonb;
  v_pid        uuid;
  v_qty        int;
  v_prod       products%ROWTYPE;
  v_sale_id    uuid;
  v_sale       sales%ROWTYPE;
  v_items_out  jsonb := '[]'::jsonb;
  v_first_pid  uuid;
  v_first_name text;
  v_total      numeric;
  v_desc       text;
  v_disp_name  text;
  v_customer   customers%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para convertir presupuestos';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presupuesto no encontrado'; END IF;
  IF v_quote.converted_to_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este presupuesto ya fue convertido a venta';
  END IF;

  v_len := jsonb_array_length(v_quote.items);
  IF v_len = 0 THEN RAISE EXCEPTION 'El presupuesto no tiene productos'; END IF;

  FOR v_i IN 0..v_len-1 LOOP
    v_item := v_quote.items->v_i;
    v_pid  := (v_item->>'productId')::uuid;
    v_qty  := (v_item->>'quantity')::int;
    SELECT * INTO v_prod FROM products WHERE id = v_pid AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado: %', COALESCE(v_item->>'productName', v_pid::text);
    END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
        v_prod.name, v_prod.stock, v_qty;
    END IF;
  END LOOP;

  FOR v_i IN 0..v_len-1 LOOP
    v_item := v_quote.items->v_i;
    v_pid  := (v_item->>'productId')::uuid;
    v_qty  := (v_item->>'quantity')::int;
    UPDATE products SET stock = stock - v_qty, updated_at = now() WHERE id = v_pid AND user_id = v_uid;
    v_items_out := v_items_out || jsonb_build_array(
      jsonb_build_object('productId', v_pid, 'productName', v_item->>'productName',
        'quantity', v_qty, 'price', (v_item->>'unitPrice')::numeric)
    );
  END LOOP;

  v_first_pid  := (v_quote.items->0->>'productId')::uuid;
  v_first_name := v_quote.items->0->>'productName';
  v_total      := v_quote.total;
  v_sale_id    := gen_random_uuid();
  v_desc       := 'Venta (' || v_quote.number || '): ' || v_quote.client_name;
  v_disp_name  := CASE WHEN v_len = 1 THEN v_first_name ELSE 'Presupuesto ' || v_quote.number END;

  INSERT INTO sales (
    id, user_id, date, product_id, product_name, unit_price, quantity, adjustment, total,
    status, payment_method, client, items, created_at
  ) VALUES (
    v_sale_id, v_uid, CURRENT_DATE, v_first_pid, v_disp_name,
    v_total, 1, 0, v_total, p_status, p_payment_method, v_quote.client_name, v_items_out, now()
  ) RETURNING * INTO v_sale;

  IF p_status = 'Pagado' THEN
    INSERT INTO cash_flow (id, user_id, date, type, source, description, category, amount, payment_method, status, sale_id, created_at)
    VALUES (gen_random_uuid(), v_uid, CURRENT_DATE, 'Ingreso', 'Venta', v_desc, 'Venta Externa',
      v_total, COALESCE(p_payment_method, 'Efectivo'), 'Pagado', v_sale_id, now());
  ELSIF v_quote.client_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = v_quote.client_id AND user_id = v_uid FOR UPDATE;
    IF FOUND THEN
      INSERT INTO customer_transactions (id, user_id, customer_id, type, amount, description, related_sale_id, related_quote_id, date, created_at)
      VALUES (gen_random_uuid(), v_uid, v_quote.client_id, 'sale', v_total, v_desc, v_sale_id, p_quote_id::text, CURRENT_DATE, now());
      UPDATE customers SET current_balance = current_balance + v_total, updated_at = now() WHERE id = v_quote.client_id;
    END IF;
  END IF;

  UPDATE quotes SET converted_to_sale_id = v_sale_id, status = 'accepted', updated_at = now()
    WHERE id = p_quote_id;
  RETURN NEXT v_sale;
END;
$$;

-- ─────────── 10. RPCS: register_supplier ────────────────────────────
DROP FUNCTION IF EXISTS register_supplier(text, text, text, text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION register_supplier(
  p_name          text,
  p_contact_name  text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_email         text DEFAULT NULL,
  p_address       text DEFAULT NULL,
  p_cuit          text DEFAULT NULL,
  p_category      text DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_payment_terms text DEFAULT NULL,
  p_catalog_url   text DEFAULT NULL
)
RETURNS suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid    uuid;
  v_new    suppliers%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'proveedores', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar proveedores';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF p_email IS NOT NULL AND trim(p_email) <> '' AND p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Formato de email inválido';
  END IF;

  INSERT INTO suppliers (
    user_id, name, name_lower, contact_name, phone, email,
    address, cuit, category, notes, payment_terms, catalog_url
  ) VALUES (
    v_uid, trim(p_name), lower(trim(p_name)),
    NULLIF(trim(p_contact_name), '')::text, NULLIF(trim(p_phone), '')::text,
    NULLIF(trim(p_email), '')::text, NULLIF(trim(p_address), '')::text,
    NULLIF(trim(p_cuit), '')::text, NULLIF(trim(p_category), '')::text,
    NULLIF(trim(p_notes), '')::text, NULLIF(trim(p_payment_terms), '')::text,
    NULLIF(trim(p_catalog_url), '')::text
  ) RETURNING * INTO v_new;
  RETURN v_new;
END;
$$;

-- ─────────── 11. RPCS: update_supplier ────────────────────────────
DROP FUNCTION IF EXISTS update_supplier(uuid, text, text, text, text, text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION update_supplier(
  p_id            uuid,
  p_name          text DEFAULT NULL,
  p_contact_name  text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_email         text DEFAULT NULL,
  p_address       text DEFAULT NULL,
  p_cuit          text DEFAULT NULL,
  p_category      text DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_payment_terms text DEFAULT NULL,
  p_catalog_url   text DEFAULT NULL
)
RETURNS suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_uid      uuid;
  v_existing suppliers%ROWTYPE;
  v_updated  suppliers%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'proveedores', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para actualizar proveedores';
  END IF;

  SELECT * INTO v_existing FROM suppliers WHERE id = p_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado'; END IF;

  IF p_email IS NOT NULL AND trim(p_email) <> '' AND p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Formato de email inválido';
  END IF;

  UPDATE suppliers SET
    name          = COALESCE(NULLIF(trim(p_name), ''), name),
    name_lower    = COALESCE(NULLIF(trim(lower(p_name)), ''), name_lower),
    contact_name  = NULLIF(trim(p_contact_name), '')::text,
    phone         = NULLIF(trim(p_phone), '')::text,
    email         = NULLIF(trim(p_email), '')::text,
    address       = NULLIF(trim(p_address), '')::text,
    cuit          = NULLIF(trim(p_cuit), '')::text,
    category      = NULLIF(trim(p_category), '')::text,
    notes         = NULLIF(trim(p_notes), '')::text,
    payment_terms = NULLIF(trim(p_payment_terms), '')::text,
    catalog_url   = NULLIF(trim(p_catalog_url), '')::text
    WHERE id = p_id AND user_id = v_uid
    RETURNING * INTO v_updated;
  RETURN v_updated;
END;
$$;

-- ─────────── 12. RPCS: delete_supplier ────────────────────────────
DROP FUNCTION IF EXISTS delete_supplier(uuid);
CREATE OR REPLACE FUNCTION delete_supplier(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid    uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'proveedores', 'delete') THEN
    RAISE EXCEPTION 'Sin permiso para eliminar proveedores';
  END IF;
  DELETE FROM suppliers WHERE id = p_id AND user_id = v_uid;
END;
$$;

-- ─────────── 13. RPCS: toggle_supplier_active ────────────────────────────
DROP FUNCTION IF EXISTS toggle_supplier_active(uuid);
CREATE OR REPLACE FUNCTION toggle_supplier_active(p_id uuid)
RETURNS suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_uid     uuid;
  v_updated suppliers%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'proveedores', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para cambiar estado de proveedor';
  END IF;

  UPDATE suppliers SET is_active = NOT is_active
    WHERE id = p_id AND user_id = v_uid
    RETURNING * INTO v_updated;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado'; END IF;
  RETURN v_updated;
END;
$$;

-- ─────────── 14. NEW RPCS: get_owner_profile ────────────────────────────
CREATE OR REPLACE FUNCTION get_owner_profile()
RETURNS SETOF profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles
   WHERE id = get_owner_uid(auth.uid());
$$;
GRANT EXECUTE ON FUNCTION get_owner_profile() TO authenticated;

-- ─────────── 15. NEW RPCS: list_collaborators ────────────────────────────
CREATE OR REPLACE FUNCTION list_collaborators()
RETURNS SETOF collaborators
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM collaborators
   WHERE owner_uid = auth.uid()
   ORDER BY revoked_at NULLS FIRST, created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION list_collaborators() TO authenticated;

-- ─────────── 16. NEW RPCS: list_invitations ────────────────────────────
CREATE OR REPLACE FUNCTION list_invitations()
RETURNS SETOF invitations
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM invitations
   WHERE owner_uid = auth.uid()
   ORDER BY invited_at DESC;
$$;
GRANT EXECUTE ON FUNCTION list_invitations() TO authenticated;

-- ─────────── 17. NEW RPCS: update_collaborator_permissions ────────────────────────────
CREATE OR REPLACE FUNCTION update_collaborator_permissions(
  p_collab_id   uuid,
  p_permissions jsonb,
  p_role_preset text
)
RETURNS SETOF collaborators
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row collaborators%ROWTYPE;
BEGIN
  UPDATE collaborators
     SET permissions = p_permissions, role_preset = p_role_preset
   WHERE id = p_collab_id AND owner_uid = auth.uid()
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador no encontrado'; END IF;
  RETURN NEXT v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION update_collaborator_permissions(uuid, jsonb, text) TO authenticated;

-- ─────────── 18. NEW RPCS: revoke_collaborator ────────────────────────────
CREATE OR REPLACE FUNCTION revoke_collaborator(p_collab_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE collaborators
     SET revoked_at = now()
   WHERE id = p_collab_id AND owner_uid = auth.uid() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador no encontrado o ya revocado'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION revoke_collaborator(uuid) TO authenticated;

-- ─────────── 19. NEW RPCS: revoke_invitation ────────────────────────────
CREATE OR REPLACE FUNCTION revoke_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE invitations
     SET revoked_at = now()
   WHERE id = p_invitation_id AND owner_uid = auth.uid() AND accepted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitación no encontrada o ya aceptada/revocada'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION revoke_invitation(uuid) TO authenticated;

-- ─────────── 20. STORAGE POLICIES ────────────────────────────
DROP POLICY IF EXISTS "assets_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "assets_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "assets_auth_delete" ON storage.objects;

CREATE POLICY "assets_auth_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'assets'
    AND get_owner_uid(auth.uid())::text = (storage.foldername(name))[1]
    AND has_permission(auth.uid(), 'stock', 'write')
  );

CREATE POLICY "assets_auth_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'assets'
    AND get_owner_uid(auth.uid())::text = (storage.foldername(name))[1]
    AND has_permission(auth.uid(), 'stock', 'write')
  );

CREATE POLICY "assets_auth_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'assets'
    AND get_owner_uid(auth.uid())::text = (storage.foldername(name))[1]
    AND has_permission(auth.uid(), 'stock', 'delete')
  );

COMMIT;
