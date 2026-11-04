BEGIN;

-- A 300-character user reason becomes 316 characters after the required
-- "Ajuste manual · " prefix.
ALTER TABLE public.inventory_stock_commands
  DROP CONSTRAINT IF EXISTS inventory_stock_commands_reason_check,
  ADD CONSTRAINT inventory_stock_commands_reason_check
    CHECK (char_length(btrim(reason)) BETWEEN 1 AND 316);

-- The suspension migration installs this guard dynamically. Ensure it also
-- exists for every stock row touched by this RPC on databases where that
-- migration predates the table.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['products', 'inventory_holdings', 'inventory_stock_commands'] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger trigger_row
      WHERE trigger_row.tgrelid = format('public.%I', v_table)::regclass
        AND trigger_row.tgname = 'suspension_write_guard'
        AND NOT trigger_row.tgisinternal
    ) THEN
      EXECUTE format('CREATE TRIGGER suspension_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_suspended_business_writes(''user_id'')', v_table);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_product_id uuid,
  p_inventory_owner_id uuid,
  p_mode text,
  p_quantity integer,
  p_reason text,
  p_idempotency_key text
)
RETURNS public.inventory_stock_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_uid uuid := auth.uid();
  v_user_id uuid;
  v_holdings_enabled boolean;
  v_product public.products%ROWTYPE;
  v_holding_id uuid;
  v_current_stock integer;
  v_delta integer;
  v_resulting_stock integer;
  v_owner_id uuid;
  v_owner_name text;
  v_reason text;
  v_command public.inventory_stock_commands%ROWTYPE;
BEGIN
  IF v_actor_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticación requerida';
  END IF;
  v_user_id := public.get_owner_uid(v_actor_uid);
  IF v_user_id IS NULL OR NOT public.has_permission(v_actor_uid, 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para modificar stock';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('add', 'remove', 'count') THEN
    RAISE EXCEPTION 'Modo de ajuste inválido';
  END IF;
  IF p_quantity IS NULL
     OR (p_mode IN ('add', 'remove') AND p_quantity <= 0)
     OR (p_mode = 'count' AND p_quantity < 0) THEN
    RAISE EXCEPTION 'Cantidad de ajuste inválida';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'El motivo debe tener entre 1 y 300 caracteres';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Clave de idempotencia inválida';
  END IF;

  SELECT settings.holdings_enabled
  INTO v_holdings_enabled
  FROM public.inventory_operation_settings settings
  WHERE settings.user_id = v_user_id
  FOR SHARE;
  v_holdings_enabled := COALESCE(v_holdings_enabled, false);

  IF v_holdings_enabled AND p_inventory_owner_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar un titular';
  ELSIF NOT v_holdings_enabled AND p_inventory_owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'No se admiten titulares para este negocio';
  END IF;

  -- A collaborator must still be authorized for the selected holding, even
  -- when replaying an idempotent request.
  IF v_holdings_enabled AND v_actor_uid <> v_user_id AND NOT EXISTS (
    SELECT 1
    FROM public.inventory_owner_memberships membership
    JOIN public.inventory_owners owner_row
      ON owner_row.user_id = membership.user_id
     AND owner_row.id = membership.inventory_owner_id
     AND owner_row.archived_at IS NULL
    WHERE membership.user_id = v_user_id
      AND membership.actor_uid = v_actor_uid
      AND membership.inventory_owner_id = p_inventory_owner_id
      AND membership.can_operate
  ) THEN
    RAISE EXCEPTION 'Sin permiso para operar este titular';
  END IF;

  -- Take the idempotency lock before row locks, matching the existing stock
  -- mutation and product-edit paths and avoiding lock-order inversions.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT product.* INTO v_product
  FROM public.products product
  WHERE product.user_id = v_user_id
    AND product.id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;
  IF v_product.catalog_only THEN
    RAISE EXCEPTION 'No se puede ajustar un producto solo de catálogo';
  END IF;

  v_reason := 'Ajuste manual · ' || btrim(p_reason);
  IF v_holdings_enabled THEN
    SELECT holding.id, holding.stock, owner_row.name
    INTO v_holding_id, v_current_stock, v_owner_name
    FROM public.inventory_holdings holding
    JOIN public.inventory_owners owner_row
      ON owner_row.user_id = holding.user_id
     AND owner_row.id = holding.inventory_owner_id
     AND owner_row.archived_at IS NULL
    WHERE holding.user_id = v_user_id
      AND holding.product_id = p_product_id
      AND holding.inventory_owner_id = p_inventory_owner_id
      AND holding.active
    FOR UPDATE OF holding;
    IF v_holding_id IS NULL THEN
      RAISE EXCEPTION 'Existencia no encontrada o inactiva';
    END IF;
    v_owner_id := p_inventory_owner_id;
  ELSE
    v_owner_id := v_product.inventory_owner_id;
    v_owner_name := v_product.inventory_owner_name;
    v_current_stock := v_product.stock;
    IF v_owner_id IS NULL OR v_owner_name IS NULL THEN
      RAISE EXCEPTION 'El producto no tiene un titular válido';
    END IF;
  END IF;

  SELECT command.* INTO v_command
  FROM public.inventory_stock_commands command
  WHERE command.user_id = v_user_id
    AND command.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_command.resulting_stock IS NULL
       OR v_command.product_id IS DISTINCT FROM p_product_id
       OR (v_holdings_enabled AND v_command.inventory_owner_id IS DISTINCT FROM p_inventory_owner_id)
       OR v_command.reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    IF p_mode = 'add' THEN
      v_delta := p_quantity;
    ELSIF p_mode = 'remove' THEN
      v_delta := -p_quantity;
    ELSE
      v_delta := p_quantity - (v_command.resulting_stock - v_command.delta);
    END IF;
    IF v_command.delta IS DISTINCT FROM v_delta THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    RETURN v_command;
  END IF;

  IF p_mode = 'add' THEN
    v_delta := p_quantity;
  ELSIF p_mode = 'remove' THEN
    v_delta := -p_quantity;
  ELSE
    v_delta := p_quantity - v_current_stock;
  END IF;

  IF v_delta = 0 THEN
    RETURN NULL;
  END IF;
  v_resulting_stock := v_current_stock + v_delta;
  IF v_resulting_stock < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente. Hay % unidades.', v_current_stock;
  END IF;

  INSERT INTO public.inventory_stock_commands (
    user_id, idempotency_key, product_id, product_name,
    inventory_owner_id, inventory_owner_name, actor_uid,
    delta, reason, resulting_stock
  ) VALUES (
    v_user_id, p_idempotency_key, p_product_id, v_product.name,
    v_owner_id, v_owner_name, v_actor_uid,
    v_delta, v_reason, v_resulting_stock
  ) RETURNING * INTO v_command;

  IF v_holdings_enabled THEN
    UPDATE public.inventory_holdings
    SET stock = v_resulting_stock, updated_at = now()
    WHERE id = v_holding_id;
  ELSE
    UPDATE public.products
    SET stock = v_resulting_stock, updated_at = now()
    WHERE user_id = v_user_id AND id = p_product_id;
  END IF;

  RETURN v_command;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_product_stock(uuid, uuid, text, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_product_stock(uuid, uuid, text, integer, text, text)
  TO authenticated;

COMMIT;
