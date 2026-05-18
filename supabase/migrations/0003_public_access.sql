-- 0003_public_access.sql
-- Allow anonymous access to quotes (public share links) and minimal profile data.

-- ── Quotes: allow anonymous read by id ───────────────────────────────────────
CREATE POLICY "quotes_public_read_by_id" ON quotes
  FOR SELECT USING (true);

-- ── Public profile view (minimal data, no email/role exposed) ────────────────
CREATE OR REPLACE VIEW public_profiles AS
  SELECT id, business_name, phone, email_contact, currency_symbol
  FROM profiles;

GRANT SELECT ON public_profiles TO anon, authenticated;

-- ── Orders public SELECT: owner can read their own orders ────────────────────
-- (already covered by orders_owner, but add SELECT for anon not needed here)
