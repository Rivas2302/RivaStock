-- Catalog links are globally unique after accent/case folding. The registry
-- keeps both current slugs and prior slugs so old links remain reserved.

CREATE OR REPLACE FUNCTION public.catalog_slug_key(p_slug text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.lower(extensions.unaccent(p_slug));
$$;

COMMENT ON FUNCTION public.catalog_slug_key(text) IS
  'Canonical key for catalog links; uses the fixed extensions.unaccent dictionary and lowercase folding.';

CREATE OR REPLACE FUNCTION public.catalog_slug_is_valid(p_slug text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.char_length(p_slug) BETWEEN 3 AND 40
    AND p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND p_slug NOT IN (
      'login', 'admin', 'api', 'catalogo', 'p',
      'auth', 'assets', 'downloads', 'plataforma', 'config', 'stock',
      'ventas', 'pedidos', 'proveedores', 'revendedores', 'ia'
    );
$$;

CREATE TABLE public.catalog_slug_registry (
  slug_key text PRIMARY KEY,
  slug text NOT NULL,
  owner_uid uuid NOT NULL,
  is_active boolean NOT NULL,
  reserved_at timestamptz,
  redirect_slug_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_slug_registry_state_check CHECK (
    (is_active AND reserved_at IS NULL) OR (NOT is_active AND reserved_at IS NOT NULL)
  )
);

CREATE INDEX catalog_slug_registry_owner_idx
  ON public.catalog_slug_registry (owner_uid);

ALTER TABLE public.catalog_slug_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalog_slug_registry FROM PUBLIC, anon, authenticated;

-- This check is deliberately read-only and runs before the expression index.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.catalog_config
    GROUP BY public.catalog_slug_key(slug)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate catalog slugs exist after case/accent folding; resolve them before indexing.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX catalog_config_slug_key_unique
  ON public.catalog_config (public.catalog_slug_key(slug));

-- Seed current slugs first, then reserve profile slugs that are already old.
-- No existing catalog_config.slug or profile.catalog_slug is rewritten.
INSERT INTO public.catalog_slug_registry (slug_key, slug, owner_uid, is_active, reserved_at, redirect_slug_key)
SELECT public.catalog_slug_key(cc.slug), cc.slug, cc.user_id, true, NULL, NULL
FROM public.catalog_config AS cc;

WITH profile_aliases AS (
  SELECT p.id AS owner_uid,
         p.catalog_slug,
         public.catalog_slug_key(p.catalog_slug) AS slug_key,
         public.catalog_slug_key(cc.slug) AS redirect_slug_key,
         row_number() OVER (PARTITION BY p.id ORDER BY cc.enabled DESC, cc.slug) AS target_rank
  FROM public.profiles AS p
  JOIN public.catalog_config AS cc ON cc.user_id = p.id
  WHERE p.catalog_slug IS NOT NULL
    AND btrim(p.catalog_slug) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.catalog_config AS same_owner
      WHERE same_owner.user_id = p.id
        AND public.catalog_slug_key(same_owner.slug) = public.catalog_slug_key(p.catalog_slug)
    )
)
INSERT INTO public.catalog_slug_registry (slug_key, slug, owner_uid, is_active, reserved_at, redirect_slug_key)
SELECT slug_key, catalog_slug, owner_uid, false, now(), redirect_slug_key
FROM profile_aliases
WHERE target_rank = 1;

CREATE OR REPLACE FUNCTION public.catalog_slug_registry_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_key text;
  v_new_key text;
  v_rows integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'A catalog cannot be reassigned to another business.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.catalog_slug_is_valid(NEW.slug) THEN
    RAISE EXCEPTION 'El link debe tener entre 3 y 40 letras, números o guiones y no puede ser una palabra reservada.'
      USING ERRCODE = '23514';
  END IF;

  v_new_key := public.catalog_slug_key(NEW.slug);
  IF TG_OP = 'UPDATE' THEN
    v_old_key := public.catalog_slug_key(OLD.slug);
    IF v_old_key IS DISTINCT FROM v_new_key THEN
      UPDATE public.catalog_slug_registry
      SET slug = OLD.slug,
          is_active = false,
          reserved_at = COALESCE(reserved_at, now()),
          redirect_slug_key = v_new_key
      WHERE slug_key = v_old_key
        AND owner_uid = OLD.user_id
        AND is_active;

      IF NOT FOUND THEN
        INSERT INTO public.catalog_slug_registry (slug_key, slug, owner_uid, is_active, reserved_at, redirect_slug_key)
        VALUES (v_old_key, OLD.slug, OLD.user_id, false, now(), v_new_key);
      END IF;
    END IF;
  END IF;

  INSERT INTO public.catalog_slug_registry (slug_key, slug, owner_uid, is_active, reserved_at, redirect_slug_key)
  VALUES (v_new_key, NEW.slug, NEW.user_id, true, NULL, NULL)
  ON CONFLICT (slug_key) DO UPDATE
  SET slug = EXCLUDED.slug,
      is_active = true,
      reserved_at = NULL,
      redirect_slug_key = NULL
  WHERE public.catalog_slug_registry.owner_uid = EXCLUDED.owner_uid;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Ese link ya está en uso.'
      USING ERRCODE = '23505', CONSTRAINT = 'catalog_slug_registry_pkey';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.catalog_slug_registry_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.catalog_slug_registry
  SET is_active = false,
      reserved_at = COALESCE(reserved_at, now()),
      redirect_slug_key = NULL
  WHERE slug_key = public.catalog_slug_key(OLD.slug)
    AND owner_uid = OLD.user_id
    AND is_active;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.catalog_slug_sync_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
  SET catalog_slug = NEW.slug
  WHERE id = NEW.user_id
    AND catalog_slug IS DISTINCT FROM NEW.slug;
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalog_config_slug_registry_write
BEFORE INSERT OR UPDATE OF slug, user_id ON public.catalog_config
FOR EACH ROW EXECUTE FUNCTION public.catalog_slug_registry_before_write();

CREATE TRIGGER catalog_config_slug_registry_delete
BEFORE DELETE ON public.catalog_config
FOR EACH ROW EXECUTE FUNCTION public.catalog_slug_registry_before_delete();

CREATE TRIGGER catalog_config_slug_sync_profile
AFTER INSERT OR UPDATE OF slug ON public.catalog_config
FOR EACH ROW EXECUTE FUNCTION public.catalog_slug_sync_profile();

-- Business display names can repeat. Keep the legacy unique index healthy by
-- leaving its normalized key empty for new profiles and name edits; names and
-- catalog links are independent identifiers.
CREATE OR REPLACE FUNCTION public.clear_legacy_business_name_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.business_name_lower := '';
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_clear_legacy_business_name_key
BEFORE INSERT OR UPDATE OF business_name, business_name_lower ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.clear_legacy_business_name_key();

-- Keep accepting the invited business name even when another business uses it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inv public.invitations%ROWTYPE;
  v_business_name text := pg_catalog.btrim(COALESCE(NEW.raw_user_meta_data->>'business_name', ''));
BEGIN
  SELECT * INTO v_inv
  FROM public.invitations
  WHERE pg_catalog.lower(email) = pg_catalog.lower(COALESCE(NEW.email, ''))
    AND accepted_at IS NULL
    AND revoked_at IS NULL
  ORDER BY invited_at DESC
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.collaborators (
      owner_uid, user_uid, email, permissions, role_preset, invitation_id, created_at
    ) VALUES (
      v_inv.owner_uid, NEW.id, COALESCE(NEW.email, v_inv.email),
      v_inv.permissions, v_inv.role_preset, v_inv.id, pg_catalog.now()
    ) ON CONFLICT (owner_uid, user_uid) DO NOTHING;

    UPDATE public.invitations SET accepted_at = pg_catalog.now() WHERE id = v_inv.id;

    INSERT INTO public.profiles (id, email, display_name, role, currency_symbol, dark_mode, created_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
      'user', '$', false, pg_catalog.now()
    ) ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  END IF;

  IF pg_catalog.char_length(v_business_name) NOT BETWEEN 2 AND 80 THEN
    v_business_name := '';
  END IF;

  INSERT INTO public.profiles (
    id, email, display_name, role, business_name, business_name_lower,
    currency_symbol, dark_mode, created_at
  ) VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
    'user', v_business_name, '', '$', false, pg_catalog.now()
  ) ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.catalog_slug_available(p_slug text, p_current_slug text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.catalog_slug_is_valid(p_slug)
    AND NOT EXISTS (
      SELECT 1
      FROM public.catalog_slug_registry AS r
      WHERE r.slug_key = public.catalog_slug_key(p_slug)
        AND NOT (
          r.owner_uid = auth.uid()
          AND r.slug_key = public.catalog_slug_key(p_current_slug)
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.suggest_catalog_slug(p_base_slug text, p_current_slug text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix text;
  v_number integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere una sesión para sugerir un link.' USING ERRCODE = '42501';
  END IF;

  v_base := pg_catalog.lower(extensions.unaccent(pg_catalog.btrim(p_base_slug)));
  v_base := pg_catalog.regexp_replace(v_base, '[^a-z0-9-]+', '-', 'g');
  v_base := pg_catalog.regexp_replace(v_base, '-+', '-', 'g');
  v_base := pg_catalog.regexp_replace(v_base, '(^-+|-+$)', '', 'g');
  v_base := pg_catalog.left(v_base, 40);
  v_base := pg_catalog.regexp_replace(v_base, '-+$', '', 'g');

  IF pg_catalog.char_length(v_base) = 0 THEN
    v_base := 'tienda';
  ELSIF pg_catalog.char_length(v_base) < 3 THEN
    v_base := v_base || '-2';
  END IF;

  FOR v_number IN 1..9999 LOOP
    IF v_number = 1 THEN
      v_candidate := v_base;
    ELSE
      v_suffix := '-' || v_number::text;
      v_candidate := pg_catalog.regexp_replace(
        pg_catalog.left(v_base, 40 - pg_catalog.char_length(v_suffix)),
        '-+$', '', 'g'
      ) || v_suffix;
    END IF;

    IF public.catalog_slug_is_valid(v_candidate)
      AND NOT EXISTS (
        SELECT 1
        FROM public.catalog_slug_registry AS r
        WHERE r.slug_key = public.catalog_slug_key(v_candidate)
          AND NOT (
            r.owner_uid = auth.uid()
            AND r.slug_key = public.catalog_slug_key(p_current_slug)
          )
      ) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'No se encontró un link disponible.' USING ERRCODE = '54000';
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_public_catalog_slug(p_slug text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH RECURSIVE slug_chain AS (
    SELECT r.slug_key, r.owner_uid, r.is_active, r.redirect_slug_key, 0 AS depth
    FROM public.catalog_slug_registry AS r
    WHERE r.slug_key = public.catalog_slug_key(p_slug)
    UNION ALL
    SELECT target.slug_key, target.owner_uid, target.is_active, target.redirect_slug_key, previous.depth + 1
    FROM slug_chain AS previous
    JOIN public.catalog_slug_registry AS target ON target.slug_key = previous.redirect_slug_key
    WHERE NOT previous.is_active AND previous.depth < 64
  )
  SELECT cc.slug
  FROM slug_chain AS chain
  JOIN public.catalog_config AS cc
    ON cc.user_id = chain.owner_uid
   AND public.catalog_slug_key(cc.slug) = chain.slug_key
  WHERE chain.is_active AND cc.enabled
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.catalog_slug_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_slug_is_valid(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_slug_registry_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_slug_registry_before_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_slug_sync_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_legacy_business_name_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_slug_available(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.suggest_catalog_slug(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_public_catalog_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_slug_available(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suggest_catalog_slug(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_public_catalog_slug(text) TO anon, authenticated;

COMMENT ON TABLE public.catalog_slug_registry IS
  'Global registry for active and permanently reserved historical catalog links.';
