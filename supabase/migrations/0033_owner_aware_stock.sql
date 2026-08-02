-- 0033_owner_aware_stock.sql
-- Atomic shared-product editing and owner-attributed stock intake.

BEGIN;

-- Fail safe: owner-aware sales and returns are not available yet.
UPDATE inventory_operation_settings
SET holdings_enabled = false,
    updated_at = now()
WHERE holdings_enabled;

CREATE TABLE inventory_product_commands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 160),
  product_id      uuid NOT NULL,
  actor_uid       uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

ALTER TABLE inventory_stock_commands
  DROP CONSTRAINT inventory_stock_commands_product_tenant_fk;

ALTER TABLE inventory_product_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inventory_product_commands_select" ON inventory_product_commands
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'read')
    AND (
      auth.uid() = user_id
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(inventory_product_commands.payload->'holdings', '[]'::jsonb)) requested(value)
        WHERE NOT EXISTS (
          SELECT 1
          FROM inventory_owner_memberships membership
          WHERE membership.user_id = inventory_product_commands.user_id
            AND membership.actor_uid = auth.uid()
            AND membership.inventory_owner_id = (requested.value->>'inventoryOwnerId')::uuid
        )
      )
    )
  );
REVOKE INSERT, UPDATE, DELETE ON inventory_product_commands FROM anon, authenticated;
GRANT SELECT ON inventory_product_commands TO authenticated;

ALTER TABLE stock_intakes
  ADD COLUMN inventory_owner_id uuid,
  ADD COLUMN inventory_owner_name text,
  ADD COLUMN actor_uid uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN idempotency_key text;

UPDATE stock_intakes intake
SET inventory_owner_id = p.inventory_owner_id,
    inventory_owner_name = io.name,
    actor_uid = intake.user_id
FROM products p
JOIN inventory_owners io
  ON io.user_id = p.user_id AND io.id = p.inventory_owner_id
WHERE p.user_id = intake.user_id AND p.id = intake.product_id;

ALTER TABLE stock_intakes
  ADD CONSTRAINT stock_intakes_inventory_owner_tenant_fk
    FOREIGN KEY (user_id, inventory_owner_id)
    REFERENCES inventory_owners (user_id, id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX stock_intakes_idempotency_idx
  ON stock_intakes (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP POLICY IF EXISTS "stock_intakes_select" ON stock_intakes;
CREATE POLICY "stock_intakes_select" ON stock_intakes
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'ingresos', 'read')
    AND (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1
        FROM inventory_owner_memberships membership
        WHERE membership.user_id = stock_intakes.user_id
          AND membership.actor_uid = auth.uid()
          AND membership.inventory_owner_id = stock_intakes.inventory_owner_id
      )
      OR stock_intakes.inventory_owner_id IS NULL
    )
  );

DROP POLICY IF EXISTS "inventory_stock_commands_select" ON inventory_stock_commands;
CREATE POLICY "inventory_stock_commands_select" ON inventory_stock_commands
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'read')
    AND (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1
        FROM inventory_owner_memberships membership
        WHERE membership.user_id = inventory_stock_commands.user_id
          AND membership.actor_uid = auth.uid()
          AND membership.inventory_owner_id = inventory_stock_commands.inventory_owner_id
      )
    )
  );

DROP POLICY IF EXISTS "inventory_holdings_select" ON inventory_holdings;
CREATE POLICY "inventory_holdings_select" ON inventory_holdings
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'read')
    AND (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1
        FROM inventory_owner_memberships membership
        WHERE membership.user_id = inventory_holdings.user_id
          AND membership.actor_uid = auth.uid()
          AND membership.inventory_owner_id = inventory_holdings.inventory_owner_id
      )
    )
  );

-- Every holding writer reaches this trigger function. One transaction-scoped
-- lock per tenant/product makes the aggregate mirror a serialized recalculation.
CREATE OR REPLACE FUNCTION sync_inventory_holdings_to_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := COALESCE(NEW.user_id, OLD.user_id);
  v_product_id uuid := COALESCE(NEW.product_id, OLD.product_id);
  v_stock integer;
  v_representative inventory_holdings%ROWTYPE;
