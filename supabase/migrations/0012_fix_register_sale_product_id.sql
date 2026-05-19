-- 0012_fix_register_sale_product_id.sql
-- La versión desplegada de register_sale tenía p_product_id text.
-- La migración 0005 cambió sales.product_id a uuid, rompiendo el INSERT.
-- Fix: eliminar el overload con text y asegurar la versión con uuid.

DROP FUNCTION IF EXISTS register_sale(date, text, int, numeric, numeric, text, text, text, uuid);

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
    v_sale_id, v_uid, p_date, p_product_id, v_prod.name,
    p_unit_price, p_quantity, p_adjustment, v_total,
    p_status, p_payment_method, p_client, now()
  ) RETURNING * INTO v_sale;

  UPDATE products
     SET stock = stock - p_quantity, updated_at = now()
   WHERE id = p_product_id;

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
