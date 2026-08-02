-- 0032_inventory_holdings.sql
-- Add owner-scoped inventory balances while keeping the 0031 product contract reversible.

BEGIN;

ALTER TABLE products
  ADD CONSTRAINT products_user_id_id_unique UNIQUE (user_id, id);

CREATE TABLE inventory_holdings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id         uuid NOT NULL,
  inventory_owner_id uuid NOT NULL,
  stock              integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  purchase_cost      numeric NOT NULL DEFAULT 0 CHECK (purchase_cost >= 0),
  min_stock          integer NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id, inventory_owner_id),
  UNIQUE (user_id, id),
  CONSTRAINT inventory_holdings_product_tenant_fk
    FOREIGN KEY (user_id, product_id)
    REFERENCES products (user_id, id) ON DELETE CASCADE,
  CONSTRAINT inventory_holdings_owner_tenant_fk
    FOREIGN KEY (user_id, inventory_owner_id)
    REFERENCES inventory_owners (user_id, id) ON DELETE RESTRICT
);

CREATE INDEX inventory_holdings_product_idx
  ON inventory_holdings (user_id, product_id, active);
CREATE INDEX inventory_holdings_owner_idx
  ON inventory_holdings (user_id, inventory_owner_id, active);

CREATE TABLE inventory_owner_memberships (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_uid          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_owner_id uuid NOT NULL,
  is_default         boolean NOT NULL DEFAULT false,
  can_operate        boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, actor_uid, inventory_owner_id),
  CONSTRAINT inventory_owner_memberships_owner_tenant_fk
    FOREIGN KEY (user_id, inventory_owner_id)
    REFERENCES inventory_owners (user_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX inventory_owner_memberships_default_idx
  ON inventory_owner_memberships (user_id, actor_uid)
  WHERE is_default;

CREATE TABLE inventory_operation_settings (
  user_id          uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  holdings_enabled boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_stock_commands (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  idempotency_key      text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  product_id           uuid NOT NULL,
  product_name         text NOT NULL,
  inventory_owner_id   uuid NOT NULL,
  inventory_owner_name text NOT NULL,
  actor_uid            uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  delta                 integer NOT NULL CHECK (delta <> 0),
  reason                text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 300),
  resulting_stock       integer CHECK (resulting_stock >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CONSTRAINT inventory_stock_commands_product_tenant_fk
    FOREIGN KEY (user_id, product_id)
    REFERENCES products (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_stock_commands_owner_tenant_fk
    FOREIGN KEY (user_id, inventory_owner_id)
    REFERENCES inventory_owners (user_id, id) ON DELETE RESTRICT
);

CREATE INDEX inventory_stock_commands_product_idx
  ON inventory_stock_commands (user_id, product_id, created_at DESC);
CREATE INDEX inventory_stock_commands_owner_idx
  ON inventory_stock_commands (user_id, inventory_owner_id, created_at DESC);

INSERT INTO inventory_operation_settings (user_id, holdings_enabled)
SELECT id, false
FROM profiles
ON CONFLICT (user_id) DO NOTHING;

-- Backfill uses stable product IDs and the exact owner assigned by 0031. It is
-- deliberately not grouped by display fields, so ambiguous duplicate products
-- remain independent and retries cannot duplicate a holding.
INSERT INTO inventory_holdings (
  user_id, product_id, inventory_owner_id, stock, purchase_cost, min_stock, active
)
SELECT
  p.user_id,
  p.id,
  p.inventory_owner_id,
  p.stock,
  p.purchase_price,
  p.min_stock,
  true
FROM products p
ON CONFLICT (user_id, product_id, inventory_owner_id) DO NOTHING;

-- Membership backfill grants the account principal every owner and preserves
-- existing collaborator module permissions. The primary owner is deterministic.
INSERT INTO inventory_owner_memberships (
  user_id, actor_uid, inventory_owner_id, is_default, can_operate
)
SELECT io.user_id, io.user_id, io.id, io.is_primary, true
FROM inventory_owners io
ON CONFLICT (user_id, actor_uid, inventory_owner_id) DO NOTHING;

INSERT INTO inventory_owner_memberships (
  user_id, actor_uid, inventory_owner_id, is_default, can_operate
)
SELECT
  c.owner_uid,
  c.user_uid,
  io.id,
  io.is_primary,
  has_permission(c.user_uid, 'stock', 'write')
FROM collaborators c
JOIN inventory_owners io ON io.user_id = c.owner_uid
WHERE c.revoked_at IS NULL
ON CONFLICT (user_id, actor_uid, inventory_owner_id) DO NOTHING;

ALTER TABLE inventory_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_owner_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_operation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_holdings_select" ON inventory_holdings
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'read')
  );

CREATE POLICY "inventory_owner_memberships_select" ON inventory_owner_memberships
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND (actor_uid = auth.uid() OR user_id = auth.uid())
  );