BEGIN
  IF current_setting('app.inventory_holding_sync', true) = 'product_to_holding' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_product_id::text, 0));

  SELECT COALESCE(sum(stock), 0)::integer INTO v_stock
  FROM inventory_holdings
  WHERE user_id = v_user_id AND product_id = v_product_id AND active;

  SELECT h.* INTO v_representative
  FROM inventory_holdings h
  JOIN inventory_owners io
    ON io.user_id = h.user_id AND io.id = h.inventory_owner_id
  WHERE h.user_id = v_user_id AND h.product_id = v_product_id AND h.active
  ORDER BY io.sort_order, h.id
  LIMIT 1;

  PERFORM set_config('app.inventory_holding_sync', 'holding_to_product', true);
  UPDATE products
  SET stock = v_stock,
      purchase_price = COALESCE(v_representative.purchase_cost, purchase_price),
      min_stock = COALESCE(v_representative.min_stock, min_stock),
      inventory_owner_id = COALESCE(v_representative.inventory_owner_id, inventory_owner_id),
      updated_at = now()
  WHERE user_id = v_user_id AND id = v_product_id;
  PERFORM set_config('app.inventory_holding_sync', '', true);
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Legacy direct products SELECT remains compatibility-only while migration 0033
-- forces holdings off. Owner-aware code treats holdings plus this sanitized RPC
-- projection as authoritative and never consumes mirrored owner economics.
CREATE OR REPLACE FUNCTION inventory_shared_product_projection(p_product products)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', p_product.id,
    'user_id', p_product.user_id,
    'name', p_product.name,
    'category_id', p_product.category_id,
    'category', p_product.category,
    'sale_price', p_product.sale_price,
    'stock', p_product.stock,
    'image_url', p_product.image_url,
    'images', p_product.images,
    'show_in_catalog', p_product.show_in_catalog,
    'notes', p_product.notes,
    'description', p_product.description,
    'barcode', p_product.barcode,
    'custom_fields', p_product.custom_fields,
    'created_at', p_product.created_at,
    'updated_at', p_product.updated_at
  );
$$;

