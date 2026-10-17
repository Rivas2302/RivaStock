-- B5: Classify and cancel the 41 orphan deliveries (submitted_at IS NULL).
-- submitted_at is set at checkpoint/authorize — NULL means no click was ever authorized.
-- REVIEW the SELECT below before running the UPDATE.
-- Do not cancel deliveries that have any 'checkpoint' or 'result' event.
-- This migration is safe to apply in a single transaction on production.

-- ─────────── REVIEW FIRST ───────────
-- Run this SELECT to see what will be cancelled:
--
-- SELECT d.id, d.status, d.message, d.updated_at,
--        p.content->>'title' AS title,
--        d.destination->>'name' AS destination
-- FROM facebook_deliveries d
-- JOIN facebook_publications p ON p.id=d.publication_id
-- WHERE d.status='attention'
--   AND d.submitted_at IS NULL
--   AND NOT EXISTS (
--     SELECT 1 FROM facebook_delivery_attempts a
--     JOIN facebook_delivery_attempt_events e ON e.attempt_id=a.id
--     WHERE a.delivery_id=d.id AND e.type IN ('checkpoint','result','receipt','evidence_rejected')
--   )
-- ORDER BY d.updated_at;

BEGIN;

UPDATE facebook_deliveries
SET status='cancelled',
    message='Cancelado en saneamiento 2026-10-17: preparación sin autorización del envío.',
    updated_at=now()
WHERE status='attention'
  AND submitted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM facebook_delivery_attempts a
    JOIN facebook_delivery_attempt_events e ON e.attempt_id=a.id
    WHERE a.delivery_id=facebook_deliveries.id
      AND e.type IN ('checkpoint','result','receipt','evidence_rejected')
  );

-- Verify: should return 0 after applying.
-- SELECT count(*) FROM facebook_deliveries WHERE status='attention' AND submitted_at IS NULL;

COMMIT;
