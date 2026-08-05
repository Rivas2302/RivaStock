# Pending migrations: 0036

Migrations 0033, 0034 and 0035 have already been applied to the Supabase
project. Migration 0036 is the only one left; it removes a placeholder
kill switch that 0033/0034 added to `set_inventory_holdings_enabled`
and that now blocks the operator-facing rollout switch from flipping on.

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
| 1    | `0036_release_owner_aware_rollout.sql` | <1 KB | Replaces `set_inventory_holdings_enabled` with the clean version from 0032 (no `RAISE EXCEPTION` on `p_enabled = true`). Re-asserts the `REVOKE` / `GRANT` to `authenticated`. |

If the run fails, the transaction is rolled back automatically because
the file is wrapped in `BEGIN; ... COMMIT;`.

## Verify after the run

Run the following in the SQL Editor:

```sql
SELECT prosrc ~ 'RAISE EXCEPTION.*idempotencia estable' AS still_blocks_rollout
FROM pg_proc
WHERE proname = 'set_inventory_holdings_enabled';
```

Expected output:

| column                  | value |
|-------------------------|-------|
| `still_blocks_rollout`  | false |

If `true`, the migration did not apply. Re-run
`0036_release_owner_aware_rollout.sql`.

## Activate the feature

Open the app, go to **Configuración → Titulares**, and flip the
**Stock compartido por titular** switch. The app calls
`set_inventory_holdings_enabled(true)` and the new function accepts it.

## Rollback

If the rollout misbehaves in production, the operator can flip the
switch off from the same screen. The schema and idempotency tables
created by 0033/0034/0035 stay in place; only the flag changes. No
data is destroyed.

## Historical run order (for reference)

These three were applied previously and should already be in place:

| # | File | Purpose |
|---|------|---------|
| 1 | `0033_owner_aware_stock.sql`        | Owner-aware stock intake + `inventory_product_commands` |
| 2 | `0034_attributed_sales.sql`         | `sale_items`, `sale_item_allocations`, attributed RPCs, backfill |
| 3 | `0035_sales_attribution_ui.sql`     | `toggle_attributed_sale_status` |
| 4 | `0036_release_owner_aware_rollout.sql` | Drop the kill switch (this run) |
