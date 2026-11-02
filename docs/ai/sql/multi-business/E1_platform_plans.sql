-- E1 · Planes por negocio y administración de plataforma (aditiva)
BEGIN;

CREATE TABLE public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.business_plans (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  limits      jsonb NOT NULL CHECK (jsonb_typeof(limits) = 'object'),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.business_subscriptions (
  owner_uid        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_code        text NOT NULL REFERENCES public.business_plans(code),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'suspended')),
  limit_overrides  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limit_overrides) = 'object'),
  notes            text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_subscriptions_plan_idx ON public.business_subscriptions (plan_code);

CREATE TABLE public.platform_settings (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  db_budget_bytes       bigint NOT NULL CHECK (db_budget_bytes > 0),
  storage_budget_bytes  bigint NOT NULL CHECK (storage_budget_bytes > 0),
  warn_ratio            numeric NOT NULL DEFAULT 0.8 CHECK (warn_ratio > 0 AND warn_ratio < 1),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Presupuestos = 90 % del plan Free. E0 confirma el tope real de Storage y ajusta storage_budget_bytes.
INSERT INTO public.platform_settings (id, db_budget_bytes, storage_budget_bytes)
VALUES (true, 471859200, 471859200);

-- Claves de límites (todas obligatorias en 'base', que es el valor por defecto):
--   cloud_knowledge_bytes  archivos de Conocimientos en la nube (imágenes del editor, miniaturas y archivos en espera de pasar a la central)
--   local_knowledge_bytes  originales guardados en la central del negocio
--   trace_bytes            capturas de diagnóstico del publicador
--   trace_retention_days   días que se guardan esas capturas
--   collaborators          colaboradores activos
--   codex_sandbox          'read-only' | 'workspace-write' | 'danger-full-access'
INSERT INTO public.business_plans (code, name, limits, sort_order) VALUES
  ('interno', 'Interno', '{"cloud_knowledge_bytes":524288000,"local_knowledge_bytes":53687091200,"trace_bytes":150000000,"trace_retention_days":14,"collaborators":50,"codex_sandbox":"danger-full-access"}', 0),
  ('base',    'Base',    '{"cloud_knowledge_bytes":52428800,"local_knowledge_bytes":21474836480,"trace_bytes":30000000,"trace_retention_days":7,"collaborators":5,"codex_sandbox":"read-only"}', 10),
  ('pro',     'Pro',     '{"cloud_knowledge_bytes":157286400,"local_knowledge_bytes":107374182400,"trace_bytes":60000000,"trace_retention_days":14,"collaborators":15,"codex_sandbox":"read-only"}', 20);

ALTER TABLE public.platform_admins        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins, public.business_plans, public.business_subscriptions, public.platform_settings
  FROM anon, authenticated;

-- ───────── Helpers internos (sin EXECUTE para clientes) ─────────
CREATE FUNCTION public.business_owner_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id FROM profiles p
  -- Un colaborador (activo o revocado) nunca es un negocio: su perfil es solo un marcador.
  WHERE NOT EXISTS (SELECT 1 FROM collaborators c WHERE c.user_uid = p.id)
$$;

CREATE FUNCTION public.business_limits(p_owner uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.limits || COALESCE(p.limits, '{}'::jsonb) || COALESCE(s.limit_overrides, '{}'::jsonb)
  FROM business_plans d
  LEFT JOIN business_subscriptions s ON s.owner_uid = p_owner
  LEFT JOIN business_plans p ON p.code = s.plan_code
  WHERE d.code = 'base'
$$;

CREATE FUNCTION public.business_limit_bigint(p_owner uuid, p_key text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb := business_limits(p_owner) -> p_key;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'number' THEN
    RAISE EXCEPTION 'Límite no configurado: %', p_key;
  END IF;
  RETURN floor((v #>> '{}')::numeric)::bigint;
END;
$$;

CREATE FUNCTION public.business_status(p_owner uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT status FROM business_subscriptions WHERE owner_uid = p_owner), 'active')
$$;

CREATE FUNCTION public.business_require_active(p_owner uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF business_status(p_owner) = 'suspended' THEN
    RAISE EXCEPTION 'La cuenta del negocio está suspendida. Comunicate con RivaTech.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.business_owner_ids() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.business_limits(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.business_limit_bigint(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.business_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.business_require_active(uuid) FROM PUBLIC, anon, authenticated;

-- ───────── RPC para la app ─────────
CREATE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid())
$$;

CREATE FUNCTION public.my_business_plan()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_code text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_owner := get_owner_uid(v_uid);
  v_code := COALESCE((SELECT plan_code FROM business_subscriptions WHERE owner_uid = v_owner), 'base');
  RETURN jsonb_build_object(
    'plan_code', v_code,
    'plan_name', (SELECT name FROM business_plans WHERE code = v_code),
    'status', business_status(v_owner),
    'limits', business_limits(v_owner)
  );
END;
$$;

CREATE FUNCTION public.platform_require_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Solo para administración de RivaStock'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_require_admin() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.platform_list_plans()
RETURNS SETOF public.business_plans
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM platform_require_admin();
  RETURN QUERY SELECT * FROM business_plans ORDER BY sort_order, code;
END;
$$;

CREATE FUNCTION public.platform_set_business_plan(
  p_owner uuid,
  p_plan_code text,
  p_status text DEFAULT 'active',
  p_limit_overrides jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT ''
)
RETURNS public.business_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row business_subscriptions%ROWTYPE;
BEGIN
  PERFORM platform_require_admin();
  IF NOT EXISTS (SELECT 1 FROM business_owner_ids() o WHERE o = p_owner) THEN
    RAISE EXCEPTION 'Negocio inexistente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM business_plans WHERE code = p_plan_code AND is_active) THEN
    RAISE EXCEPTION 'Plan inexistente';
  END IF;
  IF p_owner = auth.uid() AND p_status = 'suspended' THEN
    RAISE EXCEPTION 'No podés suspender tu propio negocio';
  END IF;
  INSERT INTO business_subscriptions (owner_uid, plan_code, status, limit_overrides, notes)
  VALUES (p_owner, p_plan_code, p_status, COALESCE(p_limit_overrides, '{}'::jsonb), left(COALESCE(p_notes, ''), 1000))
  ON CONFLICT (owner_uid) DO UPDATE
    SET plan_code = EXCLUDED.plan_code,
        status = EXCLUDED.status,
        limit_overrides = EXCLUDED.limit_overrides,
        notes = EXCLUDED.notes,
        updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_business_plan() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_list_plans() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_set_business_plan(uuid, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_business_plan() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_plans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_set_business_plan(uuid, text, text, jsonb, text) TO authenticated;

-- Negocios existentes: plan 'interno' (son cuentas del dueño de la plataforma; E0 lo confirma antes de aplicar).
INSERT INTO public.business_subscriptions (owner_uid, plan_code, notes)
SELECT o, 'interno', 'Cuenta existente al activar los planes'
FROM public.business_owner_ids() o
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = o)
ON CONFLICT (owner_uid) DO NOTHING;

COMMIT;
