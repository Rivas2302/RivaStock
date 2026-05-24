# Explore — user-roles

## Key Findings

1. **`Collaborator` type exists but is wrong shape.** `src/types.ts:151` defines `Collaborator` with only `role: 'admin' | 'viewer'` — no granular permissions matrix. The entire interface needs to be replaced.

2. **RLS blast radius is total.** Every one of the 12 data tables uses `user_id = auth.uid()`. To let collaborators read/write owner data, every policy needs to be extended. No shared-access escape hatch exists anywhere.

3. **`db.ts` already parameterizes ownerUid.** Every page calls `db.list('products', user.uid)`. For collaborators this becomes the owner's UID. No structural change to db.ts — AuthContext must expose `ownerUid` (equals `user.uid` for owners, owner's profile ID for collaborators).

4. **All RPCs hardcode `v_uid := auth.uid()`.** Every RPC (`register_sale`, `edit_sale`, `delete_sale`, `intake_stock`, `convert_quote_to_sale`, `register_customer_payment`, `register_supplier`, `update_supplier`, `delete_supplier`, `toggle_supplier_active`) verifies `user_id = v_uid`. A collaborator's `auth.uid()` won't match — ALL mutations fail silently for collaborators without a resolution helper.

5. **`handle_new_user()` trigger fires for invited collaborators.** Creates a blank profile with empty `businessName`. AuthContext must detect the collaborator case and load the owner's profile data for display.

6. **Storage bucket uses path-prefix ownership.** `auth.uid()::text = (storage.foldername(name))[1]` — collaborators cannot upload images under the owner's folder. Product image uploads fail silently without a storage policy extension.

7. **No permission guards exist anywhere in UI.** All 11 nav items render unconditionally. `user.role` exists in `UserProfile` but is never checked in any page component.

8. **`inviteUserByEmail` is a Supabase admin API** — cannot be called from frontend. Edge Function with `service_role` key is mandatory.

## Reusable Infrastructure

| Asset | Location | Reuse |
|---|---|---|
| `Collaborator` interface | `src/types.ts:151` | Replace (wrong shape, keep concept) |
| `profiles.role` column | `0001_init.sql` | Reuse for owner vs collaborator distinction |
| `profiles_select_own` RLS | `0001_init.sql:297` | Extend to allow owner to read collaborator rows |
| RPC pattern (SECURITY DEFINER + `auth.uid()`) | `0002_rpcs.sql` | Extend with owner-resolution helper function |
| `AuthContext` / `useAuth` | `src/AuthContext.tsx` | Add `ownerUid`, `permissions`, `isOwner` |
| `db.list(collection, ownerUid)` | `src/lib/db.ts` | Already parameterized — just pass the right UID |
| `ProtectedRoute` | `src/App.tsx:38` | Extend into `PermissionRoute` |

## Risks & Gotchas

**UNIQUE constraint bug — HIGH PRIORITY.** `profiles` has `UNIQUE (business_name_lower)`. Collaborators get `business_name_lower = ''`. The second collaborator invited to any business will hit a unique constraint violation. Must be fixed as a partial unique index (`WHERE business_name_lower <> ''`) in the same migration.

**RPC owner resolution — high complexity.** Need a PL/pgSQL helper `get_owner_uid(v_uid uuid) RETURNS uuid` called by every RPC. If wrong, ALL mutations fail or hit wrong data.

**Cache keying.** `db.ts` caches by `ownerUid` — two collaborators of the same owner sharing a device would share cache entries. Not a security issue (RLS enforces at DB), but UX stale-data risk.

**Edge Function cold starts and invite expiry.** Default magic link TTL is 24h in Supabase. No retry mechanism. SMTP must be configured for production reliability.

**Storage upload paths.** Collaborators uploading product images need either: (a) storage policy extended to allow writes to owner's path, or (b) image uploads restricted by permission.

**Frontend-only guards are UX, not security.** Write permission checks must also be enforced at RLS/RPC level.

## RLS Blast Radius

12 tables — every policy needs an OR clause:

```sql
-- BEFORE:
USING (user_id = auth.uid())

-- AFTER:
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM collaborators c
    WHERE c.collaborator_uid = auth.uid()
      AND c.owner_uid = <table>.user_id
      AND c.status = 'active'
  )
)
```

Tables: categories, price_ranges, products, sales, cash_flow, stock_intakes, customers, customer_transactions, quotes, orders, catalog_config, suppliers.

Plus: `profiles` needs a policy allowing collaborators to SELECT the owner's profile row.
Plus: Storage policies need collaborator path check.

## UI Guard Points

| Location | Guard |
|---|---|
| `src/components/Layout.tsx` | Filter nav items by permissions |
| `src/App.tsx:38` | `PermissionRoute` with module check |
| `src/pages/Stock.tsx` | `canWrite('stock')` on Edit/Delete/Add |
| `src/pages/Sales.tsx` | `canWrite('ventas')` on New Sale/Edit/Delete |
| `src/pages/Intake.tsx` | `canWrite('ingresos')` on Add Intake |
| `src/pages/CashFlow.tsx` | `canWrite('caja')` on Add/Edit/Delete |
| `src/pages/Orders.tsx` | `canWrite('pedidos')` on status changes |
| `src/pages/Quotes.tsx` | `canWrite('presupuestos')` on Create/Edit/Convert |
| `src/pages/Customers.tsx` | `canWrite('clientes')` on Create/Edit/Delete/Payment |
| `src/pages/Suppliers.tsx` | `canWrite('proveedores')` on Create/Edit/Delete/Toggle |
| `src/pages/Settings.tsx` | `canAccess('config')` — redirect if denied |

## Recommended Approach

**JSONB permissions matrix on `collaborators` table + PostgreSQL owner-resolution helper.**

- New `collaborators` table: `(id, owner_uid, collaborator_uid, email, status, permissions jsonb, created_at)`
- New `collaborator_invitations` table: `(id, owner_uid, email, token, expires_at, status)` — pre-acceptance state
- PL/pgSQL helper: `get_owner_uid(v_uid uuid) RETURNS uuid` — used by all RPCs
- RLS: extend 12 policies with EXISTS check (read-only guard; write granularity at RPC/UI level)
- Edge Function `invite-collaborator`: calls `auth.admin.inviteUserByEmail()` + inserts invitation record
- AuthContext: add `ownerUid`, `permissions`, `isOwner`
- `usePermissions()` hook: thin wrapper over AuthContext
- `PermissionRoute`: extends `ProtectedRoute` with module check

Role presets (admin/employee/viewer) are client-side templates that populate the JSONB — DB stores resolved permissions, not preset names.
