-- 0034_attributed_sales.sql
-- Normalized, immutable owner attribution for every sale writer. Legacy sale
-- RPCs remain compatible; table triggers make holdings authoritative when the
-- rollout flag is eventually enabled by the Phase 4 clients.

BEGIN;

-- Phase 4 still has to provide stable request keys from every client path.
UPDATE inventory_operation_settings
SET holdings_enabled = false,
    updated_at = now()
WHERE holdings_enabled;

ALTER TABLE sales
  ADD CONSTRAINT sales_user_id_id_unique UNIQUE (user_id, id);

ALTER TABLE cash_flow
  ADD CONSTRAINT cash_flow_user_id_id_unique UNIQUE (user_id, id);

CREATE TABLE sale_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sale_id               uuid,
  sale_id_snapshot      uuid NOT NULL,
  revision              integer NOT NULL CHECK (revision > 0),
  line_number           integer NOT NULL CHECK (line_number > 0),
  product_id            uuid,
  product_id_snapshot   uuid,
  product_name_snapshot text NOT NULL,
  quantity              integer NOT NULL CHECK (quantity > 0),
  unit_price            numeric NOT NULL CHECK (unit_price >= 0),
  unit_discount         numeric NOT NULL DEFAULT 0 CHECK (unit_discount >= 0),
  discount_amount       numeric NOT NULL DEFAULT 0,
  adjustment_share      numeric NOT NULL DEFAULT 0,
  line_total            numeric NOT NULL,
  actor_uid             uuid,
  snapshot_source       text NOT NULL
    CHECK (snapshot_source IN ('captured', 'legacy_runtime', 'legacy_estimated')),
  snapshot_reason       text,
  reversed_at           timestamptz,
  reversal_reason       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sale_id_snapshot, revision, line_number),
  UNIQUE (user_id, id),
  CONSTRAINT sale_items_sale_tenant_fk
    FOREIGN KEY (user_id, sale_id)
    REFERENCES sales (user_id, id) ON DELETE SET NULL (sale_id),
  CONSTRAINT sale_items_product_tenant_fk
    FOREIGN KEY (user_id, product_id)
    REFERENCES products (user_id, id) ON DELETE SET NULL (product_id)
);

CREATE INDEX sale_items_sale_idx
  ON sale_items (user_id, sale_id_snapshot, revision, line_number);
CREATE INDEX sale_items_product_idx
  ON sale_items (user_id, product_id_snapshot, created_at DESC);

CREATE TABLE sale_item_allocations (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sale_id                       uuid,
  sale_id_snapshot              uuid NOT NULL,
  sale_item_id                  uuid NOT NULL,
  inventory_holding_id          uuid,
  inventory_owner_id            uuid,
  inventory_owner_id_snapshot   uuid NOT NULL,
  inventory_owner_name_snapshot text NOT NULL,
  product_id_snapshot           uuid,
  product_name_snapshot         text NOT NULL,
  quantity                      integer NOT NULL CHECK (quantity > 0),
  unit_price                    numeric NOT NULL CHECK (unit_price >= 0),
  unit_cost                     numeric NOT NULL CHECK (unit_cost >= 0),
  discount_share                numeric NOT NULL DEFAULT 0,
  adjustment_share              numeric NOT NULL DEFAULT 0,
  revenue_share                 numeric NOT NULL,
  cost_share                    numeric NOT NULL CHECK (cost_share >= 0),
  allocation_source             text NOT NULL
    CHECK (allocation_source IN ('manual_override', 'default', 'priority', 'legacy_estimated')),
  actor_uid                     uuid,
  snapshot_reason               text,
  reversed_at                   timestamptz,
  reversal_reason               text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  CONSTRAINT sale_item_allocations_sale_tenant_fk
    FOREIGN KEY (user_id, sale_id)
    REFERENCES sales (user_id, id) ON DELETE SET NULL (sale_id),
  CONSTRAINT sale_item_allocations_item_tenant_fk
    FOREIGN KEY (user_id, sale_item_id)
    REFERENCES sale_items (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_item_allocations_holding_tenant_fk
    FOREIGN KEY (user_id, inventory_holding_id)
    REFERENCES inventory_holdings (user_id, id) ON DELETE SET NULL (inventory_holding_id),
  CONSTRAINT sale_item_allocations_owner_tenant_fk
    FOREIGN KEY (user_id, inventory_owner_id)
    REFERENCES inventory_owners (user_id, id) ON DELETE SET NULL (inventory_owner_id)
);

CREATE INDEX sale_item_allocations_sale_idx
  ON sale_item_allocations (user_id, sale_id_snapshot, reversed_at);
CREATE INDEX sale_item_allocations_owner_idx
  ON sale_item_allocations (user_id, inventory_owner_id_snapshot, created_at DESC);

CREATE TABLE stock_movements (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  idempotency_key               text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 240),
  product_id_snapshot           uuid,
  product_name_snapshot         text NOT NULL,
  inventory_owner_id_snapshot   uuid NOT NULL,
  inventory_owner_name_snapshot text NOT NULL,
  sale_id_snapshot              uuid,
  sale_item_id                  uuid,
  sale_item_allocation_id       uuid,
  actor_uid                     uuid,
  movement_type                 text NOT NULL
    CHECK (movement_type IN ('sale', 'edit_restore', 'refund')),
  delta                         integer NOT NULL CHECK (delta <> 0),
  resulting_stock               integer NOT NULL CHECK (resulting_stock >= 0),
  unit_cost_snapshot            numeric NOT NULL CHECK (unit_cost_snapshot >= 0),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CONSTRAINT stock_movements_item_tenant_fk
    FOREIGN KEY (user_id, sale_item_id)
    REFERENCES sale_items (user_id, id) ON DELETE SET NULL (sale_item_id),
  CONSTRAINT stock_movements_allocation_tenant_fk
    FOREIGN KEY (user_id, sale_item_allocation_id)
    REFERENCES sale_item_allocations (user_id, id) ON DELETE SET NULL (sale_item_allocation_id)
);

CREATE INDEX stock_movements_product_idx
  ON stock_movements (user_id, product_id_snapshot, created_at DESC);
CREATE INDEX stock_movements_owner_idx
  ON stock_movements (user_id, inventory_owner_id_snapshot, created_at DESC);

CREATE TABLE cash_flow_allocations (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cash_flow_id                  uuid,
  cash_flow_id_snapshot         uuid NOT NULL,
  sale_id_snapshot              uuid NOT NULL,
  inventory_owner_id            uuid,
  inventory_owner_id_snapshot   uuid NOT NULL,
  inventory_owner_name_snapshot text NOT NULL,
  amount                        numeric NOT NULL,
  cost_amount                   numeric NOT NULL CHECK (cost_amount >= 0),
  actor_uid                     uuid,
  snapshot_source               text NOT NULL,
  snapshot_reason               text,
  reversed_at                   timestamptz,
  reversal_reason               text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_flow_allocations_cash_tenant_fk
    FOREIGN KEY (user_id, cash_flow_id)
    REFERENCES cash_flow (user_id, id) ON DELETE SET NULL (cash_flow_id),
  CONSTRAINT cash_flow_allocations_owner_tenant_fk
    FOREIGN KEY (user_id, inventory_owner_id)
    REFERENCES inventory_owners (user_id, id) ON DELETE SET NULL (inventory_owner_id)
);

CREATE INDEX cash_flow_allocations_sale_idx
  ON cash_flow_allocations (user_id, sale_id_snapshot, reversed_at);
CREATE INDEX cash_flow_allocations_owner_idx
  ON cash_flow_allocations (user_id, inventory_owner_id_snapshot, created_at DESC);

CREATE TABLE attributed_sale_commands (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  idempotency_key     text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 180),
  operation           text NOT NULL CHECK (operation IN ('register', 'edit', 'refund')),
  sale_id             uuid,
  sale_id_snapshot    uuid NOT NULL,
  actor_uid           uuid NOT NULL,
  payload             jsonb NOT NULL,
  request_fingerprint text NOT NULL,
  result              jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CONSTRAINT attributed_sale_commands_sale_tenant_fk
    FOREIGN KEY (user_id, sale_id)
    REFERENCES sales (user_id, id) ON DELETE SET NULL (sale_id)
);

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_item_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attributed_sale_commands ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION can_read_complete_sale_item(
  p_user_id uuid,
  p_sale_item_id uuid,
  p_actor_uid uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_actor_uid = auth.uid()
    AND p_user_id = get_owner_uid(auth.uid())
    AND (
      p_actor_uid = p_user_id
      OR (
      EXISTS (
        SELECT 1 FROM sale_item_allocations allocation
        WHERE allocation.user_id = p_user_id
          AND allocation.sale_item_id = p_sale_item_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sale_item_allocations allocation
        WHERE allocation.user_id = p_user_id
          AND allocation.sale_item_id = p_sale_item_id
          AND NOT EXISTS (
            SELECT 1 FROM inventory_owner_memberships membership
            WHERE membership.user_id = allocation.user_id
              AND membership.actor_uid = p_actor_uid
              AND membership.inventory_owner_id = allocation.inventory_owner_id_snapshot
          )
      )
    ));
$$;

CREATE POLICY "sale_items_select" ON sale_items
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'ventas', 'read')
    AND can_read_complete_sale_item(user_id, id, auth.uid())
  );

CREATE POLICY "sale_item_allocations_select" ON sale_item_allocations
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'ventas', 'read')
    AND (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1 FROM inventory_owner_memberships membership
        WHERE membership.user_id = sale_item_allocations.user_id
          AND membership.actor_uid = auth.uid()
          AND membership.inventory_owner_id = sale_item_allocations.inventory_owner_id_snapshot
      )
    )
  );

CREATE POLICY "stock_movements_select" ON stock_movements
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'read')
    AND (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1 FROM inventory_owner_memberships membership
        WHERE membership.user_id = stock_movements.user_id
          AND membership.actor_uid = auth.uid()
          AND membership.inventory_owner_id = stock_movements.inventory_owner_id_snapshot
      )
    )
  );

CREATE POLICY "cash_flow_allocations_select" ON cash_flow_allocations
  FOR SELECT USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'caja', 'read')
    AND (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1 FROM inventory_owner_memberships membership
        WHERE membership.user_id = cash_flow_allocations.user_id
          AND membership.actor_uid = auth.uid()
          AND membership.inventory_owner_id = cash_flow_allocations.inventory_owner_id_snapshot
      )
    )
  );