CREATE OR REPLACE FUNCTION save_product_with_holdings(
  p_product jsonb,
  p_holdings jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_product_id uuid := (p_product->>'id')::uuid;
  v_payload jsonb := jsonb_build_object(
    'product', p_product - 'updatedAt' - 'createdAt',
    'holdings', p_holdings
  );
  v_existing inventory_product_commands%ROWTYPE;
  v_holding jsonb;
  v_owner_id uuid;
  v_stock integer;
  v_cost numeric;
  v_min integer;
  v_active boolean;
  v_primary_owner_id uuid;
  v_total_stock integer;
  v_old_stock integer;
  v_product products%ROWTYPE;
  v_holdings jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticación requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para editar stock';
  END IF;
  IF NOT COALESCE((
    SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid
  ), false) THEN RAISE EXCEPTION 'El stock compartido no está habilitado'; END IF;
  IF jsonb_typeof(p_holdings) <> 'array' OR jsonb_array_length(p_holdings) = 0 THEN
    RAISE EXCEPTION 'Debe informar al menos una existencia';
  END IF;
  IF char_length(p_idempotency_key) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Clave de idempotencia inválida';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_holdings)) <>
     (SELECT count(DISTINCT value->>'inventoryOwnerId') FROM jsonb_array_elements(p_holdings)) THEN
    RAISE EXCEPTION 'Hay un titular repetido';
  END IF;

  -- Authorization must be current even when this command is an idempotent replay.
  FOR v_holding IN SELECT value FROM jsonb_array_elements(p_holdings) LOOP
    v_owner_id := (v_holding->>'inventoryOwnerId')::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM inventory_owners io
      WHERE io.user_id = v_uid AND io.id = v_owner_id AND io.archived_at IS NULL
    ) THEN RAISE EXCEPTION 'Titular inexistente o archivado'; END IF;
    IF auth.uid() <> v_uid AND NOT EXISTS (
      SELECT 1 FROM inventory_owner_memberships membership
      WHERE membership.user_id = v_uid AND membership.actor_uid = auth.uid()
        AND membership.inventory_owner_id = v_owner_id AND membership.can_operate
    ) THEN RAISE EXCEPTION 'Sin permiso para operar este titular'; END IF;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key, 0));

  SELECT * INTO v_existing
  FROM inventory_product_commands
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.payload <> v_payload THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    SELECT * INTO v_product FROM products
    WHERE user_id = v_uid AND id = v_existing.product_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY io.sort_order), '[]'::jsonb)
    INTO v_holdings
    FROM inventory_holdings h
    JOIN inventory_owners io ON io.user_id = h.user_id AND io.id = h.inventory_owner_id
    WHERE h.user_id = v_uid AND h.product_id = v_existing.product_id
      AND (
        auth.uid() = v_uid
        OR EXISTS (
          SELECT 1 FROM inventory_owner_memberships membership
          WHERE membership.user_id = v_uid
            AND membership.actor_uid = auth.uid()
            AND membership.inventory_owner_id = h.inventory_owner_id
        )
      );
    RETURN jsonb_build_object(
      'product', inventory_shared_product_projection(v_product),
      'holdings', v_holdings
    );
  END IF;

  SELECT (value->>'inventoryOwnerId')::uuid INTO v_primary_owner_id
  FROM jsonb_array_elements(p_holdings)
  WITH ORDINALITY AS requested(value, position)
  WHERE COALESCE((value->>'active')::boolean, true)
  ORDER BY position LIMIT 1;
  IF v_primary_owner_id IS NULL THEN RAISE EXCEPTION 'Debe existir una existencia activa'; END IF;

  SELECT COALESCE(sum((value->>'stock')::integer), 0)::integer INTO v_total_stock
  FROM jsonb_array_elements(p_holdings)
  WHERE COALESCE((value->>'active')::boolean, true);

  INSERT INTO products (
    id, user_id, name, category_id, category, purchase_price, sale_price,
    stock, min_stock, image_url, images, show_in_catalog, notes, description,
    barcode, custom_fields, inventory_owner_id, created_at, updated_at
  ) VALUES (
    v_product_id, v_uid, btrim(p_product->>'name'), COALESCE(p_product->>'categoryId', ''),
    COALESCE(p_product->>'category', ''), 0, COALESCE((p_product->>'salePrice')::numeric, 0),
    v_total_stock, 0, NULLIF(p_product->>'imageUrl', ''),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_product->'images', '[]'::jsonb))),
    COALESCE((p_product->>'showInCatalog')::boolean, false), NULLIF(p_product->>'notes', ''),
    NULLIF(p_product->>'description', ''), NULLIF(p_product->>'barcode', ''),
    p_product->'customFields', v_primary_owner_id,
    COALESCE((p_product->>'createdAt')::timestamptz, now()), now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    category_id = EXCLUDED.category_id,
    category = EXCLUDED.category,
    sale_price = EXCLUDED.sale_price,
    image_url = EXCLUDED.image_url,
    images = EXCLUDED.images,
    show_in_catalog = EXCLUDED.show_in_catalog,
    notes = EXCLUDED.notes,
    description = EXCLUDED.description,
    barcode = EXCLUDED.barcode,
    custom_fields = EXCLUDED.custom_fields,
    updated_at = now()
  WHERE products.user_id = v_uid
  RETURNING * INTO v_product;
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

  INSERT INTO inventory_product_commands (
    user_id, idempotency_key, product_id, actor_uid, payload
  ) VALUES (v_uid, p_idempotency_key, v_product_id, auth.uid(), v_payload);

  FOR v_holding IN SELECT value FROM jsonb_array_elements(p_holdings) LOOP
    v_owner_id := (v_holding->>'inventoryOwnerId')::uuid;
    v_stock := (v_holding->>'stock')::integer;
    v_cost := (v_holding->>'purchaseCost')::numeric;
    v_min := (v_holding->>'minStock')::integer;
    v_active := COALESCE((v_holding->>'active')::boolean, true);
    IF v_stock < 0 OR v_cost < 0 OR v_min < 0 THEN RAISE EXCEPTION 'Valores de existencia inválidos'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM inventory_owners io
      WHERE io.user_id = v_uid AND io.id = v_owner_id AND io.archived_at IS NULL
    ) THEN RAISE EXCEPTION 'Titular inexistente o archivado'; END IF;
    IF auth.uid() <> v_uid AND NOT EXISTS (
      SELECT 1 FROM inventory_owner_memberships membership
      JOIN inventory_owners io
        ON io.user_id = membership.user_id AND io.id = membership.inventory_owner_id
      WHERE membership.user_id = v_uid AND membership.actor_uid = auth.uid()
        AND membership.inventory_owner_id = v_owner_id AND membership.can_operate
        AND io.archived_at IS NULL
    ) THEN RAISE EXCEPTION 'Sin permiso para operar este titular'; END IF;

    SELECT stock INTO v_old_stock FROM inventory_holdings
    WHERE user_id = v_uid AND product_id = v_product_id AND inventory_owner_id = v_owner_id
    FOR UPDATE;
    v_old_stock := COALESCE(v_old_stock, 0);

    INSERT INTO inventory_holdings (
      user_id, product_id, inventory_owner_id, stock, purchase_cost, min_stock, active
    ) VALUES (v_uid, v_product_id, v_owner_id, v_stock, v_cost, v_min, v_active)
    ON CONFLICT (user_id, product_id, inventory_owner_id) DO UPDATE SET
      stock = EXCLUDED.stock, purchase_cost = EXCLUDED.purchase_cost,
      min_stock = EXCLUDED.min_stock, active = EXCLUDED.active, updated_at = now();

    IF v_stock <> v_old_stock THEN
      INSERT INTO inventory_stock_commands (
        user_id, idempotency_key, product_id, product_name, inventory_owner_id,
        inventory_owner_name, actor_uid, delta, reason, resulting_stock
      ) SELECT
        v_uid, p_idempotency_key || ':' || v_owner_id::text, v_product_id,
        v_product.name, v_owner_id, io.name, auth.uid(), v_stock - v_old_stock,
        'Edición de producto y existencias', v_stock
      FROM inventory_owners io WHERE io.user_id = v_uid AND io.id = v_owner_id;
    END IF;
  END LOOP;

  UPDATE products
  SET stock = (
    SELECT COALESCE(sum(stock), 0)::integer
    FROM inventory_holdings
    WHERE user_id = v_uid AND product_id = v_product_id AND active
  ), updated_at = now()
  WHERE user_id = v_uid AND id = v_product_id;

  SELECT * INTO v_product FROM products WHERE user_id = v_uid AND id = v_product_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY io.sort_order), '[]'::jsonb)
  INTO v_holdings
  FROM inventory_holdings h
  JOIN inventory_owners io ON io.user_id = h.user_id AND io.id = h.inventory_owner_id
  WHERE h.user_id = v_uid AND h.product_id = v_product_id
    AND (
      auth.uid() = v_uid
      OR EXISTS (
        SELECT 1 FROM inventory_owner_memberships membership
        WHERE membership.user_id = v_uid
          AND membership.actor_uid = auth.uid()
          AND membership.inventory_owner_id = h.inventory_owner_id
      )
    );
  RETURN jsonb_build_object(
    'product', inventory_shared_product_projection(v_product),
    'holdings', v_holdings
  );
