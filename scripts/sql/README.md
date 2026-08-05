# Pending migrations: 0037

Migrations 0033 through 0036 have already been applied. Migration 0037
adds the read-only `inventory_movements_view` and the
`list_inventory_movements` RPC that power the new
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
