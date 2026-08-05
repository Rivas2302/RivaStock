# Pending migrations: 0033, 0034, 0035

The Supabase project is currently at migration **0032**. The owner-aware
sales rollout lives in the next three files and must be applied in order.

## Apply via Supabase Dashboard (recommended for one-off)

1. Open the Supabase project dashboard.
2. Go to **SQL Editor**.
3. For each file below, in this exact order:
   - Open the file from this folder.
   - Copy the entire contents (Ctrl+A, Ctrl+C).
   - Paste into a new SQL query in the editor.
   - Click **Run** (or press Ctrl+Enter).
   - Wait for "Success. No rows returned" or the equivalent success message.

### Run order

| Step | File | Size  | Notes |
|------|------|-------|-------|
| 1    | `0033_owner_aware_stock.sql`         | 27 KB | Adds `inventory_product_commands`, rewires `stock_intakes`/`inventory_stock_commands` RLS, fails `holdings_enabled` to `false`. Includes several function bodies for owner-aware intake and stock mutation. |
| 2    | `0034_attributed_sales.sql`          | 104 KB| Creates `sale_items`, `sale_item_allocations`, `stock_movements`, `cash_flow_allocations`, `attributed_sale_commands`. Defines `register_attributed_sale`, `edit_attributed_sale`, `refund_attributed_sale`. This is the largest file; expect ~5–30 s depending on row count. |
| 3    | `0035_sales_attribution_ui.sql`     | 4 KB  | Adds the missing `toggle_attributed_sale_status` RPC. Re-affirms `holdings_enabled = false` (rollout stays opt-in). |

If any step fails, **stop and do not run the next one**. Paste the error
into the bug report; the transaction was rolled back automatically
because each file is wrapped in `BEGIN; ... COMMIT;`.

## Verify after the three runs

Run the following in the SQL Editor to confirm the rollout is in place
but still disabled (operator toggles it from the app's Settings page):

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_name = 'attributed_sale_commands') AS attributed_commands_table,
  (SELECT count(*) FROM information_schema.routines
     WHERE routine_name IN (
       'register_attributed_sale',
       'edit_attributed_sale',
       'refund_attributed_sale',
       'toggle_attributed_sale_status'
     )) AS attributed_rpcs,
  (SELECT holdings_enabled FROM inventory_operation_settings
     WHERE user_id = (SELECT id FROM profiles ORDER BY created_at LIMIT 1))
     AS holdings_enabled_sample;
```

Expected output:

| column                    | value |
|---------------------------|-------|
| `attributed_commands_table` | 1     |
| `attributed_rpcs`         | 4     |
| `holdings_enabled_sample` | false |

If `attributed_rpcs` is 3 (missing `toggle_attributed_sale_status`), step 3 did
not complete. Re-run `0035_sales_attribution_ui.sql`.

## Activate the feature (after verification)

Open the app, go to **Configuración → Titulares**, and flip the
**Stock compartido por titular** switch. The app calls
`set_inventory_holdings_enabled(true)`. No SQL is needed from the operator.

## Rollback

There is no automatic rollback. Reverting the code in git is safe (the
feature is opt-in and the helper queries degrade gracefully), but
removing the new tables/RPCs from the live database would require a
custom migration that you almost certainly do not want. Plan accordingly
before applying 0034 to a populated database.
