BEGIN;

ALTER TABLE public.profiles ADD COLUMN onboarding_completed_at timestamptz;
UPDATE public.profiles
SET onboarding_completed_at = COALESCE(created_at, now())
WHERE onboarding_completed_at IS NULL AND btrim(business_name) <> '';

-- Preserve collaborator onboarding while accepting a unique business name from
-- a platform invitation for a new owner.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.invitations%ROWTYPE;
  v_business_name text := btrim(COALESCE(NEW.raw_user_meta_data->>'business_name', ''));
  v_business_name_lower text;
BEGIN
  SELECT * INTO v_inv
    FROM public.invitations
   WHERE lower(email) = lower(COALESCE(NEW.email, ''))
     AND accepted_at IS NULL
     AND revoked_at IS NULL
   ORDER BY invited_at DESC
   LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.collaborators (
      owner_uid, user_uid, email, permissions, role_preset, invitation_id, created_at
    ) VALUES (
      v_inv.owner_uid, NEW.id, COALESCE(NEW.email, v_inv.email),
      v_inv.permissions, v_inv.role_preset, v_inv.id, now()
    )
    ON CONFLICT (owner_uid, user_uid) DO NOTHING;

    UPDATE public.invitations SET accepted_at = now() WHERE id = v_inv.id;

    INSERT INTO public.profiles (id, email, display_name, role, currency_symbol, dark_mode, created_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
      'user', '$', false, now()
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  END IF;

  IF char_length(v_business_name) BETWEEN 2 AND 80 THEN
    v_business_name_lower := lower(v_business_name);
  ELSE
    v_business_name := '';
    v_business_name_lower := '';
  END IF;

  IF v_business_name_lower <> '' AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE business_name_lower = v_business_name_lower
  ) THEN
    BEGIN
      INSERT INTO public.profiles (
        id, email, display_name, role, business_name, business_name_lower,
        currency_symbol, dark_mode, created_at
      ) VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
        'user', v_business_name, v_business_name_lower, '$', false, now()
      ) ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      INSERT INTO public.profiles (id, email, display_name, role, currency_symbol, dark_mode, created_at)
      VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
        'user', '$', false, now()
      ) ON CONFLICT (id) DO NOTHING;
    END;
  ELSE
    INSERT INTO public.profiles (id, email, display_name, role, currency_symbol, dark_mode, created_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
      'user', '$', false, now()
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Module checks remain in the existing trigger; suspension is enforced at the
-- database boundary too, including writes that bypass the normal RPCs.
CREATE OR REPLACE FUNCTION public.ai_jobs_require_business_module()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_module text;
BEGIN
  v_module := CASE NEW.task_type
    WHEN 'knowledge_organize' THEN 'knowledge'
    WHEN 'fb_copywriting' THEN 'automation'
    WHEN 'fb_photo_review' THEN 'automation'
    ELSE 'ai'
  END;
  PERFORM public.business_require_module(NEW.user_id, v_module);
  PERFORM public.business_require_active(NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_action_requests_require_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.business_require_module(NEW.user_id, 'automation');
  PERFORM public.business_require_active(NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_chats_require_active_business()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.business_require_module(NEW.user_id, 'ai');
  PERFORM public.business_require_active(NEW.user_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_chats_require_active_business() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ai_chats_require_active_business ON public.ai_chats;
CREATE TRIGGER ai_chats_require_active_business
  BEFORE INSERT ON public.ai_chats
  FOR EACH ROW EXECUTE FUNCTION public.ai_chats_require_active_business();

CREATE OR REPLACE FUNCTION public.approve_facebook_publication(
  p_product uuid,
  p_intent uuid,
  p_content jsonb,
  p_groups uuid[],
  p_marketplace boolean,
  p_repeat_of uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
BEGIN
  PERFORM public.business_require_module(v_owner, 'automation');
  PERFORM public.business_require_active(v_owner);
  IF NOT public.facebook_product_allowed(auth.uid(), p_product, true) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_product::text, 0));
  IF EXISTS (SELECT 1 FROM public.facebook_publications WHERE user_id = v_owner AND intent_key = p_intent) THEN
    RETURN public.approve_facebook_publication_before_attempts(p_product, p_intent, p_content, p_groups, p_marketplace, p_repeat_of);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.facebook_deliveries d JOIN public.facebook_publications p ON p.id = d.publication_id
    WHERE p.user_id = v_owner AND p.product_id = p_product AND d.recovery_required
      AND ((p_marketplace AND d.destination->>'mechanism' = 'marketplace') OR public.facebook_group_key(d.destination->>'url') IN (
        SELECT public.facebook_group_key(url) FROM public.facebook_groups WHERE id = ANY(p_groups) AND user_id = v_owner
      ))
  ) THEN RAISE EXCEPTION 'RECOVERY_REQUIRED'; END IF;
  RETURN public.approve_facebook_publication_before_attempts(p_product, p_intent, p_content, p_groups, p_marketplace, p_repeat_of);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_facebook_publication_v2(
  p_product uuid, p_intent uuid, p_content jsonb, p_groups uuid[], p_marketplace boolean, p_mode text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
BEGIN
  PERFORM public.business_require_module(v_owner, 'automation');
  PERFORM public.business_require_active(v_owner);
  RETURN public.approve_facebook_publication_v2_with_repeat(
    p_product, p_intent, p_content, p_groups, p_marketplace, p_mode, NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_facebook_publication_v2(
  p_product uuid, p_intent uuid, p_content jsonb, p_groups uuid[], p_marketplace boolean, p_mode text, p_repeat_of uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
BEGIN
  PERFORM public.business_require_module(v_owner, 'automation');
  PERFORM public.business_require_active(v_owner);
  RETURN public.approve_facebook_publication_v2_with_repeat(
    p_product, p_intent, p_content, p_groups, p_marketplace, p_mode, p_repeat_of
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_facebook_publication(uuid, uuid, jsonb, uuid[], boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_facebook_publication(uuid, uuid, jsonb, uuid[], boolean, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
