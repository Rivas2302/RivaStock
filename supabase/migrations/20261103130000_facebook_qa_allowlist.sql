BEGIN;

ALTER TABLE public.products
  ADD COLUMN qa_publish_allowed boolean NOT NULL DEFAULT false;

ALTER TABLE public.facebook_groups
  ADD COLUMN qa_publish_allowed boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.guard_qa_publish_allowlist_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL
    OR auth.uid() IS DISTINCT FROM NEW.user_id
    OR public.get_owner_uid(auth.uid()) IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Solo el dueño puede habilitar un elemento para pruebas automáticas';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_qa_publish_allowlist_owner() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER products_qa_publish_allowlist_owner
  BEFORE UPDATE OF qa_publish_allowed ON public.products
  FOR EACH ROW
  WHEN (OLD.qa_publish_allowed IS DISTINCT FROM NEW.qa_publish_allowed)
  EXECUTE FUNCTION public.guard_qa_publish_allowlist_owner();

CREATE TRIGGER products_qa_publish_allowlist_insert_owner
  BEFORE INSERT ON public.products
  FOR EACH ROW
  WHEN (NEW.qa_publish_allowed)
  EXECUTE FUNCTION public.guard_qa_publish_allowlist_owner();

CREATE TRIGGER facebook_groups_qa_publish_allowlist_owner
  BEFORE UPDATE OF qa_publish_allowed ON public.facebook_groups
  FOR EACH ROW
  WHEN (OLD.qa_publish_allowed IS DISTINCT FROM NEW.qa_publish_allowed)
  EXECUTE FUNCTION public.guard_qa_publish_allowlist_owner();

CREATE TRIGGER facebook_groups_qa_publish_allowlist_insert_owner
  BEFORE INSERT ON public.facebook_groups
  FOR EACH ROW
  WHEN (NEW.qa_publish_allowed)
  EXECUTE FUNCTION public.guard_qa_publish_allowlist_owner();

CREATE POLICY facebook_groups_qa_allowlist_update ON public.facebook_groups
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.has_permission(auth.uid(), 'stock', 'write'))
  WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'stock', 'write'));

GRANT UPDATE (qa_publish_allowed) ON public.products TO authenticated;
GRANT UPDATE (qa_publish_allowed) ON public.facebook_groups TO authenticated;

COMMIT;