END;
$$;

CREATE OR REPLACE FUNCTION receive_inventory_holding_stock(
  p_product_id uuid,
  p_inventory_owner_id uuid,
  p_quantity integer,
  p_purchase_cost numeric,
  p_supplier text,
  p_notes text,
  p_date date,
  p_idempotency_key text
)
RETURNS stock_intakes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_holding_id uuid;
  v_stock integer;
  v_product_name text;
  v_owner_name text;
  v_intake stock_intakes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticación requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'ingresos', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar ingresos';
  END IF;
  IF p_quantity <= 0 OR p_purchase_cost < 0 THEN RAISE EXCEPTION 'Valores de ingreso inválidos'; END IF;
  IF char_length(p_idempotency_key) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Clave de idempotencia inválida';
  END IF;
  IF NOT COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid), false)
    THEN RAISE EXCEPTION 'El stock compartido no está habilitado'; END IF;

  -- Authorization must be current even when this command is an idempotent replay.
  IF auth.uid() <> v_uid AND NOT EXISTS (
    SELECT 1 FROM inventory_owner_memberships membership
    WHERE membership.user_id = v_uid AND membership.actor_uid = auth.uid()
      AND membership.inventory_owner_id = p_inventory_owner_id AND membership.can_operate
  ) THEN RAISE EXCEPTION 'Sin permiso para operar este titular'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key, 0));

  SELECT * INTO v_intake FROM stock_intakes
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
  IF v_intake.id IS NOT NULL THEN
    IF v_intake.product_id IS DISTINCT FROM p_product_id
       OR v_intake.inventory_owner_id IS DISTINCT FROM p_inventory_owner_id
       OR v_intake.quantity IS DISTINCT FROM p_quantity
       OR v_intake.purchase_price IS DISTINCT FROM p_purchase_cost
       OR v_intake.supplier IS DISTINCT FROM p_supplier
       OR v_intake.notes IS DISTINCT FROM p_notes
       OR v_intake.date IS DISTINCT FROM COALESCE(p_date, CURRENT_DATE) THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    RETURN v_intake;
  END IF;

  SELECT h.id, h.stock, p.name, io.name
  INTO v_holding_id, v_stock, v_product_name, v_owner_name
  FROM inventory_holdings h
  JOIN products p ON p.user_id = h.user_id AND p.id = h.product_id
  JOIN inventory_owners io ON io.user_id = h.user_id AND io.id = h.inventory_owner_id
  WHERE h.user_id = v_uid AND h.product_id = p_product_id
    AND h.inventory_owner_id = p_inventory_owner_id AND h.active
    AND io.archived_at IS NULL
  FOR UPDATE OF h;
  IF v_holding_id IS NULL THEN RAISE EXCEPTION 'Existencia no encontrada o inactiva'; END IF;

  INSERT INTO stock_intakes (
    user_id, date, product_id, product_name, quantity, purchase_price,
    supplier, notes, inventory_owner_id, inventory_owner_name, actor_uid, idempotency_key
  ) VALUES (
    v_uid, COALESCE(p_date, CURRENT_DATE), p_product_id, v_product_name,
    p_quantity, p_purchase_cost, p_supplier, p_notes, p_inventory_owner_id,
    v_owner_name, auth.uid(), p_idempotency_key
  ) RETURNING * INTO v_intake;

  UPDATE inventory_holdings SET stock = stock + p_quantity,
    purchase_cost = p_purchase_cost, updated_at = now()
  WHERE id = v_holding_id;

  INSERT INTO inventory_stock_commands (
    user_id, idempotency_key, product_id, product_name, inventory_owner_id,
    inventory_owner_name, actor_uid, delta, reason, resulting_stock
  ) VALUES (
    v_uid, p_idempotency_key, p_product_id, v_product_name, p_inventory_owner_id,
    v_owner_name, auth.uid(), p_quantity, 'Ingreso de mercadería', v_stock + p_quantity
  );
  RETURN v_intake;