REVOKE ALL ON sale_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sale_item_allocations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON stock_movements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON cash_flow_allocations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON attributed_sale_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT ON sale_items TO authenticated;
GRANT SELECT ON sale_item_allocations TO authenticated;
GRANT SELECT ON stock_movements TO authenticated;
GRANT SELECT ON cash_flow_allocations TO authenticated;
REVOKE ALL ON FUNCTION can_read_complete_sale_item(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_read_complete_sale_item(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION lock_inventory_products(
  p_user_id uuid,
  p_product_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id uuid;
BEGIN
  FOR v_product_id IN
    SELECT DISTINCT requested.product_id
    FROM unnest(COALESCE(p_product_ids, ARRAY[]::uuid[])) requested(product_id)
    WHERE requested.product_id IS NOT NULL
    ORDER BY requested.product_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('product:' || p_user_id::text || ':' || v_product_id::text, 0)
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION lock_inventory_commands(
  p_user_id uuid,
  p_command_keys text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_command_key text;
BEGIN
  FOR v_command_key IN
    SELECT DISTINCT requested.command_key
    FROM unnest(COALESCE(p_command_keys, ARRAY[]::text[])) requested(command_key)
    WHERE requested.command_key IS NOT NULL
    ORDER BY requested.command_key
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('command:' || p_user_id::text || ':' || v_command_key, 0)
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION sale_product_ids(
  p_items jsonb,
  p_fallback_product_id uuid DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT candidate.product_id ORDER BY candidate.product_id), ARRAY[]::uuid[])
  FROM (
    SELECT p_fallback_product_id AS product_id
    UNION ALL
    SELECT NULLIF(item->>'productId', '')::uuid
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END
    ) item
  ) candidate
  WHERE candidate.product_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION resync_inventory_product_mirrors(
  p_user_id uuid,
  p_product_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id uuid;
  v_stock integer;
  v_representative inventory_holdings%ROWTYPE;
BEGIN
  FOR v_product_id IN
    SELECT DISTINCT requested.product_id
    FROM unnest(COALESCE(p_product_ids, ARRAY[]::uuid[])) requested(product_id)
    WHERE requested.product_id IS NOT NULL
    ORDER BY requested.product_id
  LOOP
    SELECT COALESCE(sum(holding.stock), 0)::integer INTO v_stock
    FROM inventory_holdings holding
    WHERE holding.user_id = p_user_id
      AND holding.product_id = v_product_id
      AND holding.active;

    v_representative := NULL;
    SELECT holding.* INTO v_representative
    FROM inventory_holdings holding
    JOIN inventory_owners owner
      ON owner.user_id = holding.user_id
     AND owner.id = holding.inventory_owner_id
    WHERE holding.user_id = p_user_id
      AND holding.product_id = v_product_id
      AND holding.active
      AND owner.archived_at IS NULL
    ORDER BY owner.sort_order, holding.id
    LIMIT 1;

    PERFORM set_config('app.inventory_holding_sync', 'holding_to_product', true);
    UPDATE products
    SET stock = v_stock,
        purchase_price = COALESCE(v_representative.purchase_cost, purchase_price),
        min_stock = COALESCE(v_representative.min_stock, min_stock),
        inventory_owner_id = COALESCE(v_representative.inventory_owner_id, inventory_owner_id),
        updated_at = now()
    WHERE user_id = p_user_id AND id = v_product_id;
    PERFORM set_config('app.inventory_holding_sync', '', true);
  END LOOP;
END;
$$;

-- Keep mirror-trigger locking in the same product namespace as every public
-- stock and sale writer. The wrapper lock is re-entrant inside a transaction.
CREATE OR REPLACE FUNCTION sync_inventory_holdings_to_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := COALESCE(NEW.user_id, OLD.user_id);
  v_product_id uuid := COALESCE(NEW.product_id, OLD.product_id);
BEGIN
  IF current_setting('app.inventory_holding_sync', true) = 'product_to_holding' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM lock_inventory_products(v_user_id, ARRAY[v_product_id]);
  PERFORM resync_inventory_product_mirrors(v_user_id, ARRAY[v_product_id]);
  RETURN COALESCE(NEW, OLD);
END;
$$;

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
    SELECT inventory_owner_id_snapshot, round(sum(cost_share), 2) AS cost
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
        ELSE round(v_share.cost * v_cash.amount / v_total_cash, 2)
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

CREATE OR REPLACE FUNCTION reverse_current_sale_revision(
  p_sale_id uuid,
  p_reason text,
  p_mutate_stock boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allocation sale_item_allocations%ROWTYPE;
  v_holding inventory_holdings%ROWTYPE;
  v_resulting_stock integer;
BEGIN
  FOR v_allocation IN
    SELECT allocation.*
    FROM sale_item_allocations allocation
    WHERE allocation.sale_id_snapshot = p_sale_id
      AND allocation.reversed_at IS NULL
    ORDER BY allocation.product_id_snapshot, allocation.inventory_owner_id_snapshot, allocation.id
    FOR UPDATE
  LOOP
    IF p_mutate_stock AND v_allocation.inventory_holding_id IS NOT NULL THEN
      SELECT * INTO v_holding
      FROM inventory_holdings
      WHERE user_id = v_allocation.user_id
        AND id = v_allocation.inventory_holding_id
      FOR UPDATE;
      IF v_holding.id IS NULL THEN
        RAISE EXCEPTION 'No se puede revertir la venta: existencia historica no disponible';
      END IF;

      UPDATE inventory_holdings
      SET stock = stock + v_allocation.quantity,
          updated_at = now()
      WHERE user_id = v_holding.user_id AND id = v_holding.id
      RETURNING stock INTO v_resulting_stock;

      INSERT INTO stock_movements (
        user_id, idempotency_key, product_id_snapshot, product_name_snapshot,
        inventory_owner_id_snapshot, inventory_owner_name_snapshot,
        sale_id_snapshot, sale_item_id, sale_item_allocation_id, actor_uid,
        movement_type, delta, resulting_stock, unit_cost_snapshot
      ) VALUES (
        v_allocation.user_id,
        'sale:' || p_sale_id::text || ':allocation:' || v_allocation.id::text || ':' || p_reason,
        v_allocation.product_id_snapshot, v_allocation.product_name_snapshot,
        v_allocation.inventory_owner_id_snapshot, v_allocation.inventory_owner_name_snapshot,
        p_sale_id, v_allocation.sale_item_id, v_allocation.id, auth.uid(),
        CASE WHEN p_reason = 'refund' THEN 'refund' ELSE 'edit_restore' END,
        v_allocation.quantity, v_resulting_stock, v_allocation.unit_cost
      ) ON CONFLICT (user_id, idempotency_key) DO NOTHING;
    ELSIF p_mutate_stock AND v_allocation.allocation_source <> 'legacy_estimated' THEN
      RAISE EXCEPTION 'No se puede revertir la venta: existencia historica no disponible';
    END IF;
  END LOOP;

  UPDATE sale_item_allocations
  SET reversed_at = now(), reversal_reason = p_reason
  WHERE sale_id_snapshot = p_sale_id AND reversed_at IS NULL;

  UPDATE sale_items
  SET reversed_at = now(), reversal_reason = p_reason
  WHERE sale_id_snapshot = p_sale_id AND reversed_at IS NULL;

  UPDATE cash_flow_allocations
  SET reversed_at = now(), reversal_reason = p_reason
  WHERE sale_id_snapshot = p_sale_id AND reversed_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION attribute_current_sale_revision(
  p_sale sales,
  p_mutate_stock boolean,
  p_snapshot_source text DEFAULT 'captured'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_revision integer;
  v_items jsonb;
  v_preferences jsonb := '[]'::jsonb;
  v_line_count integer;
  v_line_index integer;
  v_item jsonb;
  v_product products%ROWTYPE;
  v_product_id uuid;
  v_product_name text;
  v_quantity integer;
  v_unit_price numeric;
  v_unit_discount numeric;
  v_line_base numeric;
  v_base_total numeric := 0;
  v_effective_adjustment numeric;
  v_remaining_adjustment numeric;
  v_line_adjustment numeric;
  v_line_total numeric;
  v_sale_item_id uuid;
  v_preferred_owner_id uuid;
  v_candidate record;
  v_remaining_quantity integer;
  v_allocate_quantity integer;
  v_allocation_count integer;
  v_is_last_allocation boolean;
  v_allocation_adjustment numeric;
  v_remaining_line_adjustment numeric;
  v_remaining_line_revenue numeric;
  v_remaining_line_discount numeric;
  v_line_cost_total numeric;
  v_remaining_line_cost numeric;
  v_cost_remaining_quantity integer;
  v_discount_share numeric;
  v_revenue_share numeric;
  v_cost_share numeric;
  v_allocation_source text;
  v_allocation_id uuid;
  v_resulting_stock integer;
BEGIN
  IF p_snapshot_source NOT IN ('captured', 'legacy_runtime') THEN
    RAISE EXCEPTION 'Fuente de captura invalida';
  END IF;

  v_revision := COALESCE((
    SELECT max(revision) FROM sale_items
    WHERE user_id = p_sale.user_id AND sale_id_snapshot = p_sale.id
  ), 0) + 1;

  IF p_sale.items IS NOT NULL
     AND jsonb_typeof(p_sale.items) = 'array'
     AND jsonb_array_length(p_sale.items) > 0 THEN
    v_items := p_sale.items;
  ELSE
    v_items := jsonb_build_array(jsonb_build_object(
      'productId', p_sale.product_id,
      'productName', p_sale.product_name,
      'quantity', p_sale.quantity,
      'price', p_sale.unit_price,
      'discount', 0
    ));
  END IF;

  BEGIN
    v_preferences := COALESCE(NULLIF(current_setting('app.sale_owner_preferences', true), '')::jsonb, '[]'::jsonb);
  EXCEPTION WHEN invalid_text_representation THEN
    v_preferences := '[]'::jsonb;
  END;

  v_line_count := jsonb_array_length(v_items);

  -- Acquire every potentially affected holding before allocation, independent
  -- of cart order, so two mixed-product tickets cannot lock owners inversely.
  PERFORM h.id
  FROM inventory_holdings h
  WHERE h.user_id = p_sale.user_id
    AND h.product_id IN (
      SELECT DISTINCT NULLIF(item->>'productId', '')::uuid
      FROM jsonb_array_elements(v_items) item
    )
  ORDER BY h.product_id, h.inventory_owner_id, h.id
  FOR UPDATE OF h;

  FOR v_line_index IN 0..v_line_count - 1 LOOP
    v_item := v_items->v_line_index;
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := COALESCE(NULLIF(v_item->>'price', '')::numeric, NULLIF(v_item->>'unitPrice', '')::numeric, 0);
    v_unit_discount := COALESCE(NULLIF(v_item->>'discount', '')::numeric, NULLIF(v_item->>'lineDiscount', '')::numeric, 0);
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price < 0 OR v_unit_discount < 0 THEN
      RAISE EXCEPTION 'Linea de venta invalida: %', v_line_index + 1;
    END IF;
    v_base_total := v_base_total + (v_quantity * (v_unit_price - v_unit_discount));
  END LOOP;

  -- Derive the effective global adjustment from the immutable sale total. This
  -- also captures quote-level discounts that the legacy scalar did not expose.
  v_effective_adjustment := round(p_sale.total - v_base_total, 2);
  v_remaining_adjustment := v_effective_adjustment;

  FOR v_line_index IN 0..v_line_count - 1 LOOP
    v_item := v_items->v_line_index;
    v_product_id := (v_item->>'productId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := COALESCE(NULLIF(v_item->>'price', '')::numeric, NULLIF(v_item->>'unitPrice', '')::numeric, 0);
    v_unit_discount := COALESCE(NULLIF(v_item->>'discount', '')::numeric, NULLIF(v_item->>'lineDiscount', '')::numeric, 0);

    SELECT * INTO v_product
    FROM products
    WHERE user_id = p_sale.user_id AND id = v_product_id;
    IF v_product.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado en la venta'; END IF;
    v_product_name := v_product.name;
    v_line_base := v_quantity * (v_unit_price - v_unit_discount);
    v_line_adjustment := CASE
      WHEN v_line_index = v_line_count - 1 THEN v_remaining_adjustment
      WHEN v_base_total = 0 THEN 0
      ELSE round(v_effective_adjustment * v_line_base / v_base_total, 2)
    END;
    v_remaining_adjustment := round(v_remaining_adjustment - v_line_adjustment, 2);
    v_line_total := round(v_line_base + v_line_adjustment, 2);

    INSERT INTO sale_items (
      user_id, sale_id, sale_id_snapshot, revision, line_number,
      product_id, product_id_snapshot, product_name_snapshot, quantity,
      unit_price, unit_discount, discount_amount, adjustment_share,
      line_total, actor_uid, snapshot_source
    ) VALUES (
      p_sale.user_id, p_sale.id, p_sale.id, v_revision, v_line_index + 1,
      v_product_id, v_product_id, v_product_name, v_quantity,
      v_unit_price, v_unit_discount, round(v_quantity * v_unit_discount, 2),
      v_line_adjustment, v_line_total, COALESCE(auth.uid(), p_sale.user_id),
      p_snapshot_source
    ) RETURNING id INTO v_sale_item_id;

    v_preferred_owner_id := COALESCE(
      NULLIF(v_item->>'preferredOwnerId', '')::uuid,
      NULLIF(v_preferences->v_line_index->>'preferredOwnerId', '')::uuid
    );
    v_remaining_quantity := v_quantity;
    v_remaining_line_adjustment := v_line_adjustment;
    v_remaining_line_revenue := v_line_total;
    v_remaining_line_discount := round(v_quantity * v_unit_discount, 2);
    v_line_cost_total := 0;
    v_cost_remaining_quantity := v_quantity;
    v_allocation_count := 0;

    -- Calculate the raw line cost before rounding individual owner shares. The
    -- last owner receives the exact cent remainder, just like revenue.
    FOR v_candidate IN
      SELECT
        h.id AS holding_id,
        h.inventory_owner_id,
        h.stock,
        h.purchase_cost,
        io.name AS owner_name,
        io.sort_order,
        COALESCE(membership.is_default, false) AS is_default
      FROM inventory_holdings h
      JOIN inventory_owners io
        ON io.user_id = h.user_id
       AND io.id = h.inventory_owner_id
       AND io.archived_at IS NULL
      LEFT JOIN inventory_owner_memberships membership
        ON membership.user_id = h.user_id
       AND membership.actor_uid = COALESCE(auth.uid(), p_sale.user_id)
       AND membership.inventory_owner_id = h.inventory_owner_id
       AND membership.can_operate
      WHERE h.user_id = p_sale.user_id
        AND h.product_id = v_product_id
        AND h.active
        AND h.stock > 0
        AND (v_preferred_owner_id IS NULL OR h.inventory_owner_id = v_preferred_owner_id)
        AND (COALESCE(auth.uid(), p_sale.user_id) = p_sale.user_id OR membership.id IS NOT NULL)
      ORDER BY
        CASE WHEN v_preferred_owner_id IS NOT NULL THEN 0 ELSE 1 END,
        membership.is_default DESC NULLS LAST,
        io.sort_order,
        h.id
    LOOP
      EXIT WHEN v_cost_remaining_quantity = 0;
      v_allocate_quantity := least(v_cost_remaining_quantity, v_candidate.stock);
      v_line_cost_total := v_line_cost_total + (v_allocate_quantity * v_candidate.purchase_cost);
      v_cost_remaining_quantity := v_cost_remaining_quantity - v_allocate_quantity;
    END LOOP;
    v_remaining_line_cost := round(v_line_cost_total, 2);

    -- Holdings are locked in one deterministic order. An explicit override is
    -- intentionally exclusive: it never spills into a different business.
    FOR v_candidate IN
      SELECT
        h.id AS holding_id,
        h.inventory_owner_id,
        h.stock,
        h.purchase_cost,
        io.name AS owner_name,
        io.sort_order,
        COALESCE(membership.is_default, false) AS is_default
      FROM inventory_holdings h
      JOIN inventory_owners io
        ON io.user_id = h.user_id
       AND io.id = h.inventory_owner_id
       AND io.archived_at IS NULL
      LEFT JOIN inventory_owner_memberships membership
        ON membership.user_id = h.user_id
       AND membership.actor_uid = COALESCE(auth.uid(), p_sale.user_id)
       AND membership.inventory_owner_id = h.inventory_owner_id
       AND membership.can_operate
      WHERE h.user_id = p_sale.user_id
        AND h.product_id = v_product_id
        AND h.active
        AND h.stock > 0
        AND (v_preferred_owner_id IS NULL OR h.inventory_owner_id = v_preferred_owner_id)
        AND (COALESCE(auth.uid(), p_sale.user_id) = p_sale.user_id OR membership.id IS NOT NULL)
      ORDER BY
        CASE WHEN v_preferred_owner_id IS NOT NULL THEN 0 ELSE 1 END,
        membership.is_default DESC NULLS LAST,
        io.sort_order,
        h.id
      FOR UPDATE OF h
    LOOP
      EXIT WHEN v_remaining_quantity = 0;
      v_allocate_quantity := least(v_remaining_quantity, v_candidate.stock);
      v_is_last_allocation := v_allocate_quantity = v_remaining_quantity;
      v_allocation_adjustment := CASE
        WHEN v_is_last_allocation THEN v_remaining_line_adjustment
        ELSE round(v_line_adjustment * v_allocate_quantity / v_quantity, 2)
      END;
      v_remaining_line_adjustment := round(v_remaining_line_adjustment - v_allocation_adjustment, 2);
      v_discount_share := CASE
        WHEN v_is_last_allocation THEN v_remaining_line_discount
        ELSE round(v_unit_discount * v_allocate_quantity, 2)
      END;
      v_remaining_line_discount := round(v_remaining_line_discount - v_discount_share, 2);
      v_revenue_share := CASE
        WHEN v_is_last_allocation THEN v_remaining_line_revenue
        ELSE round(
          v_allocate_quantity * (v_unit_price - v_unit_discount) + v_allocation_adjustment,
          2
        )
      END;
      v_remaining_line_revenue := round(v_remaining_line_revenue - v_revenue_share, 2);
      v_cost_share := CASE
        WHEN v_is_last_allocation THEN v_remaining_line_cost
        ELSE round(v_allocate_quantity * v_candidate.purchase_cost, 2)
      END;
      v_remaining_line_cost := round(v_remaining_line_cost - v_cost_share, 2);
      v_allocation_source := CASE
        WHEN v_preferred_owner_id IS NOT NULL THEN 'manual_override'
        WHEN v_candidate.is_default THEN 'default'
        ELSE 'priority'
      END;

      IF p_mutate_stock THEN
        UPDATE inventory_holdings
        SET stock = stock - v_allocate_quantity,
            updated_at = now()
        WHERE user_id = p_sale.user_id AND id = v_candidate.holding_id
        RETURNING stock INTO v_resulting_stock;
      ELSE
        v_resulting_stock := v_candidate.stock;
      END IF;

      INSERT INTO sale_item_allocations (
        user_id, sale_id, sale_id_snapshot, sale_item_id,
        inventory_holding_id, inventory_owner_id, inventory_owner_id_snapshot,
        inventory_owner_name_snapshot, product_id_snapshot, product_name_snapshot,
        quantity, unit_price, unit_cost, discount_share, adjustment_share,
        revenue_share, cost_share, allocation_source, actor_uid
      ) VALUES (
        p_sale.user_id, p_sale.id, p_sale.id, v_sale_item_id,
        v_candidate.holding_id, v_candidate.inventory_owner_id, v_candidate.inventory_owner_id,
        v_candidate.owner_name, v_product_id, v_product_name,
        v_allocate_quantity, v_unit_price, v_candidate.purchase_cost,
        v_discount_share, v_allocation_adjustment, v_revenue_share, v_cost_share,
        v_allocation_source, COALESCE(auth.uid(), p_sale.user_id)
      ) RETURNING id INTO v_allocation_id;

      IF p_mutate_stock THEN
        INSERT INTO stock_movements (
          user_id, idempotency_key, product_id_snapshot, product_name_snapshot,
          inventory_owner_id_snapshot, inventory_owner_name_snapshot,
          sale_id_snapshot, sale_item_id, sale_item_allocation_id, actor_uid,
          movement_type, delta, resulting_stock, unit_cost_snapshot
        ) VALUES (
          p_sale.user_id,
          'sale:' || p_sale.id::text || ':revision:' || v_revision::text ||
            ':line:' || (v_line_index + 1)::text || ':owner:' || v_candidate.inventory_owner_id::text,
          v_product_id, v_product_name, v_candidate.inventory_owner_id, v_candidate.owner_name,
          p_sale.id, v_sale_item_id, v_allocation_id, COALESCE(auth.uid(), p_sale.user_id),
          'sale', -v_allocate_quantity, v_resulting_stock, v_candidate.purchase_cost
        );
      END IF;

      v_remaining_quantity := v_remaining_quantity - v_allocate_quantity;
      v_allocation_count := v_allocation_count + 1;
    END LOOP;

    IF v_remaining_quantity > 0 THEN
      IF v_preferred_owner_id IS NOT NULL THEN
        RAISE EXCEPTION 'Stock insuficiente para el titular seleccionado. Faltan % unidades', v_remaining_quantity;
      END IF;
      RAISE EXCEPTION 'Stock insuficiente para "%". Faltan % unidades', v_product_name, v_remaining_quantity;
    END IF;
    IF v_allocation_count = 0 THEN RAISE EXCEPTION 'No hay existencias autorizadas para la venta'; END IF;
  END LOOP;

  -- The finance trigger may have run earlier inside an edit RPC, so refresh it
  -- again from the new immutable allocations and reconcile to p_sale.total.
  PERFORM refresh_sale_cash_flow_allocations(p_sale.id);
END;
$$;

CREATE OR REPLACE FUNCTION attribute_legacy_sale(
  p_sale sales,
  p_snapshot_source text DEFAULT 'legacy_estimated'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_revision integer;
  v_items jsonb;
  v_line_count integer;
  v_line_index integer;
  v_item jsonb;
  v_product_id uuid;
  v_live_product_id uuid;
  v_product_name text;
  v_quantity integer;
  v_unit_price numeric;
  v_unit_discount numeric;
  v_base_total numeric := 0;
  v_line_base numeric;
  v_effective_adjustment numeric;
  v_remaining_adjustment numeric;
  v_line_adjustment numeric;
  v_sale_item_id uuid;
  v_holding inventory_holdings%ROWTYPE;
  v_legacy_owner_id uuid;
  v_purchase_cost numeric;
  v_owner_name text;
  v_actor_uid uuid;
  v_snapshot_reason text;
BEGIN
  v_actor_uid := CASE
    WHEN p_snapshot_source = 'legacy_estimated' THEN NULL::uuid
    ELSE auth.uid()
  END;
  v_snapshot_reason := CASE
    WHEN p_snapshot_source = 'legacy_estimated'
      THEN 'Historical legacy backfill; actor unknown'
    ELSE 'Legacy runtime compatibility capture'
  END;

  v_revision := COALESCE((
    SELECT max(revision) FROM sale_items
    WHERE user_id = p_sale.user_id AND sale_id_snapshot = p_sale.id
  ), 0) + 1;

  IF p_sale.items IS NOT NULL
     AND jsonb_typeof(p_sale.items) = 'array'
     AND jsonb_array_length(p_sale.items) > 0 THEN
    v_items := p_sale.items;
  ELSE
    v_items := jsonb_build_array(jsonb_build_object(
      'productId', p_sale.product_id,
      'productName', p_sale.product_name,
      'quantity', p_sale.quantity,
      'price', p_sale.unit_price,
      'discount', 0
    ));
  END IF;

  v_line_count := jsonb_array_length(v_items);
  FOR v_line_index IN 0..v_line_count - 1 LOOP
    v_item := v_items->v_line_index;
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := COALESCE(NULLIF(v_item->>'price', '')::numeric, NULLIF(v_item->>'unitPrice', '')::numeric, 0);
    v_unit_discount := COALESCE(NULLIF(v_item->>'discount', '')::numeric, NULLIF(v_item->>'lineDiscount', '')::numeric, 0);
    v_base_total := v_base_total + (v_quantity * (v_unit_price - v_unit_discount));
  END LOOP;
  v_effective_adjustment := round(p_sale.total - v_base_total, 2);
  v_remaining_adjustment := v_effective_adjustment;

  FOR v_line_index IN 0..v_line_count - 1 LOOP
    v_item := v_items->v_line_index;
    v_product_id := NULLIF(v_item->>'productId', '')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := COALESCE(NULLIF(v_item->>'price', '')::numeric, NULLIF(v_item->>'unitPrice', '')::numeric, 0);
    v_unit_discount := COALESCE(NULLIF(v_item->>'discount', '')::numeric, NULLIF(v_item->>'lineDiscount', '')::numeric, 0);
    v_product_name := COALESCE(
      NULLIF(v_item->>'productName', ''),
      (SELECT name FROM products WHERE user_id = p_sale.user_id AND id = v_product_id),
      p_sale.product_name
    );
    SELECT id INTO v_live_product_id FROM products
    WHERE user_id = p_sale.user_id AND id = v_product_id;
    v_line_base := v_quantity * (v_unit_price - v_unit_discount);
    v_line_adjustment := CASE
      WHEN v_line_index = v_line_count - 1 THEN v_remaining_adjustment
      WHEN v_base_total = 0 THEN 0
      ELSE round(v_effective_adjustment * v_line_base / v_base_total, 2)
    END;
    v_remaining_adjustment := round(v_remaining_adjustment - v_line_adjustment, 2);

    SELECT h.* INTO v_holding
    FROM inventory_holdings h
    JOIN products product
      ON product.user_id = h.user_id
     AND product.id = h.product_id
     AND product.inventory_owner_id = h.inventory_owner_id
    WHERE h.user_id = p_sale.user_id AND h.product_id = v_product_id
    ORDER BY h.active DESC, h.created_at, h.id
    LIMIT 1;

    IF v_holding.id IS NULL THEN
      SELECT h.* INTO v_holding
      FROM inventory_holdings h
      JOIN inventory_owners owner
        ON owner.user_id = h.user_id AND owner.id = h.inventory_owner_id
      WHERE h.user_id = p_sale.user_id AND h.product_id = v_product_id
      ORDER BY owner.is_primary DESC, owner.sort_order, h.id
      LIMIT 1;
    END IF;
    IF v_holding.id IS NULL THEN
      SELECT owner.id, owner.name
      INTO v_legacy_owner_id, v_owner_name
      FROM inventory_owners owner
      WHERE owner.user_id = p_sale.user_id
      ORDER BY owner.is_primary DESC, owner.sort_order, owner.id
      LIMIT 1;
      IF v_legacy_owner_id IS NULL THEN
        RAISE EXCEPTION 'No existe un titular para atribuir la venta historica';
      END IF;
      v_purchase_cost := 0;
    ELSE
      v_legacy_owner_id := v_holding.inventory_owner_id;
      v_purchase_cost := v_holding.purchase_cost;
      SELECT name INTO v_owner_name FROM inventory_owners
      WHERE user_id = p_sale.user_id AND id = v_legacy_owner_id;
    END IF;

    INSERT INTO sale_items (
      user_id, sale_id, sale_id_snapshot, revision, line_number,
      product_id, product_id_snapshot, product_name_snapshot, quantity,
      unit_price, unit_discount, discount_amount, adjustment_share,
      line_total, actor_uid, snapshot_source, snapshot_reason
    ) VALUES (
      p_sale.user_id, p_sale.id, p_sale.id, v_revision, v_line_index + 1,
      v_live_product_id, v_product_id, v_product_name, v_quantity,
      v_unit_price, v_unit_discount, round(v_quantity * v_unit_discount, 2),
      v_line_adjustment, round(v_line_base + v_line_adjustment, 2),
      v_actor_uid, p_snapshot_source, v_snapshot_reason
    ) RETURNING id INTO v_sale_item_id;

    INSERT INTO sale_item_allocations (
      user_id, sale_id, sale_id_snapshot, sale_item_id,
      inventory_holding_id, inventory_owner_id, inventory_owner_id_snapshot,
      inventory_owner_name_snapshot, product_id_snapshot, product_name_snapshot,
      quantity, unit_price, unit_cost, discount_share, adjustment_share,
      revenue_share, cost_share, allocation_source, actor_uid, snapshot_reason
    ) VALUES (
      p_sale.user_id, p_sale.id, p_sale.id, v_sale_item_id,
      v_holding.id, v_legacy_owner_id, v_legacy_owner_id,
      v_owner_name, v_product_id, v_product_name,
      v_quantity, v_unit_price, v_purchase_cost,
      round(v_quantity * v_unit_discount, 2), v_line_adjustment,
      round(v_line_base + v_line_adjustment, 2),
      round(v_quantity * v_purchase_cost, 2),
      'legacy_estimated', v_actor_uid, v_snapshot_reason
    );
  END LOOP;

  -- Backfill and disabled-mode capture never replay stock. Existing legacy RPCs
  -- already changed products, and the compatibility trigger mirrored holdings.
  PERFORM refresh_sale_cash_flow_allocations(p_sale.id);
END;
$$;

CREATE OR REPLACE FUNCTION backfill_attributed_sales()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale sales%ROWTYPE;
BEGIN
  FOR v_sale IN
    SELECT sale.* FROM sales sale
    WHERE NOT EXISTS (
      SELECT 1 FROM sale_items item
      WHERE item.user_id = sale.user_id AND item.sale_id_snapshot = sale.id
    )
    ORDER BY sale.user_id, sale.created_at, sale.id
  LOOP
    PERFORM attribute_legacy_sale(v_sale, 'legacy_estimated');
  END LOOP;
END;
$$;

SELECT backfill_attributed_sales();

CREATE OR REPLACE FUNCTION attribute_sale_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT holdings_enabled INTO v_enabled
  FROM inventory_operation_settings WHERE user_id = NEW.user_id;
  IF COALESCE(v_enabled, false) THEN
    PERFORM attribute_current_sale_revision(NEW, true, 'captured');
  ELSE
    PERFORM attribute_legacy_sale(NEW, 'legacy_runtime');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION attribute_sale_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT holdings_enabled INTO v_enabled
  FROM inventory_operation_settings WHERE user_id = NEW.user_id;
  PERFORM reverse_current_sale_revision(OLD.id, 'edit', COALESCE(v_enabled, false));
  IF COALESCE(v_enabled, false) THEN
    PERFORM attribute_current_sale_revision(NEW, true, 'captured');
  ELSE
    PERFORM attribute_legacy_sale(NEW, 'legacy_runtime');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION attribute_sale_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT holdings_enabled INTO v_enabled
  FROM inventory_operation_settings WHERE user_id = OLD.user_id;
  PERFORM reverse_current_sale_revision(OLD.id, 'refund', COALESCE(v_enabled, false));
  RETURN OLD;
END;
$$;

-- Legacy register_sale, register_pos_sale, convert_quote_to_sale,
-- edit_sale, edit_pos_sale and delete_sale all write sales. These triggers are
-- therefore the single atomic attribution boundary for every active writer.
CREATE TRIGGER sales_attribute_insert
  AFTER INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION attribute_sale_insert();

CREATE TRIGGER sales_attribute_update
  AFTER UPDATE OF product_id, product_name, unit_price, quantity, adjustment, items ON sales
  FOR EACH ROW
  WHEN (
    OLD.product_id IS DISTINCT FROM NEW.product_id
    OR OLD.product_name IS DISTINCT FROM NEW.product_name
    OR OLD.unit_price IS DISTINCT FROM NEW.unit_price
    OR OLD.quantity IS DISTINCT FROM NEW.quantity
    OR OLD.adjustment IS DISTINCT FROM NEW.adjustment
    OR OLD.items IS DISTINCT FROM NEW.items
  )
  EXECUTE FUNCTION attribute_sale_update();

CREATE TRIGGER sales_attribute_delete
  BEFORE DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION attribute_sale_delete();

CREATE OR REPLACE FUNCTION guard_legacy_pos_sale_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT settings.holdings_enabled INTO v_enabled
  FROM inventory_operation_settings settings
  WHERE settings.user_id = OLD.user_id;

  IF COALESCE(v_enabled, false)
     AND OLD.source = 'pos'
     AND OLD.items IS NOT NULL
     AND jsonb_typeof(OLD.items) = 'array'
     AND NEW.items IS NOT DISTINCT FROM OLD.items
     AND current_setting('app.attributed_edit', true) IS DISTINCT FROM 'true'
     AND (
       OLD.product_id IS DISTINCT FROM NEW.product_id
       OR OLD.unit_price IS DISTINCT FROM NEW.unit_price
       OR OLD.quantity IS DISTINCT FROM NEW.quantity
       OR OLD.adjustment IS DISTINCT FROM NEW.adjustment
     ) THEN
    RAISE EXCEPTION 'Las ventas POS requieren edicion atomica por lineas';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_guard_legacy_pos_edit
  BEFORE UPDATE OF product_id, unit_price, quantity, adjustment, items ON sales
  FOR EACH ROW EXECUTE FUNCTION guard_legacy_pos_sale_edit();

CREATE OR REPLACE FUNCTION guard_quote_sale_economic_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'quote'
       AND current_setting('app.quote_conversion', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Las ventas de presupuesto solo se crean mediante su conversion dedicada';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.source = 'quote'
     AND OLD.source IS DISTINCT FROM 'quote'
     AND current_setting('app.quote_conversion', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'El origen presupuesto solo se asigna mediante su conversion dedicada';
  END IF;

  IF OLD.source = 'quote'
     AND (
       OLD.source IS DISTINCT FROM NEW.source
       OR OLD.product_id IS DISTINCT FROM NEW.product_id
       OR OLD.product_name IS DISTINCT FROM NEW.product_name
       OR OLD.unit_price IS DISTINCT FROM NEW.unit_price
       OR OLD.quantity IS DISTINCT FROM NEW.quantity
       OR OLD.adjustment IS DISTINCT FROM NEW.adjustment
       OR OLD.total IS DISTINCT FROM NEW.total
       OR OLD.items IS DISTINCT FROM NEW.items
     ) THEN
    RAISE EXCEPTION 'El contenido economico de una venta originada en presupuesto es inmutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_guard_quote_economic_update
  BEFORE INSERT OR UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION guard_quote_sale_economic_update();

-- The status-aware legacy conversion predates sales.source. Repair only rows
-- whose quote relationship proves they were created by the dedicated flow.
SELECT set_config('app.quote_conversion', 'true', true);
UPDATE sales sale
SET source = 'quote'
FROM quotes quote
WHERE quote.user_id = sale.user_id
  AND quote.converted_to_sale_id = sale.id
  AND sale.source IS DISTINCT FROM 'quote';
SELECT set_config('app.quote_conversion', '', true);

CREATE OR REPLACE FUNCTION sync_cash_flow_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE cash_flow_allocations
    SET reversed_at = now(), reversal_reason = 'cash_flow_deleted'
    WHERE user_id = OLD.user_id
      AND cash_flow_id_snapshot = OLD.id
      AND reversed_at IS NULL;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.sale_id IS DISTINCT FROM NEW.sale_id AND OLD.sale_id IS NOT NULL THEN
    PERFORM refresh_sale_cash_flow_allocations(OLD.sale_id);
  END IF;
  IF NEW.sale_id IS NOT NULL THEN
    PERFORM refresh_sale_cash_flow_allocations(NEW.sale_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_flow_attribute_insert_update
  AFTER INSERT OR UPDATE OF amount, sale_id ON cash_flow
  FOR EACH ROW EXECUTE FUNCTION sync_cash_flow_attribution();

CREATE TRIGGER cash_flow_attribute_delete
  BEFORE DELETE ON cash_flow
  FOR EACH ROW EXECUTE FUNCTION sync_cash_flow_attribution();

CREATE OR REPLACE FUNCTION assert_sale_owner_preferences(
  p_items jsonb,
  p_uid uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_owner_id uuid;
BEGIN
  IF auth.uid() = p_uid THEN RETURN; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RETURN; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_owner_id := NULLIF(v_item->>'preferredOwnerId', '')::uuid;
    IF v_owner_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM inventory_owner_memberships membership
      JOIN inventory_owners owner
        ON owner.user_id = membership.user_id
       AND owner.id = membership.inventory_owner_id
       AND owner.archived_at IS NULL
      WHERE membership.user_id = p_uid
        AND membership.actor_uid = auth.uid()
        AND membership.inventory_owner_id = v_owner_id
        AND membership.can_operate
    ) THEN
      RAISE EXCEPTION 'Sin permiso para operar el titular solicitado';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION assert_attributed_sale_access(
  p_sale_id uuid,
  p_uid uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() = p_uid THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1
    FROM sale_item_allocations allocation
    JOIN sale_items item
      ON item.user_id = allocation.user_id
     AND item.id = allocation.sale_item_id
    WHERE allocation.user_id = p_uid
      AND allocation.sale_id_snapshot = p_sale_id
      AND item.revision = (
        SELECT max(latest_item.revision)
        FROM sale_items latest_item
        WHERE latest_item.user_id = p_uid
          AND latest_item.sale_id_snapshot = p_sale_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM inventory_owner_memberships membership
        WHERE membership.user_id = p_uid
          AND membership.actor_uid = auth.uid()
          AND membership.inventory_owner_id = allocation.inventory_owner_id_snapshot
          AND membership.can_operate
      )
  ) THEN
    RAISE EXCEPTION 'Sin permiso para operar todos los titulares de la venta';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION lock_attributed_sale_resources(
  p_uid uuid,
  p_items jsonb,
  p_sale_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_ids uuid[];
  v_product_id uuid;
BEGIN
  SELECT array_agg(resource.product_id ORDER BY resource.product_id)
  INTO v_product_ids
  FROM (
    SELECT DISTINCT NULLIF(item->>'productId', '')::uuid AS product_id
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) item
    UNION
    SELECT DISTINCT allocation.product_id_snapshot AS product_id
    FROM sale_item_allocations allocation
    WHERE allocation.user_id = p_uid
      AND allocation.sale_id_snapshot = p_sale_id
  ) resource
  WHERE resource.product_id IS NOT NULL;

  PERFORM lock_inventory_products(p_uid, v_product_ids);

  FOREACH v_product_id IN ARRAY COALESCE(v_product_ids, ARRAY[]::uuid[])
  LOOP
    PERFORM product.id
    FROM products product
    WHERE product.user_id = p_uid AND product.id = v_product_id
    FOR UPDATE;
  END LOOP;

  PERFORM h.id
  FROM inventory_holdings h
  WHERE h.user_id = p_uid
    AND h.product_id = ANY(COALESCE(v_product_ids, ARRAY[]::uuid[]))
  ORDER BY h.product_id, h.inventory_owner_id, h.id
  FOR UPDATE OF h;
END;
$$;

CREATE OR REPLACE FUNCTION normalize_attributed_sale_items(
  p_items jsonb,
  p_uid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_product products%ROWTYPE;
  v_quantity integer;
  v_requested_price numeric;
  v_discount numeric;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un item';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::integer;
    SELECT * INTO v_product FROM products
    WHERE user_id = p_uid AND id = NULLIF(v_item->>'productId', '')::uuid;
    IF v_product.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN RAISE EXCEPTION 'Cantidad de venta invalida'; END IF;

    v_requested_price := COALESCE(
      NULLIF(v_item->>'unitPrice', '')::numeric,
      NULLIF(v_item->>'price', '')::numeric,
      v_product.sale_price
    );
    IF round(v_requested_price, 2) <> round(v_product.sale_price, 2) THEN
      RAISE EXCEPTION 'El producto debe usar su precio publico unico';
    END IF;
    v_discount := COALESCE(
      NULLIF(v_item->>'lineDiscount', '')::numeric,
      NULLIF(v_item->>'discount', '')::numeric,
      0
    );
    IF v_discount < 0 OR v_discount > v_product.sale_price THEN
      RAISE EXCEPTION 'Descuento de linea invalido';
    END IF;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'quantity', v_quantity,
      'unitPrice', v_product.sale_price,
      'lineDiscount', v_discount,
      'preferredOwnerId', NULLIF(v_item->>'preferredOwnerId', '')::uuid
    ));
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION register_attributed_sale(
  p_items jsonb,
  p_payment_method text,
  p_status text,
  p_customer_id uuid,
  p_adjustment_total numeric,
  p_date date,
  p_source text,
  p_idempotency_key text
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_payload jsonb;
  v_fingerprint text;
  v_normalized_items jsonb;
  v_command attributed_sale_commands%ROWTYPE;
  v_sale sales%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar ventas';
  END IF;
  IF char_length(p_idempotency_key) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'Clave de idempotencia invalida';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('pos', 'manual') THEN
    RAISE EXCEPTION 'El registro atribuido solo admite origen manual o POS';
  END IF;

  v_payload := jsonb_build_object(
    'items', p_items,
    'paymentMethod', p_payment_method,
    'status', p_status,
    'customerId', p_customer_id,
    'adjustmentTotal', p_adjustment_total,
    'date', p_date,
    'source', p_source
  );
  v_fingerprint := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  PERFORM lock_inventory_commands(v_uid, ARRAY[p_idempotency_key]);

  SELECT * INTO v_command FROM attributed_sale_commands
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
  IF v_command.id IS NOT NULL THEN
    PERFORM assert_attributed_sale_access(v_command.sale_id_snapshot, v_uid);
    IF v_command.operation <> 'register' OR v_command.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    v_sale := jsonb_populate_record(NULL::sales, v_command.result);
    RETURN NEXT v_sale;
    RETURN;
  END IF;

  IF NOT COALESCE((
    SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid
  ), false) THEN
    RAISE EXCEPTION 'El registro atribuido requiere stock compartido habilitado';
  END IF;

  PERFORM assert_sale_owner_preferences(p_items, v_uid);
  v_normalized_items := normalize_attributed_sale_items(p_items, v_uid);
  PERFORM lock_attributed_sale_resources(v_uid, v_normalized_items, NULL);
  PERFORM set_config('app.sale_owner_preferences', v_normalized_items::text, true);
  SELECT * INTO v_sale
  FROM register_pos_sale(
    v_normalized_items,
    p_payment_method,
    p_status,
    p_customer_id,
    COALESCE(p_adjustment_total, 0),
    COALESCE(p_date, CURRENT_DATE),
    false
  ) LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No se pudo registrar la venta'; END IF;

  IF v_sale.source IS DISTINCT FROM p_source THEN
    UPDATE sales SET source = p_source WHERE user_id = v_uid AND id = v_sale.id
    RETURNING * INTO v_sale;
  END IF;

  INSERT INTO attributed_sale_commands (
    user_id, idempotency_key, operation, sale_id, sale_id_snapshot,
    actor_uid, payload, request_fingerprint, result
  ) VALUES (
    v_uid, p_idempotency_key, 'register', v_sale.id, v_sale.id,
    auth.uid(), v_payload, v_fingerprint, to_jsonb(v_sale)
  );
  RETURN NEXT v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION edit_attributed_sale(
  p_sale_id uuid,
  p_items jsonb,
  p_adjustment_total numeric,
  p_status text,
  p_payment_method text,
  p_customer_id uuid,
  p_client text,
  p_date date,
  p_idempotency_key text
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_payload jsonb;
  v_fingerprint text;
  v_normalized_items jsonb;
  v_command attributed_sale_commands%ROWTYPE;
  v_sale sales%ROWTYPE;
  v_item jsonb;
  v_items_out jsonb := '[]'::jsonb;
  v_product products%ROWTYPE;
  v_line_count integer;
  v_index integer;
  v_quantity integer;
  v_unit_price numeric;
  v_line_discount numeric;
  v_total numeric := 0;
  v_first_product_id uuid;
  v_first_product_name text;
  v_old_tx customer_transactions%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_description text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'ventas', 'write') THEN RAISE EXCEPTION 'Sin permiso para editar ventas'; END IF;
  IF char_length(p_idempotency_key) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Clave de idempotencia invalida'; END IF;
  IF p_status NOT IN ('Pagado', 'Pendiente', 'No Pagado') THEN RAISE EXCEPTION 'Estado invalido'; END IF;
  IF p_status = 'Pendiente' AND p_customer_id IS NULL THEN RAISE EXCEPTION 'Cuenta corriente requiere cliente'; END IF;

  v_payload := jsonb_build_object(
    'saleId', p_sale_id, 'items', p_items,
    'adjustmentTotal', p_adjustment_total,
    'status', p_status, 'paymentMethod', p_payment_method,
    'customerId', p_customer_id, 'client', p_client,
    'date', p_date
  );
  v_fingerprint := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  PERFORM lock_inventory_commands(v_uid, ARRAY[p_idempotency_key]);

  SELECT * INTO v_command FROM attributed_sale_commands
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
  IF v_command.id IS NOT NULL THEN
    PERFORM assert_attributed_sale_access(v_command.sale_id_snapshot, v_uid);
    IF v_command.operation <> 'edit' OR v_command.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    v_sale := jsonb_populate_record(NULL::sales, v_command.result);
    RETURN NEXT v_sale;
    RETURN;
  END IF;

  IF NOT COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid), false) THEN
    RAISE EXCEPTION 'La edicion atribuida requiere stock compartido habilitado';
  END IF;

  PERFORM assert_attributed_sale_access(p_sale_id, v_uid);
  SELECT * INTO v_sale FROM sales WHERE user_id = v_uid AND id = p_sale_id;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF v_sale.source = 'quote' THEN
    RAISE EXCEPTION 'Las ventas originadas en presupuestos no admiten edicion atribuida';
  END IF;
  PERFORM assert_sale_owner_preferences(p_items, v_uid);
  v_normalized_items := normalize_attributed_sale_items(p_items, v_uid);
  PERFORM lock_attributed_sale_resources(v_uid, v_normalized_items, p_sale_id);
  SELECT * INTO v_sale FROM sales WHERE user_id = v_uid AND id = p_sale_id FOR UPDATE;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  v_line_count := jsonb_array_length(v_normalized_items);
  FOR v_index IN 0..v_line_count - 1 LOOP
    v_item := v_normalized_items->v_index;
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := COALESCE(NULLIF(v_item->>'unitPrice', '')::numeric, NULLIF(v_item->>'price', '')::numeric, 0);
    v_line_discount := COALESCE(NULLIF(v_item->>'lineDiscount', '')::numeric, NULLIF(v_item->>'discount', '')::numeric, 0);
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price < 0 OR v_line_discount < 0 THEN
      RAISE EXCEPTION 'Linea de venta invalida: %', v_index + 1;
    END IF;
    SELECT * INTO v_product FROM products
    WHERE user_id = v_uid AND id = (v_item->>'productId')::uuid;
    IF v_product.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_index = 0 THEN
      v_first_product_id := v_product.id;
      v_first_product_name := v_product.name;
    END IF;
    v_total := v_total + v_quantity * (v_unit_price - v_line_discount);
    v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'quantity', v_quantity,
      'price', v_unit_price,
      'discount', v_line_discount
    ));
  END LOOP;
  v_total := round(v_total + COALESCE(p_adjustment_total, 0), 2);
  v_description := CASE WHEN v_line_count = 1
    THEN _sale_description(v_first_product_name, (v_normalized_items->0->>'quantity')::integer)
    ELSE 'Venta POS (' || v_line_count::text || ' items)'
  END;

  PERFORM set_config('app.bypass_check', 'rpc', true);
  FOR v_old_tx IN
    SELECT * FROM customer_transactions
    WHERE user_id = v_uid AND related_sale_id = v_sale.id
    FOR UPDATE
  LOOP
    UPDATE customers
    SET current_balance = current_balance - v_old_tx.amount, updated_at = now()
    WHERE user_id = v_uid AND id = v_old_tx.customer_id;
  END LOOP;
  DELETE FROM customer_transactions WHERE user_id = v_uid AND related_sale_id = v_sale.id;
  DELETE FROM cash_flow WHERE user_id = v_uid AND sale_id = v_sale.id;

  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers
    WHERE user_id = v_uid AND id = p_customer_id FOR UPDATE;
    IF v_customer.id IS NULL THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
    INSERT INTO customer_transactions (
      user_id, customer_id, type, amount, description,
      related_sale_id, date
    ) VALUES (
      v_uid, p_customer_id, 'sale', v_total, v_description,
      v_sale.id, COALESCE(p_date, v_sale.date)
    );
    IF p_status = 'Pagado' THEN
      INSERT INTO customer_transactions (
        user_id, customer_id, type, amount, description, payment_method,
        related_sale_id, date
      ) VALUES (
        v_uid, p_customer_id, 'payment', -v_total, 'Cobro de ' || v_description,
        COALESCE(p_payment_method, 'Efectivo'), v_sale.id, COALESCE(p_date, CURRENT_DATE)
      );
    ELSE
      UPDATE customers SET current_balance = current_balance + v_total, updated_at = now()
      WHERE user_id = v_uid AND id = p_customer_id;
    END IF;
  ELSIF p_status = 'Pagado' THEN
    INSERT INTO cash_flow (
      user_id, date, type, source, description, category,
      amount, payment_method, status, sale_id
    ) VALUES (
      v_uid, COALESCE(p_date, v_sale.date), 'Ingreso', 'Venta', v_description,
      CASE WHEN v_sale.source = 'pos' THEN 'Venta POS' ELSE 'Venta Externa' END,
      v_total, COALESCE(p_payment_method, 'Efectivo'), 'Pagado', v_sale.id
    );
  END IF;

  PERFORM set_config('app.sale_owner_preferences', v_normalized_items::text, true);
  PERFORM set_config('app.attributed_edit', 'true', true);
  UPDATE sales SET
    date = COALESCE(p_date, date),
    product_id = v_first_product_id,
    product_name = CASE WHEN v_line_count = 1 THEN v_first_product_name ELSE 'POS x' || v_line_count::text END,
    unit_price = CASE WHEN v_line_count = 1 THEN (v_normalized_items->0->>'unitPrice')::numeric ELSE v_total END,
    quantity = CASE WHEN v_line_count = 1 THEN (v_normalized_items->0->>'quantity')::integer ELSE 1 END,
    adjustment = COALESCE(p_adjustment_total, 0),
    total = v_total,
    status = p_status,
    payment_method = p_payment_method,
    client = COALESCE((SELECT name FROM customers WHERE user_id = v_uid AND id = p_customer_id), p_client),
    items = v_items_out
  WHERE user_id = v_uid AND id = v_sale.id
  RETURNING * INTO v_sale;

  INSERT INTO attributed_sale_commands (
    user_id, idempotency_key, operation, sale_id, sale_id_snapshot,
    actor_uid, payload, request_fingerprint, result
  ) VALUES (
    v_uid, p_idempotency_key, 'edit', v_sale.id, v_sale.id,
    auth.uid(), v_payload, v_fingerprint, to_jsonb(v_sale)
  );
  RETURN NEXT v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION refund_attributed_sale(
  p_sale_id uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_payload jsonb := jsonb_build_object('saleId', p_sale_id);
  v_fingerprint text;
  v_command attributed_sale_commands%ROWTYPE;
  v_sale sales%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'ventas', 'delete') THEN RAISE EXCEPTION 'Sin permiso para devolver ventas'; END IF;
  IF char_length(p_idempotency_key) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Clave de idempotencia invalida'; END IF;
  PERFORM assert_attributed_sale_access(p_sale_id, v_uid);
  v_fingerprint := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  PERFORM lock_inventory_commands(v_uid, ARRAY[p_idempotency_key]);

  SELECT * INTO v_command FROM attributed_sale_commands
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
  IF v_command.id IS NOT NULL THEN
    IF v_command.operation <> 'refund' OR v_command.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    RETURN;
  END IF;

  PERFORM lock_attributed_sale_resources(v_uid, NULL, p_sale_id);
  SELECT * INTO v_sale FROM sales WHERE user_id = v_uid AND id = p_sale_id FOR UPDATE;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  INSERT INTO attributed_sale_commands (
    user_id, idempotency_key, operation, sale_id, sale_id_snapshot,
    actor_uid, payload, request_fingerprint, result
  ) VALUES (
    v_uid, p_idempotency_key, 'refund', v_sale.id, v_sale.id,
    auth.uid(), v_payload, v_fingerprint, jsonb_build_object('refunded', true)
  );
  PERFORM delete_sale(v_sale.id);
END;
$$;

-- Compatibility repair for the legacy Sales page. The previous implementation
-- assigned the sale.items array to an object map and iterated it as an object,
-- so every real POS edit failed before stock could be reconciled.
CREATE OR REPLACE FUNCTION edit_pos_sale_unlocked(
  p_sale_id uuid,
  p_new_items jsonb,
  p_new_adjustment numeric,
  p_new_status text,
  p_new_payment_method text,
  p_new_customer_id uuid,
  p_new_date date
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_sale sales%ROWTYPE;
  v_updated sales%ROWTYPE;
  v_item jsonb;
  v_product products%ROWTYPE;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_line_discount numeric;
  v_old_qty_by_pid jsonb;
  v_new_qty_by_pid jsonb;
  v_old_quantity integer;
  v_new_quantity integer;
  v_stock_delta integer;
  v_items_out jsonb := '[]'::jsonb;
  v_line_count integer;
  v_line_index integer;
  v_line_total numeric := 0;
  v_total numeric;
  v_first_product_id uuid;
  v_first_product_name text;
  v_description text;
  v_existing_customer_id uuid;
  v_effective_customer_id uuid;
  v_customer customers%ROWTYPE;
  v_old_tx customer_transactions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para editar ventas';
  END IF;
  IF COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid), false) THEN
    RAISE EXCEPTION 'Las ventas con stock compartido requieren edicion atribuida';
  END IF;

  SELECT * INTO v_sale
  FROM sales
  WHERE user_id = v_uid AND id = p_sale_id
  FOR UPDATE;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF v_sale.source <> 'pos' THEN RAISE EXCEPTION 'Esta venta no es del POS'; END IF;
  IF p_new_items IS NULL OR jsonb_typeof(p_new_items) <> 'array'
     OR jsonb_array_length(p_new_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un item';
  END IF;
  IF p_new_status NOT IN ('Pagado', 'Pendiente', 'No Pagado') THEN
    RAISE EXCEPTION 'Estado invalido';
  END IF;

  SELECT sale_tx.customer_id INTO v_existing_customer_id
  FROM customer_transactions sale_tx
  WHERE sale_tx.user_id = v_uid
    AND sale_tx.related_sale_id = p_sale_id
    AND sale_tx.type = 'sale'
  ORDER BY sale_tx.created_at, sale_tx.id
  LIMIT 1;
  v_effective_customer_id := COALESCE(p_new_customer_id, v_existing_customer_id);
  IF p_new_status IN ('Pendiente', 'No Pagado') AND v_effective_customer_id IS NULL THEN
    RAISE EXCEPTION 'Cuenta corriente requiere cliente';
  END IF;

  SELECT COALESCE(jsonb_object_agg(old_line.product_id::text, old_line.quantity), '{}'::jsonb)
  INTO v_old_qty_by_pid
  FROM (
    SELECT
      NULLIF(item->>'productId', '')::uuid AS product_id,
      sum((item->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_sale.items) = 'array'
      THEN v_sale.items
      ELSE jsonb_build_array(jsonb_build_object(
        'productId', v_sale.product_id,
        'quantity', v_sale.quantity
      ))
    END) item
    GROUP BY NULLIF(item->>'productId', '')::uuid
  ) old_line;

  SELECT COALESCE(jsonb_object_agg(new_line.product_id::text, new_line.quantity), '{}'::jsonb)
  INTO v_new_qty_by_pid
  FROM (
    SELECT
      NULLIF(item->>'productId', '')::uuid AS product_id,
      sum((item->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(p_new_items) item
    GROUP BY NULLIF(item->>'productId', '')::uuid
  ) new_line;

  -- The wrapper already owns the same canonical advisory locks used by every
  -- inventory writer. Row locks now follow the same product order as a second
  -- line of defense and stock is changed once per distinct product.
  FOR v_product_id IN
    SELECT locked.product_id
    FROM (
      SELECT key::uuid AS product_id FROM jsonb_each_text(v_old_qty_by_pid)
      UNION
      SELECT key::uuid AS product_id FROM jsonb_each_text(v_new_qty_by_pid)
    ) locked
    ORDER BY product_id
  LOOP
    SELECT * INTO v_product
    FROM products
    WHERE user_id = v_uid AND id = v_product_id
    FOR UPDATE;
    IF v_product.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado: %', v_product_id; END IF;

    v_old_quantity := COALESCE((v_old_qty_by_pid->>v_product_id::text)::integer, 0);
    v_new_quantity := COALESCE((v_new_qty_by_pid->>v_product_id::text)::integer, 0);
    v_stock_delta := v_old_quantity - v_new_quantity;
    IF v_product.stock + v_stock_delta < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
        v_product.name, v_product.stock, abs(v_stock_delta);
    END IF;
    UPDATE products
    SET stock = stock + v_stock_delta, updated_at = now()
    WHERE user_id = v_uid AND id = v_product_id;
  END LOOP;

  v_line_count := jsonb_array_length(p_new_items);
  FOR v_line_index IN 0..v_line_count - 1 LOOP
    v_item := p_new_items->v_line_index;
    v_product_id := NULLIF(v_item->>'productId', '')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := COALESCE(NULLIF(v_item->>'unitPrice', '')::numeric, NULLIF(v_item->>'price', '')::numeric, 0);
    v_line_discount := COALESCE(NULLIF(v_item->>'lineDiscount', '')::numeric, NULLIF(v_item->>'discount', '')::numeric, 0);
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price < 0 OR v_line_discount < 0 THEN
      RAISE EXCEPTION 'Linea de venta invalida: %', v_line_index + 1;
    END IF;
    SELECT * INTO v_product FROM products WHERE user_id = v_uid AND id = v_product_id;
    IF v_product.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_line_index = 0 THEN
      v_first_product_id := v_product.id;
      v_first_product_name := v_product.name;
    END IF;
    v_line_total := v_line_total + (v_quantity * (v_unit_price - v_line_discount));
    v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'quantity', v_quantity,
      'price', v_unit_price,
      'discount', v_line_discount
    ));
  END LOOP;
  v_total := round(v_line_total + COALESCE(p_new_adjustment, 0), 2);
  v_description := CASE WHEN v_line_count = 1
    THEN _sale_description(v_first_product_name, (p_new_items->0->>'quantity')::integer)
    ELSE 'Venta POS (' || v_line_count::text || ' items)'
  END;

  PERFORM set_config('app.bypass_check', 'rpc', true);
  FOR v_old_tx IN
    SELECT * FROM customer_transactions
    WHERE user_id = v_uid AND related_sale_id = p_sale_id
    FOR UPDATE
  LOOP
    UPDATE customers
    SET current_balance = current_balance - v_old_tx.amount, updated_at = now()
    WHERE user_id = v_uid AND id = v_old_tx.customer_id;
  END LOOP;
  DELETE FROM customer_transactions WHERE user_id = v_uid AND related_sale_id = p_sale_id;
  DELETE FROM cash_flow WHERE user_id = v_uid AND sale_id = p_sale_id;

  IF v_effective_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers
    WHERE user_id = v_uid AND id = v_effective_customer_id
    FOR UPDATE;
    IF v_customer.id IS NULL THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
    INSERT INTO customer_transactions (
      user_id, customer_id, type, amount, description, related_sale_id, date
    ) VALUES (
      v_uid, v_customer.id, 'sale', v_total, v_description, p_sale_id,
      COALESCE(p_new_date, v_sale.date)
    );
    IF p_new_status = 'Pagado' THEN
      INSERT INTO customer_transactions (
        user_id, customer_id, type, amount, description, payment_method,
        related_sale_id, date
      ) VALUES (
        v_uid, v_customer.id, 'payment', -v_total, 'Cobro de ' || v_description,
        COALESCE(p_new_payment_method, 'Efectivo'), p_sale_id,
        COALESCE(p_new_date, CURRENT_DATE)
      );
    ELSE
      UPDATE customers SET current_balance = current_balance + v_total, updated_at = now()
      WHERE user_id = v_uid AND id = v_customer.id;
    END IF;
  ELSIF p_new_status = 'Pagado' THEN
    INSERT INTO cash_flow (
      user_id, date, type, source, description, category,
      amount, payment_method, status, sale_id
    ) VALUES (
      v_uid, COALESCE(p_new_date, v_sale.date), 'Ingreso', 'Venta', v_description,
      'Venta POS', v_total, COALESCE(p_new_payment_method, 'Efectivo'), 'Pagado', p_sale_id
    );
  END IF;

  UPDATE sales SET
    date = COALESCE(p_new_date, date),
    product_id = v_first_product_id,
    product_name = CASE WHEN v_line_count = 1 THEN v_first_product_name ELSE 'POS x' || v_line_count::text END,
    unit_price = CASE WHEN v_line_count = 1 THEN COALESCE(
      NULLIF(p_new_items->0->>'unitPrice', '')::numeric,
      NULLIF(p_new_items->0->>'price', '')::numeric,
      0
    ) ELSE v_total END,
    quantity = CASE WHEN v_line_count = 1 THEN (p_new_items->0->>'quantity')::integer ELSE 1 END,
    adjustment = COALESCE(p_new_adjustment, 0),
    total = v_total,
    status = p_new_status,
    payment_method = p_new_payment_method,
    client = COALESCE(v_customer.name, client),
    items = v_items_out
  WHERE user_id = v_uid AND id = p_sale_id
  RETURNING * INTO v_updated;

  RETURN NEXT v_updated;
END;
$$;

-- Wrap every active legacy and owner-aware stock writer. The wrapper resolves
-- all affected products without row locks, acquires the common advisory locks
-- in UUID order, and only then delegates to the historical implementation.
ALTER FUNCTION register_sale(date, uuid, integer, numeric, numeric, text, text, text, uuid)
  RENAME TO register_sale_unlocked;
ALTER FUNCTION register_pos_sale(jsonb, text, text, uuid, numeric, date, boolean)
  RENAME TO register_pos_sale_unlocked;
ALTER FUNCTION convert_quote_to_sale(uuid)
  RENAME TO convert_quote_to_sale_unlocked;
ALTER FUNCTION convert_quote_to_sale(uuid, text, text)
  RENAME TO convert_quote_to_sale_with_status_unlocked;
ALTER FUNCTION edit_sale(uuid, uuid, integer, numeric, numeric, text, text, text, date)
  RENAME TO edit_sale_unlocked;
ALTER FUNCTION delete_sale(uuid)
  RENAME TO delete_sale_unlocked;
ALTER FUNCTION toggle_sale_status(uuid, text)
  RENAME TO toggle_sale_status_unlocked;
ALTER FUNCTION save_product_with_holdings(jsonb, jsonb, text)
  RENAME TO save_product_with_holdings_unlocked;
ALTER FUNCTION receive_inventory_holding_stock(uuid, uuid, integer, numeric, text, text, date, text)
  RENAME TO receive_inventory_holding_stock_unlocked;
ALTER FUNCTION mutate_inventory_holding_stock(uuid, uuid, integer, text, text)
  RENAME TO mutate_inventory_holding_stock_unlocked;
ALTER FUNCTION intake_stock(uuid, integer, numeric, text, text, date)
  RENAME TO intake_stock_unlocked;
ALTER FUNCTION archive_inventory_owner(uuid)
  RENAME TO archive_inventory_owner_unlocked;

CREATE OR REPLACE FUNCTION register_sale(
  p_date date, p_product_id uuid, p_quantity integer, p_unit_price numeric,
  p_adjustment numeric, p_status text, p_payment_method text DEFAULT NULL,
  p_client text DEFAULT NULL, p_customer_id uuid DEFAULT NULL
)
RETURNS SETOF sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := get_owner_uid(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  PERFORM lock_inventory_products(v_uid, ARRAY[p_product_id]);
  RETURN QUERY SELECT * FROM register_sale_unlocked(
    p_date, p_product_id, p_quantity, p_unit_price, p_adjustment, p_status,
    p_payment_method, p_client, p_customer_id
  );
  IF COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid), false) THEN
    PERFORM resync_inventory_product_mirrors(v_uid, ARRAY[p_product_id]);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION register_pos_sale(
  p_items jsonb, p_payment_method text, p_status text, p_customer_id uuid,
  p_adjustment_total numeric, p_date date, p_allow_oversell boolean
)
RETURNS SETOF sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_product_ids uuid[] := sale_product_ids(p_items);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  PERFORM lock_inventory_products(v_uid, v_product_ids);
  RETURN QUERY SELECT * FROM register_pos_sale_unlocked(
    p_items, p_payment_method, p_status, p_customer_id,
    p_adjustment_total, p_date, p_allow_oversell
  );
  IF COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid), false) THEN
    PERFORM resync_inventory_product_mirrors(v_uid, v_product_ids);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION convert_quote_to_sale(p_quote_id uuid)
RETURNS SETOF sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_items jsonb;
  v_product_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  SELECT quote.items INTO v_items FROM quotes quote
  WHERE quote.user_id = v_uid AND quote.id = p_quote_id;
  v_product_ids := sale_product_ids(v_items);
  PERFORM lock_inventory_products(v_uid, v_product_ids);
  PERFORM set_config('app.quote_conversion', 'true', true);
  RETURN QUERY SELECT * FROM convert_quote_to_sale_unlocked(p_quote_id);
  PERFORM set_config('app.quote_conversion', '', true);
  IF COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid), false) THEN
    PERFORM resync_inventory_product_mirrors(v_uid, v_product_ids);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION convert_quote_to_sale(
  p_quote_id uuid, p_status text, p_payment_method text DEFAULT NULL
)
RETURNS SETOF sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_items jsonb;
  v_product_ids uuid[];
  v_sale sales%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  SELECT quote.items INTO v_items FROM quotes quote
  WHERE quote.user_id = v_uid AND quote.id = p_quote_id;
  v_product_ids := sale_product_ids(v_items);
  PERFORM lock_inventory_products(v_uid, v_product_ids);
  PERFORM set_config('app.quote_conversion', 'true', true);
  SELECT * INTO v_sale FROM convert_quote_to_sale_with_status_unlocked(
    p_quote_id, p_status, p_payment_method
  ) LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No se pudo convertir el presupuesto'; END IF;
  UPDATE sales SET source = 'quote'
  WHERE user_id = v_uid AND id = v_sale.id
  RETURNING * INTO v_sale;
  PERFORM set_config('app.quote_conversion', '', true);
  IF COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid), false) THEN
    PERFORM resync_inventory_product_mirrors(v_uid, v_product_ids);
  END IF;
  RETURN NEXT v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION edit_sale(
  p_sale_id uuid, p_new_product_id uuid, p_new_quantity integer,
  p_new_unit_price numeric, p_new_adjustment numeric, p_new_status text,
  p_new_payment_method text DEFAULT NULL, p_new_client text DEFAULT NULL,
  p_new_date date DEFAULT NULL
)
RETURNS SETOF sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_sale sales%ROWTYPE;
  v_product_ids uuid[];
  v_existing_line_discount numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  SELECT * INTO v_sale FROM sales WHERE user_id = v_uid AND id = p_sale_id;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF v_sale.source = 'quote' THEN
    RAISE EXCEPTION 'Los presupuestos convertidos no se pueden editar como ventas';
  END IF;
  v_existing_line_discount := COALESCE(
    NULLIF(v_sale.items->0->>'lineDiscount', '')::numeric,
    NULLIF(v_sale.items->0->>'discount', '')::numeric,
    0
  );
  v_product_ids := sale_product_ids(v_sale.items, v_sale.product_id) || ARRAY[p_new_product_id];
  PERFORM lock_inventory_products(v_uid, v_product_ids);
  IF v_sale.source = 'pos' THEN
    IF jsonb_typeof(v_sale.items) = 'array' AND jsonb_array_length(v_sale.items) > 1 THEN
      RAISE EXCEPTION 'Una venta POS con varios productos debe editarse por lineas';
    END IF;
    RETURN QUERY SELECT * FROM edit_pos_sale_unlocked(
      p_sale_id,
      jsonb_build_array(jsonb_build_object(
        'productId', p_new_product_id, 'quantity', p_new_quantity,
        'unitPrice', p_new_unit_price, 'lineDiscount', v_existing_line_discount
      )),
      p_new_adjustment, p_new_status, p_new_payment_method, NULL, p_new_date
    );
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM edit_sale_unlocked(
    p_sale_id, p_new_product_id, p_new_quantity, p_new_unit_price,
    p_new_adjustment, p_new_status, p_new_payment_method, p_new_client, p_new_date
  );
  IF COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid), false) THEN
    PERFORM resync_inventory_product_mirrors(v_uid, v_product_ids);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION edit_pos_sale(
  p_sale_id uuid, p_new_items jsonb, p_new_adjustment numeric,
  p_new_status text, p_new_payment_method text, p_new_customer_id uuid,
  p_new_date date
)
RETURNS SETOF sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_sale sales%ROWTYPE;
  v_product_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  SELECT * INTO v_sale FROM sales WHERE user_id = v_uid AND id = p_sale_id;
  v_product_ids := sale_product_ids(v_sale.items, v_sale.product_id) || sale_product_ids(p_new_items);
  PERFORM lock_inventory_products(v_uid, v_product_ids);
  RETURN QUERY SELECT * FROM edit_pos_sale_unlocked(
    p_sale_id, p_new_items, p_new_adjustment, p_new_status,
    p_new_payment_method, p_new_customer_id, p_new_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION delete_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_sale sales%ROWTYPE;
  v_product_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  SELECT * INTO v_sale FROM sales WHERE user_id = v_uid AND id = p_sale_id;
  v_product_ids := sale_product_ids(v_sale.items, v_sale.product_id);
  PERFORM lock_inventory_products(v_uid, v_product_ids);
  PERFORM delete_sale_unlocked(p_sale_id);
  IF COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid), false) THEN
    PERFORM resync_inventory_product_mirrors(v_uid, v_product_ids);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION toggle_sale_status(p_sale_id uuid, p_new_status text)
