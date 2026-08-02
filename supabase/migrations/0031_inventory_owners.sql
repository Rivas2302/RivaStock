-- 0031_inventory_owners.sql
-- Classify stock by merchandise owner without creating separate financial tenants.

BEGIN;

CREATE TABLE inventory_owners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  sort_order  integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_primary  boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);

CREATE UNIQUE INDEX inventory_owners_primary_per_user_idx
  ON inventory_owners (user_id)
  WHERE is_primary;
CREATE UNIQUE INDEX inventory_owners_name_per_user_idx
  ON inventory_owners (user_id, lower(btrim(name)));
CREATE INDEX inventory_owners_user_sort_idx
  ON inventory_owners (user_id, sort_order, created_at);

-- Every profile gets a stable default. Collaborator-only profiles may keep an
-- unused row; tenant resolution prevents it from being exposed while the
-- collaborator belongs to another account.
INSERT INTO inventory_owners (user_id, name, sort_order, is_primary)
SELECT id, 'Principal', 0, true
FROM profiles
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION create_primary_inventory_owner_for_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO inventory_owners (user_id, name, sort_order, is_primary)
  VALUES (NEW.id, 'Principal', 0, true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION create_primary_inventory_owner_for_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION create_primary_inventory_owner_for_profile() FROM anon;
REVOKE ALL ON FUNCTION create_primary_inventory_owner_for_profile() FROM authenticated;

CREATE TRIGGER profiles_create_primary_inventory_owner
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION create_primary_inventory_owner_for_profile();

ALTER TABLE products
  ADD COLUMN inventory_owner_id uuid;

-- Schema backfill is not a user action and auth.uid() is null during migrations;
-- the immutable audit trigger correctly rejects such writes unless suspended.
ALTER TABLE products DISABLE TRIGGER products_audit_event;
UPDATE products p
SET inventory_owner_id = io.id
FROM inventory_owners io
WHERE io.user_id = p.user_id
  AND io.is_primary;
ALTER TABLE products ENABLE TRIGGER products_audit_event;

ALTER TABLE products
  ALTER COLUMN inventory_owner_id SET NOT NULL,
  ADD CONSTRAINT products_inventory_owner_tenant_fk
    FOREIGN KEY (user_id, inventory_owner_id)
    REFERENCES inventory_owners (user_id, id)
    ON DELETE RESTRICT;

CREATE INDEX products_inventory_owner_idx
  ON products (user_id, inventory_owner_id);

CREATE OR REPLACE FUNCTION enforce_product_inventory_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner inventory_owners%ROWTYPE;
BEGIN
  IF NEW.inventory_owner_id IS NULL THEN
    SELECT * INTO v_owner
    FROM inventory_owners
    WHERE user_id = NEW.user_id AND is_primary
    LIMIT 1
    FOR KEY SHARE;
    NEW.inventory_owner_id := v_owner.id;
  ELSE
    SELECT * INTO v_owner
    FROM inventory_owners
    WHERE user_id = NEW.user_id AND id = NEW.inventory_owner_id
    FOR KEY SHARE;
  END IF;

  IF v_owner.id IS NULL THEN
    RAISE EXCEPTION 'El titular de mercadería no pertenece a esta cuenta';
  END IF;

  IF v_owner.archived_at IS NOT NULL
     AND NOT (
       TG_OP = 'UPDATE'
       AND OLD.user_id = NEW.user_id
       AND OLD.inventory_owner_id = NEW.inventory_owner_id
     ) THEN
    RAISE EXCEPTION 'No se pueden asignar titulares archivados';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION enforce_product_inventory_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_product_inventory_owner() FROM anon;
REVOKE ALL ON FUNCTION enforce_product_inventory_owner() FROM authenticated;

CREATE TRIGGER products_enforce_inventory_owner
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION enforce_product_inventory_owner();

ALTER TABLE inventory_owners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_owners_select" ON inventory_owners
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND user_id = get_owner_uid(auth.uid())
  );

-- Management is RPC-only. No INSERT/UPDATE/DELETE policies are intentionally
-- provided, so hard deletes and partial reorder operations cannot reach the table.

