BEGIN;

CREATE VIEW public.fb_group_performance
WITH (security_invoker = true)
AS
WITH latest_attempt AS (
  SELECT DISTINCT ON (attempt.delivery_id)
    attempt.delivery_id,
    attempt.started_at,
    attempt.finished_at,
    attempt.tracking_checked_at
  FROM public.facebook_delivery_attempts AS attempt
  ORDER BY attempt.delivery_id, attempt.started_at DESC, attempt.id DESC
), group_activity AS (
  SELECT
    result.group_id,
    delivery.id AS delivery_id,
    publication.id AS publication_id,
    result.status,
    result.checked_at,
    delivery.submitted_at,
    delivery.updated_at,
    publication.approved_at,
    attempt.finished_at,
    attempt.started_at
  FROM public.fb_delivery_group_results AS result
  JOIN public.facebook_deliveries AS delivery ON delivery.id = result.delivery_id
  JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
  LEFT JOIN latest_attempt AS attempt ON attempt.delivery_id = delivery.id

  UNION ALL

  SELECT
    group_row.id AS group_id,
    delivery.id AS delivery_id,
    publication.id AS publication_id,
    CASE
      WHEN delivery.status = 'published' THEN 'published'
      WHEN delivery.issue->>'kind' = 'facebook_not_approved' THEN 'not_approved'
      WHEN delivery.status = 'cancelled' THEN 'cancelled'
      ELSE 'unknown'
    END AS status,
    coalesce(attempt.tracking_checked_at, delivery.updated_at) AS checked_at,
    delivery.submitted_at,
    delivery.updated_at,
    publication.approved_at,
    attempt.finished_at,
    attempt.started_at
  FROM public.facebook_deliveries AS delivery
  JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
  JOIN LATERAL (
    SELECT candidate.id
    FROM public.facebook_groups AS candidate
    WHERE candidate.user_id = publication.user_id
      AND public.facebook_group_key(candidate.url) = public.facebook_group_key(delivery.destination->>'url')
    ORDER BY candidate.id
    LIMIT 1
  ) AS group_row ON true
  LEFT JOIN latest_attempt AS attempt ON attempt.delivery_id = delivery.id
  WHERE delivery.destination->>'mechanism' = 'group_direct'
    AND NOT EXISTS (
      SELECT 1 FROM public.fb_delivery_group_results AS existing
      WHERE existing.delivery_id = delivery.id
    )
), group_results AS (
  SELECT
    activity.group_id,
    count(DISTINCT activity.publication_id) FILTER (WHERE activity.status <> 'cancelled')::integer AS publication_count,
    count(*) FILTER (WHERE activity.status = 'published')::integer AS published_count,
    count(*) FILTER (WHERE activity.status IN ('pending', 'selected', 'pending_approval', 'unknown', 'not_found_in_list'))::integer AS pending_count,
    count(*) FILTER (WHERE activity.status = 'not_approved')::integer AS rejected_count,
    round(
      100.0 * count(*) FILTER (WHERE activity.status = 'published')
      / NULLIF(count(*) FILTER (WHERE activity.status IN ('published', 'not_approved')), 0),
      1
    ) AS approval_rate_pct,
    avg(
      greatest(
        0,
        extract(epoch FROM (
          activity.checked_at - coalesce(activity.submitted_at, activity.finished_at, activity.started_at)
        ))
      )
    ) FILTER (
      WHERE activity.status = 'published'
        AND activity.checked_at IS NOT NULL
        AND coalesce(activity.submitted_at, activity.finished_at, activity.started_at) IS NOT NULL
    ) AS avg_approval_seconds,
    max(coalesce(activity.submitted_at, activity.approved_at)) FILTER (WHERE activity.status <> 'cancelled') AS last_used_at,
    max(activity.checked_at) FILTER (WHERE activity.status = 'not_approved') AS last_rejected_at,
    count(*) FILTER (
      WHERE activity.status = 'not_approved'
        AND activity.checked_at >= now() - interval '30 days'
    )::integer AS rejected_last_30d_count
  FROM group_activity AS activity
  GROUP BY activity.group_id
)
SELECT
  group_row.id AS group_id,
  group_row.name AS group_name,
  group_row.url AS group_url,
  group_row.member_count_text,
  group_row.member_count_updated_at,
  coalesce(group_results.publication_count, 0) AS publication_count,
  coalesce(group_results.published_count, 0) AS published_count,
  coalesce(group_results.pending_count, 0) AS pending_count,
  coalesce(group_results.rejected_count, 0) AS rejected_count,
  group_results.approval_rate_pct,
  group_results.avg_approval_seconds,
  group_results.last_used_at,
  group_results.last_rejected_at,
  coalesce(group_results.rejected_last_30d_count, 0) AS rejected_last_30d_count
FROM public.facebook_groups AS group_row
LEFT JOIN group_results ON group_results.group_id = group_row.id
WHERE group_row.user_id = public.get_owner_uid(auth.uid())
  AND public.has_permission(auth.uid(), 'stock', 'read');

REVOKE ALL ON public.fb_group_performance FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fb_group_performance TO authenticated;

COMMIT;