CREATE POLICY "inventory_operation_settings_select" ON inventory_operation_settings
  FOR SELECT USING (user_id = get_owner_uid(auth.uid()));

CREATE POLICY "inventory_stock_commands_select" ON inventory_stock_commands
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'read')
  );

-- No INSERT/UPDATE/DELETE policies are provided. Holdings, memberships,
-- settings and commands are mutated only through vetted triggers and RPCs.
REVOKE INSERT, UPDATE, DELETE ON inventory_holdings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON inventory_owner_memberships FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON inventory_operation_settings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON inventory_stock_commands FROM anon, authenticated;
GRANT SELECT ON inventory_holdings TO authenticated;
GRANT SELECT ON inventory_owner_memberships TO authenticated;
GRANT SELECT ON inventory_operation_settings TO authenticated;
GRANT SELECT ON inventory_stock_commands TO authenticated;

CREATE OR REPLACE FUNCTION seed_inventory_settings_for_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO inventory_operation_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_seed_inventory_settings
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION seed_inventory_settings_for_profile();

CREATE OR REPLACE FUNCTION seed_inventory_owner_memberships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO inventory_owner_memberships (
    user_id, actor_uid, inventory_owner_id, is_default, can_operate
  )
  VALUES (NEW.user_id, NEW.user_id, NEW.id, NEW.is_primary, true)
  ON CONFLICT (user_id, actor_uid, inventory_owner_id) DO UPDATE
    SET is_default = EXCLUDED.is_default,
        can_operate = true,
        updated_at = now();

  INSERT INTO inventory_owner_memberships (
    user_id, actor_uid, inventory_owner_id, is_default, can_operate
  )
  SELECT
    NEW.user_id,
    c.user_uid,
    NEW.id,
    NEW.is_primary,
    has_permission(c.user_uid, 'stock', 'write')
  FROM collaborators c
  WHERE c.owner_uid = NEW.user_id AND c.revoked_at IS NULL
  ON CONFLICT (user_id, actor_uid, inventory_owner_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_owners_seed_memberships
  AFTER INSERT ON inventory_owners
  FOR EACH ROW EXECUTE FUNCTION seed_inventory_owner_memberships();

CREATE OR REPLACE FUNCTION seed_collaborator_inventory_memberships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.revoked_at IS NULL THEN
    INSERT INTO inventory_owner_memberships (
      user_id, actor_uid, inventory_owner_id, is_default, can_operate
    )
    SELECT
      NEW.owner_uid,
      NEW.user_uid,
      io.id,
      io.is_primary,
      has_permission(NEW.user_uid, 'stock', 'write')
    FROM inventory_owners io
    WHERE io.user_id = NEW.owner_uid
    ON CONFLICT (user_id, actor_uid, inventory_owner_id) DO UPDATE
      SET can_operate = EXCLUDED.can_operate,
          updated_at = now();
  ELSE
    UPDATE inventory_owner_memberships
    SET can_operate = false, updated_at = now()
    WHERE user_id = NEW.owner_uid AND actor_uid = NEW.user_uid;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collaborators_seed_inventory_memberships
  AFTER INSERT OR UPDATE OF permissions, revoked_at ON collaborators
  FOR EACH ROW EXECUTE FUNCTION seed_collaborator_inventory_memberships();

-- Legacy product writes own the single holding while the feature is disabled.
-- Once enabled, holdings become authoritative and products remain read mirrors.
CREATE OR REPLACE FUNCTION sync_product_to_inventory_holding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF current_setting('app.inventory_holding_sync', true) = 'holding_to_product' THEN
    RETURN NEW;
  END IF;

  SELECT holdings_enabled INTO v_enabled
  FROM inventory_operation_settings
  WHERE user_id = NEW.user_id;
  IF COALESCE(v_enabled, false) THEN RETURN NEW; END IF;

  PERFORM set_config('app.inventory_holding_sync', 'product_to_holding', true);
  DELETE FROM inventory_holdings
  WHERE user_id = NEW.user_id AND product_id = NEW.id;
  INSERT INTO inventory_holdings (
    user_id, product_id, inventory_owner_id, stock, purchase_cost, min_stock, active
  ) VALUES (
    NEW.user_id, NEW.id, NEW.inventory_owner_id,
    NEW.stock, NEW.purchase_price, NEW.min_stock, true
  )
  ON CONFLICT (user_id, product_id, inventory_owner_id) DO UPDATE
    SET stock = EXCLUDED.stock,
        purchase_cost = EXCLUDED.purchase_cost,
        min_stock = EXCLUDED.min_stock,
        active = true,
        updated_at = now();
  PERFORM set_config('app.inventory_holding_sync', '', true);
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_sync_inventory_holding
  AFTER INSERT OR UPDATE OF stock, purchase_price, min_stock, inventory_owner_id ON products
  FOR EACH ROW EXECUTE FUNCTION sync_product_to_inventory_holding();

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

CREATE TRIGGER inventory_holdings_sync_product
  AFTER INSERT OR UPDATE OF stock, purchase_cost, min_stock, active OR DELETE
  ON inventory_holdings
  FOR EACH ROW EXECUTE FUNCTION sync_inventory_holdings_to_product();

CREATE OR REPLACE FUNCTION deactivate_archived_owner_holdings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    UPDATE inventory_holdings
    SET active = false, updated_at = now()
    WHERE user_id = NEW.user_id AND inventory_owner_id = NEW.id AND active;
    UPDATE inventory_owner_memberships
    SET can_operate = false, updated_at = now()
    WHERE user_id = NEW.user_id AND inventory_owner_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_owners_deactivate_holdings
  AFTER UPDATE OF archived_at ON inventory_owners
  FOR EACH ROW EXECUTE FUNCTION deactivate_archived_owner_holdings();

CREATE OR REPLACE FUNCTION list_inventory_holding_allocation_candidates(p_product_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  product_id uuid,
  inventory_owner_id uuid,
  stock integer,
  purchase_cost numeric,
  min_stock integer,
  active boolean,
  owner_sort_order integer,
  is_default boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    h.id, h.user_id, h.product_id, h.inventory_owner_id,
    h.stock, h.purchase_cost, h.min_stock, h.active,
    io.sort_order, membership.is_default
  FROM inventory_holdings h
  JOIN inventory_owners io
    ON io.user_id = h.user_id AND io.id = h.inventory_owner_id
  JOIN inventory_owner_memberships membership
    ON membership.user_id = h.user_id
   AND membership.inventory_owner_id = h.inventory_owner_id
   AND membership.actor_uid = auth.uid()
   AND membership.can_operate
  WHERE h.user_id = get_owner_uid(auth.uid())
    AND h.product_id = p_product_id
    AND h.active
    AND io.archived_at IS NULL
    AND h.stock > 0
    AND has_permission(auth.uid(), 'stock', 'read')
  ORDER BY membership.is_default DESC, io.sort_order, h.id;
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

  IF auth.uid() <> v_uid AND NOT EXISTS (
    SELECT 1 FROM inventory_owner_memberships membership
    WHERE membership.user_id = v_uid
      AND membership.actor_uid = auth.uid()
      AND membership.inventory_owner_id = p_inventory_owner_id
      AND membership.can_operate
  ) THEN
    RAISE EXCEPTION 'Sin permiso para operar este titular';
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
  )
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING * INTO v_command;

  IF v_command.id IS NULL THEN
    SELECT * INTO v_command
    FROM inventory_stock_commands
    WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
    IF v_command.product_id <> p_product_id
       OR v_command.inventory_owner_id <> p_inventory_owner_id
       OR v_command.delta <> p_delta
       OR v_command.reason <> btrim(p_reason) THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    RETURN v_command;
  END IF;

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

  -- Serialize transfers for one product; nested mutations remain one transaction.
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
  INSERT INTO inventory_operation_settings (user_id, holdings_enabled, updated_at)
  VALUES (v_uid, p_enabled, now())
  ON CONFLICT (user_id) DO UPDATE
    SET holdings_enabled = EXCLUDED.holdings_enabled,
        updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION seed_inventory_settings_for_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION seed_inventory_owner_memberships() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION seed_collaborator_inventory_memberships() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_product_to_inventory_holding() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_inventory_holdings_to_product() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION deactivate_archived_owner_holdings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION list_inventory_holding_allocation_candidates(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mutate_inventory_holding_stock(uuid, uuid, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION transfer_inventory_holding_stock(uuid, uuid, uuid, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION set_inventory_holdings_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION list_inventory_holding_allocation_candidates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mutate_inventory_holding_stock(uuid, uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_inventory_holding_stock(uuid, uuid, uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_inventory_holdings_enabled(boolean) TO authenticated;

COMMIT;
