-- 0019_collaborators_schema.sql
-- Create invitations and collaborators tables with RLS, define get_owner_uid and
-- has_permission SECURITY DEFINER helpers, and extend handle_new_user to
-- materialize collaborator rows on magic-link sign-up.

-- ─────────── INVITATIONS (pending magic-link state) ───────────
CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  permissions  jsonb NOT NULL,
  role_preset  text,
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  UNIQUE (owner_uid, email)
);
CREATE INDEX invitations_email_pending_idx
  ON invitations (lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invitations_owner_all" ON invitations
  USING (owner_uid = auth.uid())
  WITH CHECK (owner_uid = auth.uid());

-- ─────────── COLLABORATORS (active membership) ───────────
CREATE TABLE collaborators (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_uid        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text NOT NULL,
  permissions     jsonb NOT NULL,
  role_preset     text,
  invitation_id   uuid REFERENCES invitations(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  UNIQUE (owner_uid, user_uid)
);
CREATE INDEX collaborators_user_uid_active_idx
  ON collaborators (user_uid)
  WHERE revoked_at IS NULL;
CREATE INDEX collaborators_owner_uid_active_idx
  ON collaborators (owner_uid)
  WHERE revoked_at IS NULL;

ALTER TABLE collaborators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collaborators_owner_all" ON collaborators
  USING (owner_uid = auth.uid())
  WITH CHECK (owner_uid = auth.uid());

CREATE POLICY "collaborators_self_select" ON collaborators
  FOR SELECT USING (user_uid = auth.uid());

-- ─────────── HELPERS ───────────
CREATE OR REPLACE FUNCTION get_owner_uid(v_uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT owner_uid
       FROM collaborators
      WHERE user_uid = v_uid
        AND revoked_at IS NULL
      LIMIT 1),
    v_uid
  );
$$;

CREATE OR REPLACE FUNCTION has_permission(
  v_uid    uuid,
  v_module text,
  v_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM collaborators
       WHERE user_uid = v_uid AND revoked_at IS NULL
    ) THEN true   -- owner has all permissions
    ELSE COALESCE(
      (SELECT (permissions -> v_module ->> v_action)::boolean
         FROM collaborators
        WHERE user_uid = v_uid AND revoked_at IS NULL
        LIMIT 1),
      false
    )
  END;
$$;

REVOKE ALL ON FUNCTION get_owner_uid(uuid) FROM public;
GRANT EXECUTE ON FUNCTION get_owner_uid(uuid) TO authenticated;
REVOKE ALL ON FUNCTION has_permission(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION has_permission(uuid, text, text) TO authenticated;

-- ─────────── handle_new_user EXTENSION ───────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv invitations%ROWTYPE;
BEGIN
  -- 1. Check for pending invitation matching this email
  SELECT * INTO v_inv
    FROM invitations
   WHERE lower(email) = lower(COALESCE(NEW.email, ''))
     AND accepted_at IS NULL
     AND revoked_at IS NULL
   ORDER BY invited_at DESC
   LIMIT 1;

  IF FOUND THEN
    -- Materialize collaborator membership
    INSERT INTO collaborators (
      owner_uid, user_uid, email, permissions, role_preset, invitation_id, created_at
    ) VALUES (
      v_inv.owner_uid, NEW.id, COALESCE(NEW.email, v_inv.email),
      v_inv.permissions, v_inv.role_preset, v_inv.id, now()
    )
    ON CONFLICT (owner_uid, user_uid) DO NOTHING;

    UPDATE invitations
       SET accepted_at = now()
     WHERE id = v_inv.id;

    -- Create a minimal placeholder profile so FKs/joins don't break.
    -- business_name stays '' (partial index ignores it). The AuthContext
    -- will route this user to the owner's profile, so this row is never
    -- presented in the UI.
    INSERT INTO profiles (id, email, display_name, role, currency_symbol, dark_mode, created_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
      'user', '$', false, now()
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- 2. Normal owner signup (unchanged behavior)
  INSERT INTO profiles (id, email, display_name, role, currency_symbol, dark_mode, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
    'user', '$', false, now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