CREATE OR REPLACE FUNCTION can_manage_inventory_owners(v_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT has_permission(v_uid, 'config', 'read')
     AND has_permission(v_uid, 'config', 'write');
$$;

REVOKE ALL ON FUNCTION can_manage_inventory_owners(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION can_manage_inventory_owners(uuid) FROM anon;
REVOKE ALL ON FUNCTION can_manage_inventory_owners(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION create_inventory_owner(p_name text)
RETURNS inventory_owners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_name text := btrim(p_name);
  v_row inventory_owners%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticación requerida'; END IF;
  IF NOT can_manage_inventory_owners(auth.uid()) THEN RAISE EXCEPTION 'Permiso denegado'; END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'El nombre debe tener entre 1 y 80 caracteres'; END IF;

  INSERT INTO inventory_owners (user_id, name, sort_order)
  VALUES (
    v_uid,
    v_name,
    COALESCE((SELECT max(sort_order) + 1 FROM inventory_owners WHERE user_id = v_uid AND archived_at IS NULL), 0)
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION rename_inventory_owner(p_owner_id uuid, p_name text)
RETURNS inventory_owners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_name text := btrim(p_name);
  v_row inventory_owners%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticación requerida'; END IF;
  IF NOT can_manage_inventory_owners(auth.uid()) THEN RAISE EXCEPTION 'Permiso denegado'; END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'El nombre debe tener entre 1 y 80 caracteres'; END IF;

  UPDATE inventory_owners
  SET name = v_name, updated_at = now()
  WHERE id = p_owner_id AND user_id = v_uid
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Titular de mercadería no encontrado'; END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION archive_inventory_owner(p_owner_id uuid)
RETURNS inventory_owners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_row inventory_owners%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticación requerida'; END IF;
  IF NOT can_manage_inventory_owners(auth.uid()) THEN RAISE EXCEPTION 'Permiso denegado'; END IF;

  -- Serialize with product assignments so none can pass the active-owner check
  -- immediately before this owner becomes archived.
  SELECT * INTO v_row
  FROM inventory_owners
  WHERE id = p_owner_id AND user_id = v_uid AND NOT is_primary
  FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'El titular principal no se puede archivar o no fue encontrado'; END IF;

  UPDATE inventory_owners
  SET archived_at = COALESCE(archived_at, now()), updated_at = now()
  WHERE id = p_owner_id AND user_id = v_uid AND NOT is_primary
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION reorder_inventory_owners(p_owner_ids uuid[])
RETURNS SETOF inventory_owners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_expected integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticación requerida'; END IF;
  IF NOT can_manage_inventory_owners(auth.uid()) THEN RAISE EXCEPTION 'Permiso denegado'; END IF;

  SELECT count(*) INTO v_expected
  FROM inventory_owners
  WHERE user_id = v_uid AND archived_at IS NULL;

  IF cardinality(p_owner_ids) <> v_expected
     OR (SELECT count(DISTINCT id) FROM unnest(p_owner_ids) AS ids(id)) <> v_expected
     OR EXISTS (
       SELECT 1 FROM unnest(p_owner_ids) AS ids(id)
       WHERE NOT EXISTS (
         SELECT 1 FROM inventory_owners io
         WHERE io.id = ids.id AND io.user_id = v_uid AND io.archived_at IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'La lista debe contener cada titular activo exactamente una vez';
  END IF;

  UPDATE inventory_owners io
  SET sort_order = ordered.position - 1, updated_at = now()
  FROM unnest(p_owner_ids) WITH ORDINALITY AS ordered(id, position)
  WHERE io.id = ordered.id AND io.user_id = v_uid;

  RETURN QUERY
  SELECT * FROM inventory_owners
  WHERE user_id = v_uid
  ORDER BY archived_at NULLS FIRST, sort_order, created_at;
END;
$$;

REVOKE ALL ON FUNCTION create_inventory_owner(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rename_inventory_owner(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION archive_inventory_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION reorder_inventory_owners(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_inventory_owner(text) TO authenticated;
GRANT EXECUTE ON FUNCTION rename_inventory_owner(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION archive_inventory_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reorder_inventory_owners(uuid[]) TO authenticated;

-- Public catalog callers receive only the label attached to already-public
-- products. The owner table itself remains private and cannot be enumerated.
CREATE OR REPLACE FUNCTION get_public_inventory_owner_labels(
  p_slug text,
  p_product_id uuid DEFAULT NULL
)
RETURNS TABLE (product_id uuid, inventory_owner_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, io.name
  FROM catalog_config config
  JOIN products p
    ON p.user_id = config.user_id
   AND p.show_in_catalog = true
  JOIN inventory_owners io
    ON io.user_id = p.user_id
   AND io.id = p.inventory_owner_id
  WHERE config.slug = p_slug
    AND config.enabled = true
    AND (p_product_id IS NULL OR p.id = p_product_id);
$$;

REVOKE ALL ON FUNCTION get_public_inventory_owner_labels(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_inventory_owner_labels(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_public_inventory_owner_labels(text, uuid) TO authenticated;

COMMIT;
