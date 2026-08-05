-- scripts/sql/0033_disable_audit_triggers.sql
-- Suspends the immutable audit triggers so that the schema backfills in
-- 0033_owner_aware_stock.sql can run from the SQL Editor (which has no
-- auth.uid() and would otherwise fail with P0001 'Authentication
-- required to create an audit event').
--
-- Run this BEFORE re-running 0033. Then run the re-enable script.

BEGIN;

ALTER TABLE stock_intakes DISABLE TRIGGER stock_intakes_audit_event;

COMMIT;