END;
$$;

CREATE OR REPLACE FUNCTION mutate_inventory_holding_stock(
  p_product_id uuid,
  p_inventory_owner_id uuid,
  p_delta integer,
  p_reason text,
  p_idempotency_key text
)
RETURNS inventory_stock_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_holding_id uuid;
  v_holding_stock integer;
  v_command inventory_stock_commands%ROWTYPE;
  v_product_name text;
  v_owner_name text;
  v_result integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticación requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para modificar stock';
  END IF;
  IF p_delta = 0 THEN RAISE EXCEPTION 'La variación de stock no puede ser cero'; END IF;
  IF char_length(btrim(p_reason)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'El motivo debe tener entre 1 y 300 caracteres';
  END IF;
  IF char_length(p_idempotency_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Clave de idempotencia inválida';
  END IF;
  IF NOT COALESCE((
    SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid
  ), false) THEN
    RAISE EXCEPTION 'La operación por titulares todavía no está habilitada';
  END IF;

  -- Authorization precedes replay so revoked memberships cannot read old commands.
  IF auth.uid() <> v_uid AND NOT EXISTS (
    SELECT 1 FROM inventory_owner_memberships membership
    WHERE membership.user_id = v_uid
      AND membership.actor_uid = auth.uid()
      AND membership.inventory_owner_id = p_inventory_owner_id
      AND membership.can_operate
  ) THEN
    RAISE EXCEPTION 'Sin permiso para operar este titular';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key, 0));

  SELECT * INTO v_command
  FROM inventory_stock_commands
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
  IF v_command.id IS NOT NULL THEN
    IF v_command.product_id <> p_product_id
       OR v_command.inventory_owner_id <> p_inventory_owner_id
       OR v_command.delta <> p_delta
       OR v_command.reason <> btrim(p_reason) THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    RETURN v_command;
  END IF;

  SELECT h.id, h.stock, p.name, io.name
  INTO v_holding_id, v_holding_stock, v_product_name, v_owner_name
  FROM inventory_holdings h
  JOIN products p ON p.user_id = h.user_id AND p.id = h.product_id
  JOIN inventory_owners io
    ON io.user_id = h.user_id
   AND io.id = h.inventory_owner_id
   AND io.archived_at IS NULL
  WHERE h.user_id = v_uid
    AND h.product_id = p_product_id
    AND h.inventory_owner_id = p_inventory_owner_id
    AND h.active
  FOR UPDATE;
  IF v_holding_id IS NULL THEN RAISE EXCEPTION 'Existencia no encontrada o inactiva'; END IF;

  v_result := v_holding_stock + p_delta;
  IF v_result < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponible: %, solicitado: %',
      v_holding_stock, abs(p_delta);
  END IF;

  INSERT INTO inventory_stock_commands (
    user_id, idempotency_key, product_id, product_name,
    inventory_owner_id, inventory_owner_name, actor_uid,
    delta, reason, resulting_stock
  ) VALUES (
    v_uid, p_idempotency_key, p_product_id, v_product_name,
    p_inventory_owner_id, v_owner_name, auth.uid(),
    p_delta, btrim(p_reason), v_result
  ) RETURNING * INTO v_command;

  UPDATE inventory_holdings
  SET stock = v_result, updated_at = now()
  WHERE id = v_holding_id;
  RETURN v_command;
