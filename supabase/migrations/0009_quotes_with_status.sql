-- 0009_quotes_with_status.sql
-- View that computes quote expiry status server-side to avoid client-side clock drift.

CREATE OR REPLACE VIEW quotes_with_status AS
SELECT
  *,
  CASE
    WHEN status IN ('accepted', 'rejected') THEN status
    WHEN expires_at < now()                 THEN 'expired'
    ELSE status
  END AS effective_status
FROM quotes;