RETURNS SETOF sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_sale sales%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  SELECT * INTO v_sale FROM sales WHERE user_id = v_uid AND id = p_sale_id;
  PERFORM lock_inventory_products(v_uid, sale_product_ids(v_sale.items, v_sale.product_id));
  RETURN QUERY SELECT * FROM toggle_sale_status_unlocked(p_sale_id, p_new_status);
END;
$$;

CREATE OR REPLACE FUNCTION save_product_with_holdings(
  p_product jsonb, p_holdings jsonb, p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := get_owner_uid(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  PERFORM lock_inventory_commands(v_uid, ARRAY[p_idempotency_key]);
  PERFORM lock_inventory_products(v_uid, ARRAY[(p_product->>'id')::uuid]);
  RETURN save_product_with_holdings_unlocked(p_product, p_holdings, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION receive_inventory_holding_stock(
  p_product_id uuid, p_inventory_owner_id uuid, p_quantity integer,
  p_purchase_cost numeric, p_supplier text, p_notes text, p_date date,
  p_idempotency_key text
)
RETURNS stock_intakes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := get_owner_uid(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  PERFORM lock_inventory_commands(v_uid, ARRAY[p_idempotency_key]);
  PERFORM lock_inventory_products(v_uid, ARRAY[p_product_id]);
  RETURN receive_inventory_holding_stock_unlocked(
    p_product_id, p_inventory_owner_id, p_quantity, p_purchase_cost,
    p_supplier, p_notes, p_date, p_idempotency_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION mutate_inventory_holding_stock(
  p_product_id uuid, p_inventory_owner_id uuid, p_delta integer,
  p_reason text, p_idempotency_key text
)
RETURNS inventory_stock_commands
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := get_owner_uid(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  PERFORM lock_inventory_commands(v_uid, ARRAY[p_idempotency_key]);
  PERFORM lock_inventory_products(v_uid, ARRAY[p_product_id]);
  RETURN mutate_inventory_holding_stock_unlocked(
    p_product_id, p_inventory_owner_id, p_delta, p_reason, p_idempotency_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION intake_stock(
  p_product_id uuid, p_quantity integer, p_purchase_price numeric,
  p_supplier text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_date date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := get_owner_uid(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid), false) THEN
    RAISE EXCEPTION 'El ingreso legacy requiere stock compartido deshabilitado';
  END IF;
  PERFORM lock_inventory_products(v_uid, ARRAY[p_product_id]);
  PERFORM intake_stock_unlocked(
    p_product_id, p_quantity, p_purchase_price, p_supplier, p_notes, p_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION archive_inventory_owner(p_owner_id uuid)
RETURNS inventory_owners
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_product_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  SELECT COALESCE(
    array_agg(DISTINCT holding.product_id ORDER BY holding.product_id),
    ARRAY[]::uuid[]
  ) INTO v_product_ids
  FROM inventory_holdings holding
  WHERE holding.user_id = v_uid
    AND holding.inventory_owner_id = p_owner_id
    AND holding.active;
  PERFORM lock_inventory_products(v_uid, v_product_ids);
  RETURN archive_inventory_owner_unlocked(p_owner_id);
END;
$$;

CREATE OR REPLACE FUNCTION transfer_inventory_holding_stock(
  p_product_id uuid, p_source_owner_id uuid, p_destination_owner_id uuid,
  p_quantity integer, p_reason text, p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_source inventory_stock_commands%ROWTYPE;
  v_destination inventory_stock_commands%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF p_source_owner_id = p_destination_owner_id THEN
    RAISE EXCEPTION 'Los titulares de origen y destino deben ser distintos';
  END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser positiva'; END IF;
  PERFORM lock_inventory_commands(
    v_uid,
    ARRAY[p_idempotency_key || ':out', p_idempotency_key || ':in']
  );
  PERFORM lock_inventory_products(v_uid, ARRAY[p_product_id]);
  v_source := mutate_inventory_holding_stock_unlocked(
    p_product_id, p_source_owner_id, -p_quantity,
    btrim(p_reason) || ' (transferencia saliente)', p_idempotency_key || ':out'
  );
  v_destination := mutate_inventory_holding_stock_unlocked(
    p_product_id, p_destination_owner_id, p_quantity,
    btrim(p_reason) || ' (transferencia entrante)', p_idempotency_key || ':in'
  );
  RETURN jsonb_build_object('source', to_jsonb(v_source), 'destination', to_jsonb(v_destination));
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON inventory_holdings FROM authenticated;
REVOKE ALL ON FUNCTION register_sale_unlocked(date, uuid, integer, numeric, numeric, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION register_pos_sale_unlocked(jsonb, text, text, uuid, numeric, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION convert_quote_to_sale_unlocked(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION convert_quote_to_sale_with_status_unlocked(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION edit_sale_unlocked(uuid, uuid, integer, numeric, numeric, text, text, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION edit_pos_sale_unlocked(uuid, jsonb, numeric, text, text, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delete_sale_unlocked(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION toggle_sale_status_unlocked(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION save_product_with_holdings_unlocked(jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION receive_inventory_holding_stock_unlocked(uuid, uuid, integer, numeric, text, text, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mutate_inventory_holding_stock_unlocked(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION intake_stock_unlocked(uuid, integer, numeric, text, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION archive_inventory_owner_unlocked(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION lock_inventory_products(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lock_inventory_commands(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sale_product_ids(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION resync_inventory_product_mirrors(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_inventory_holdings_to_product() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION register_sale(date, uuid, integer, numeric, numeric, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION register_pos_sale(jsonb, text, text, uuid, numeric, date, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION convert_quote_to_sale(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION convert_quote_to_sale(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION edit_sale(uuid, uuid, integer, numeric, numeric, text, text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION edit_pos_sale(uuid, jsonb, numeric, text, text, uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION delete_sale(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION toggle_sale_status(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION save_product_with_holdings(jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION receive_inventory_holding_stock(uuid, uuid, integer, numeric, text, text, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mutate_inventory_holding_stock(uuid, uuid, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION intake_stock(uuid, integer, numeric, text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION archive_inventory_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION transfer_inventory_holding_stock(uuid, uuid, uuid, integer, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION register_sale(date, uuid, integer, numeric, numeric, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION register_pos_sale(jsonb, text, text, uuid, numeric, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION convert_quote_to_sale(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION convert_quote_to_sale(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION edit_sale(uuid, uuid, integer, numeric, numeric, text, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION edit_pos_sale(uuid, jsonb, numeric, text, text, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_sale(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION toggle_sale_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION save_product_with_holdings(jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION receive_inventory_holding_stock(uuid, uuid, integer, numeric, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION mutate_inventory_holding_stock(uuid, uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION intake_stock(uuid, integer, numeric, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION archive_inventory_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_inventory_holding_stock(uuid, uuid, uuid, integer, text, text) TO authenticated;

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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'config', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para cambiar la configuracion';
  END IF;
  IF p_enabled THEN
    RAISE EXCEPTION 'La activacion requiere clientes de venta con idempotencia estable';
  END IF;
  INSERT INTO inventory_operation_settings (user_id, holdings_enabled, updated_at)
  VALUES (v_uid, false, now())
  ON CONFLICT (user_id) DO UPDATE
    SET holdings_enabled = false, updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION refresh_sale_cash_flow_allocations(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reverse_current_sale_revision(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION attribute_current_sale_revision(sales, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION attribute_legacy_sale(sales, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION backfill_attributed_sales() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION attribute_sale_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION attribute_sale_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION attribute_sale_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION guard_legacy_pos_sale_edit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION guard_quote_sale_economic_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_cash_flow_attribution() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION assert_sale_owner_preferences(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION assert_attributed_sale_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lock_attributed_sale_resources(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION normalize_attributed_sale_items(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION register_attributed_sale(jsonb, text, text, uuid, numeric, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION edit_attributed_sale(uuid, jsonb, numeric, text, text, uuid, text, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION refund_attributed_sale(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION set_inventory_holdings_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION register_attributed_sale(jsonb, text, text, uuid, numeric, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION edit_attributed_sale(uuid, jsonb, numeric, text, text, uuid, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION refund_attributed_sale(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_inventory_holdings_enabled(boolean) TO authenticated;

COMMIT;
