# Pending migration: 0038

Migrations 0033 through 0037 have already been applied. Migration 0038
fixes a PostgREST schema-cache staleness problem that surfaces as
"cannot extract elements from a scalar" when the Stock form saves a
product.

## Why

The 0034 `save_product_with_holdings` wrapper returns a single
`RETURNS jsonb` object. PostgREST's schema cache sometimes serves a
stale view of that function as a SETOF, which makes the request layer
try to iterate the response as an array. The iteration fails because
the response is a single object, and the user sees the cryptic
"cannot extract elements from a scalar" error.

The fix is twofold:

1. `NOTIFY pgrst, 'reload schema'` is sent before and after the
   `CREATE OR REPLACE FUNCTION` so PostgREST picks up the new
   definition immediately.
2. The function is rewritten to `RETURNS TABLE (product jsonb,
   holdings jsonb)`. A TABLE return is always serialized by PostgREST
   as a single row, never as a scalar, so the schema cache ambiguity
   goes away entirely.

The unlocked inner function is left alone, so the existing
attribution logic (idempotency, holdings reconciliation, owner
authorization) is unchanged.

## Apply via Supabase Dashboard

1. Open the Supabase project dashboard.
2. Go to **SQL Editor**.
3. Open `scripts/sql/0038_save_product_with_holdings_return_table.sql`
   from this folder.
4. Copy the entire contents (Ctrl+A, Ctrl+C).
5. Paste into a new SQL query in the editor.
6. Click **Run** (or press Ctrl+Enter).
7. Wait for "Success. No rows returned" or the equivalent success
   message.

The migration is wrapped in `BEGIN; ... COMMIT;` and uses
`NOTIFY pgrst, 'reload schema'` to invalidate PostgREST's cache both
before and after the function change, so a single run is enough.

## Verify after the run

```sql
SELECT
  pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'save_product_with_holdings';
```

Expected output:

| column        | value              |
|---------------|--------------------|
| `return_type` | `TABLE (product jsonb, holdings jsonb)` |

If the result is still `jsonb`, the migration did not apply. Re-run
`0038_save_product_with_holdings_return_table.sql`.

## Historical run order (for reference)

These were applied previously and should already be in place:

| # | File | Purpose |
|---|------|---------|
| 1 | `0033_owner_aware_stock.sql`        | Owner-aware stock intake + `inventory_product_commands` |
| 2 | `0034_attributed_sales.sql`         | `sale_items`, `sale_item_allocations`, attributed RPCs, backfill |
| 3 | `0035_sales_attribution_ui.sql`     | `toggle_attributed_sale_status` |
| 4 | `0036_release_owner_aware_rollout.sql` | Drop the kill switch |
| 5 | `0037_inventory_movements_history.sql` | Movements view + paginated RPC |
| 6 | `0038_save_product_with_holdings_return_table.sql` | Return-table rewrite + cache reload (this run) |
**Configuración → Titulares → Historial de movimientos** tab.

## Apply via Supabase Dashboard

1. Open the Supabase project dashboard.
2. Go to **SQL Editor**.
3. For each file below, in this exact order:
   - Open the file from this folder.
   - Copy the entire contents (Ctrl+A, Ctrl+C).
   - Paste into a new SQL query in the editor.
   - Click **Run** (or press Ctrl+Enter).
   - Wait for "Success. No rows returned" or the equivalent success message.

### Run order

| Step | File | Size | Notes |
|------|------|------|-------|
| 1    | `0037_inventory_movements_history.sql` | ~3 KB | Creates the `inventory_movements_view` (security-invoker, joins `inventory_stock_commands` and adds a `movement_type` column plus a paired `transfer_key`). Adds the paginated `list_inventory_movements` RPC and a `(user_id, created_at DESC)` index for the time-range scan. |

If the run fails, the transaction is rolled back automatically because
the file is wrapped in `BEGIN; ... COMMIT;`.

## Verify after the run

Run the following in the SQL Editor:

```sql
SELECT
  (SELECT count(*) FROM information_schema.views
     WHERE table_name = 'inventory_movements_view') AS movements_view,
  (SELECT count(*) FROM information_schema.routines
     WHERE routine_name = 'list_inventory_movements') AS list_rpc,
  (SELECT count(*) FROM pg_indexes
     WHERE indexname = 'inventory_stock_commands_created_at_idx') AS history_index;
```

Expected output:

| column          | value |
|-----------------|-------|
| `movements_view` | 1     |
| `list_rpc`      | 1     |
| `history_index` | 1     |

## Activate the feature

The migration only enables the data layer. The operator-facing UI is
shipped in a follow-up commit; no further SQL is needed from the
operator.

## Rollback

```sql
DROP VIEW IF EXISTS inventory_movements_view;
DROP FUNCTION IF EXISTS list_inventory_movements(
  date, date, uuid, uuid, text, integer, integer
);
DROP INDEX IF EXISTS inventory_stock_commands_created_at_idx;
```

The underlying `inventory_stock_commands` table is untouched.

## Historical run order (for reference)

These were applied previously and should already be in place:

| # | File | Purpose |
|---|------|---------|
| 1 | `0033_owner_aware_stock.sql`        | Owner-aware stock intake + `inventory_product_commands` |
| 2 | `0034_attributed_sales.sql`         | `sale_items`, `sale_item_allocations`, attributed RPCs, backfill |
| 3 | `0035_sales_attribution_ui.sql`     | `toggle_attributed_sale_status` |
| 4 | `0036_release_owner_aware_rollout.sql` | Drop the kill switch |
| 5 | `0037_inventory_movements_history.sql` | Movements view + paginated RPC (this run) |