END;
$$;

CREATE OR REPLACE FUNCTION transfer_inventory_holding_stock(
  p_product_id uuid,
  p_source_owner_id uuid,
  p_destination_owner_id uuid,
  p_quantity integer,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source inventory_stock_commands%ROWTYPE;
  v_destination inventory_stock_commands%ROWTYPE;
BEGIN
  IF p_source_owner_id = p_destination_owner_id THEN
    RAISE EXCEPTION 'Los titulares de origen y destino deben ser distintos';
  END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser positiva'; END IF;
  IF char_length(p_idempotency_key) NOT BETWEEN 1 AND 190 THEN
    RAISE EXCEPTION 'Clave de idempotencia inválida';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_product_id::text, 0));
  v_source := mutate_inventory_holding_stock(
    p_product_id, p_source_owner_id, -p_quantity,
    btrim(p_reason) || ' (transferencia saliente)', p_idempotency_key || ':out'
  );
  v_destination := mutate_inventory_holding_stock(
    p_product_id, p_destination_owner_id, p_quantity,
    btrim(p_reason) || ' (transferencia entrante)', p_idempotency_key || ':in'
  );
  RETURN jsonb_build_object(
    'source', to_jsonb(v_source),
    'destination', to_jsonb(v_destination)
  );
END;
$$;

-- New activation remains paused until sale and return stock writers use holdings.
CREATE OR REPLACE FUNCTION set_inventory_holdings_enabled(p_enabled boolean)
RETURNS inventory_operation_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_row inventory_operation_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticación requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'config', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para cambiar la configuración';
  END IF;

  IF p_enabled THEN
    RAISE EXCEPTION 'La activación de stock compartido está pausada hasta adaptar ventas y devoluciones';
  END IF;

  INSERT INTO inventory_operation_settings (user_id, holdings_enabled, updated_at)
  VALUES (v_uid, false, now())
  ON CONFLICT (user_id) DO UPDATE
    SET holdings_enabled = false,
        updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION save_product_with_holdings(jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION inventory_shared_product_projection(products) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION receive_inventory_holding_stock(uuid, uuid, integer, numeric, text, text, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION set_inventory_holdings_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_product_with_holdings(jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION receive_inventory_holding_stock(uuid, uuid, integer, numeric, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_inventory_holdings_enabled(boolean) TO authenticated;

COMMIT;
