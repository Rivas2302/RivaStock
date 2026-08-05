-- scripts/sql/0033_enable_audit_triggers.sql
-- Re-enables the audit triggers that 0033_disable_audit_triggers.sql
-- suspended. Always run this AFTER 0033 has finished successfully.
-- Skipping this leaves the system without stock_intakes audit history.

BEGIN;

ALTER TABLE stock_intakes ENABLE TRIGGER stock_intakes_audit_event;

COMMIT;
