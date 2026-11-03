BEGIN;

DROP POLICY facebook_groups_qa_allowlist_update ON public.facebook_groups;

CREATE POLICY facebook_groups_qa_allowlist_update ON public.facebook_groups
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (SELECT public.has_permission((SELECT auth.uid()), 'stock', 'write'))
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (SELECT public.has_permission((SELECT auth.uid()), 'stock', 'write'))
  );

COMMIT;
