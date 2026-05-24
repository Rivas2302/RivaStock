# Tasks — user-roles

**Change ID**: `user-roles`
**Phase**: Tasks
**Date**: 2026-05-23
**Delivery**: Single PR — `size:exception` approved
**Strategy**: DB → Edge Function → Auth/Types → UI Guards → Team UI

---

## Review Workload Forecast

- Estimated changed files: ~26
- Estimated changed lines: ~1,400
- Chained PRs recommended: No (single PR approved, size:exception)
- Decision needed before apply: No

---

## Group 1: Database Migrations

> These must be applied in order. All downstream work depends on them. Run sequentially.

### DB-1: Fix profiles UNIQUE constraint

**What**: Drop the global UNIQUE constraint on `profiles.business_name_lower` and replace it with a partial unique index that excludes empty strings.

**Files**:
- `supabase/migrations/0018_fix_profiles_business_name_unique.sql` *(create)*

**Done when**:
- File contains `ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_business_name_lower_key;`
- File contains `CREATE UNIQUE INDEX IF NOT EXISTS profiles_business_name_lower_unique ON profiles (business_name_lower) WHERE business_name_lower <> '';`
- Migration runs without error against the local DB
- Two rows with `business_name_lower = ''` can coexist without a constraint violation

---

### DB-2: Create collaborators schema, helpers, and trigger extension

**What**: Create `invitations` and `collaborators` tables with indexes and RLS, define `get_owner_uid` and `has_permission` SECURITY DEFINER functions, and extend `handle_new_user` to materialize collaborator rows on magic-link sign-up.

**Files**:
- `supabase/migrations/0019_collaborators_schema.sql` *(create)*

**Done when**:
- `invitations` table exists with columns: `id`, `owner_uid`, `email`, `permissions`, `role_preset`, `invited_at`, `accepted_at`, `revoked_at`; UNIQUE on `(owner_uid, email)`; partial index on `lower(email) WHERE accepted_at IS NULL AND revoked_at IS NULL`
- `collaborators` table exists with columns: `id`, `owner_uid`, `user_uid`, `email`, `permissions`, `role_preset`, `invitation_id`, `created_at`, `revoked_at`; UNIQUE on `(owner_uid, user_uid)`; two partial indexes on `user_uid` and `owner_uid WHERE revoked_at IS NULL`
- RLS is enabled on both tables with the exact policies in design §2.2
- `get_owner_uid(uuid)` returns the caller's own UID when no active collaborator row exists, and the owner's UID when one does
- `has_permission(uuid, text, text)` returns `true` for owners (no collaborator row) and evaluates the JSONB for collaborators
- `handle_new_user` trigger: when a new auth.users insert has a matching pending invitation, inserts into `collaborators`, marks `invitations.accepted_at`, and inserts a minimal placeholder `profiles` row; falls back to existing owner-signup path otherwise
- Migration runs without error; existing owner signups still produce a normal `profiles` row

---

### DB-3: Extend RLS policies, rewrite RPCs, add new owner RPCs, and update storage policies

**What**: Drop and recreate SELECT/write policies on all 12 user-scoped tables so collaborators can read the owner's data; rewrite all 12 existing write RPCs to use `get_owner_uid` + `has_permission`; add the 5 new owner-only RPCs; add `get_owner_profile` RPC; extend storage bucket policies.

**Files**:
- `supabase/migrations/0020_extend_rls_and_rpcs.sql` *(create)*

**Done when**:
- All 12 tables (`categories`, `price_ranges`, `products`, `sales`, `cash_flow`, `stock_intakes`, `customers`, `customer_transactions`, `quotes`, `orders`, `catalog_config`, `suppliers`) have a split SELECT policy (owner OR active collaborator of owner) and separate INSERT/UPDATE/DELETE owner-only policies
- All 12 existing write RPCs listed in design §3.3 use `v_caller := auth.uid()` and `v_uid := get_owner_uid(v_caller)` in their DECLARE/BEGIN prologues, and call `has_permission` before any write
- `rg -n "v_uid\s+uuid\s+:=\s+auth\.uid\(\)" supabase/migrations/0020_extend_rls_and_rpcs.sql` returns zero matches
- `get_owner_profile()` SECURITY DEFINER function exists and returns the owner's profile row for both owners and collaborators
- New RPCs exist with correct signatures: `list_collaborators()`, `list_invitations()`, `update_collaborator_permissions(uuid, jsonb, text)`, `revoke_collaborator(uuid)`, `revoke_invitation(uuid)`
- Storage policies `assets_auth_insert`, `assets_auth_update`, `assets_auth_delete` are dropped and recreated using `get_owner_uid(auth.uid())` as the path prefix check
- Migration runs without error; existing owner CRUD operations still succeed

---

## Group 2: Edge Function

> Depends on DB-2 (`invitations` table must exist). Can be developed in parallel with DB-3 if DB-2 is applied first.

### EF-1: Create `invite-collaborator` Edge Function

**What**: Implement the Deno Edge Function that authenticates the caller, verifies they are an owner, validates input, upserts an `invitations` row, and calls `auth.admin.inviteUserByEmail`.

**Files**:
- `supabase/functions/invite-collaborator/index.ts` *(create)* — full implementation per design §4.2
- `supabase/functions/invite-collaborator/deno.json` *(create)* — minimal Deno config if needed for local `supabase functions serve`

**Done when**:
- `POST /functions/v1/invite-collaborator` with a valid owner JWT + valid body returns `{ invitation_id, status: 'sent' }` (status 200)
- Request from a collaborator JWT returns 403
- Request with invalid email returns 400 with `{ error: 'Email inválido' }`
- Request with invalid permissions shape returns 400
- Resend for the same `(owner_uid, email)` updates permissions and sends again (idempotent)
- `SUPABASE_SERVICE_ROLE_KEY` is only accessed from `Deno.env` — never returned in any response body
- `supabase functions deploy invite-collaborator` completes without error

---

## Group 3: TypeScript Type System

> No DB dependency. Can start in parallel with Group 1 as long as it ships before AuthContext changes (Group 4).

### TYPE-1: Add permission types and replace broken Collaborator interface

**What**: Delete the existing broken `Collaborator` interface (lines 151–157) and add `ModuleKey`, `ActionKey`, `ModulePermissions`, `PermissionMatrix`, `StaffRole`, `ALL_TRUE_PERMISSIONS`, and new `Collaborator` and `Invitation` interfaces.

**Files**:
- `src/types.ts` *(modify)*

**Done when**:
- Old `Collaborator` interface at lines 151–157 is removed
- `ModuleKey` union type covers exactly the 9 keys: `stock | ventas | caja | ingresos | pedidos | presupuestos | clientes | proveedores | config`
- `ActionKey` is `'read' | 'write' | 'delete'`
- `PermissionMatrix` is `Record<ModuleKey, ModulePermissions>`
- `ALL_TRUE_PERMISSIONS` constant satisfies `PermissionMatrix` with all values `true`
- `Collaborator` interface has: `id`, `ownerUid`, `userUid`, `email`, `permissions: PermissionMatrix`, `rolePreset: StaffRole | null`, `invitationId`, `createdAt`, `revokedAt`
- `Invitation` interface has: `id`, `ownerUid`, `email`, `permissions: PermissionMatrix`, `rolePreset`, `invitedAt`, `acceptedAt`, `revokedAt`
- TypeScript compilation passes with `tsc --noEmit` (or Vite build) with no new type errors

---

### TYPE-2: Create role presets library

**What**: Create `src/lib/rolePresets.ts` with the three canonical preset `PermissionMatrix` constants and helpers (`ROLE_PRESETS`, `ROLE_PRESET_LABELS`, `presetForMatrix`, `emptyMatrix`).

**Files**:
- `src/lib/rolePresets.ts` *(create)*

**Done when**:
- `ROLE_PRESETS.admin`, `.employee`, `.viewer` each satisfy `PermissionMatrix` with the exact values from spec §FR-12 table
- `ROLE_PRESET_LABELS` maps all four `StaffRole` values to Spanish display strings
- `presetForMatrix` returns `'custom'` for any matrix that doesn't match a preset
- No TypeScript errors

---

## Group 4: Auth & Permissions Layer

> Depends on TYPE-1 (types must be defined). Must ship before UI guards.

### AUTH-1: Rewrite `AuthContext` — new fields and `loadProfile` logic

**What**: Add `authUser`, `ownerUid`, `isOwner`, `collaboratorId`, `permissions` to the context; rewrite `loadProfile` to query `collaborators`, call `get_owner_profile` RPC, and set `user.uid = ownerUid` so all existing `user.uid` call sites remain correct.

**Files**:
- `src/AuthContext.tsx` *(modify)*

**Done when**:
- `AuthContextType` exposes: `authUser: { uid: string; email: string } | null`, `ownerUid: string | null`, `isOwner: boolean`, `collaboratorId: string | null`, `permissions: PermissionMatrix`
- `loadProfile` queries `collaborators WHERE user_uid = session.user.id AND revoked_at IS NULL` first
- If collaborator row found: loads owner profile via `get_owner_profile()` RPC, sets `ownerUid = collaborator.owner_uid`, `isOwner = false`, `permissions = collaborator.permissions`, `collaboratorId = collaborator.id`, `user.uid = ownerUid`
- If no collaborator row: loads own profile via `get_owner_profile()`, sets `isOwner = true`, `permissions = ALL_TRUE_PERMISSIONS`, `collaboratorId = null`
- `authUser` is set to `{ uid: session.user.id, email: session.user.email }` — the literal logged-in identity
- `user` (the `UserProfile`) continues to have `uid = ownerUid` so existing `db.list('products', user.uid)` call sites need no changes
- Owner flow (no collaborator row) behavior is identical to current behavior — sign in, products load, no errors

---

### AUTH-2: Create `usePermission` hook

**What**: Create `src/hooks/usePermission.ts` — a single-line hook that reads `permissions[module]?.[action]` from `AuthContext` synchronously.

**Files**:
- `src/hooks/usePermission.ts` *(create)*

**Done when**:
- `usePermission('stock', 'read')` returns `true` for an owner and the correct boolean for a collaborator without triggering any network call
- TypeScript signature: `(module: ModuleKey, action: ActionKey) => boolean`

---

### AUTH-3: Create `<RequirePermission>` component

**What**: Create `src/components/RequirePermission.tsx` — a route-level guard that renders `<Navigate to="/" replace>` and fires a "Sin acceso a este módulo" toast when the user lacks the required permission.

**Files**:
- `src/components/RequirePermission.tsx` *(create)*

**Done when**:
- Component accepts props: `module: ModuleKey`, `action?: ActionKey` (defaults to `'read'`), `children: ReactNode`, `redirectTo?: string` (defaults to `'/'`)
- When `permissions[module][action]` is `false` and `loading` is `false`, renders `<Navigate to={redirectTo} replace>` and shows a toast with text `"Sin acceso a este módulo"`
- When `loading` is `true`, renders `null` (avoids flash before auth resolves)
- No TypeScript errors

---

## Group 5: Route Guards in App.tsx

> Depends on AUTH-3 (`<RequirePermission>` must exist).

### ROUTE-1: Wrap all module routes with `<RequirePermission>`

**What**: In `src/App.tsx`, wrap every protected page route (except `/` and `/calculadora`) with `<RequirePermission module="..." action="read">` using the correct module key per the spec §FR-9.

**Files**:
- `src/App.tsx` *(modify)*

**Routes to wrap** (module key in parentheses):
- `/stock` → `stock`
- `/ventas` → `ventas`
- `/caja` → `caja`
- `/ingresos` → `ingresos`
- `/pedidos` → `pedidos`
- `/presupuestos` → `presupuestos`
- `/clientes` → `clientes`
- `/proveedores` → `proveedores`
- `/config` → `config`

**Done when**:
- Each listed route's `element` prop wraps the page component inside `<RequirePermission module="..." action="read">` with the correct key
- `/` (dashboard) and `/calculadora` are NOT wrapped — always accessible
- TypeScript compilation passes
- An owner navigating to any route reaches the page as before (all permissions true)

---

## Group 6: Sidebar Navigation Guard

> Depends on AUTH-1 (permissions must be in context) and TYPE-1.

### NAV-1: Filter sidebar nav items by `read` permission

**What**: In `src/components/Layout.tsx`, convert the static `navItems` const to a typed `NAV_ITEMS` array with a `module: ModuleKey | null` field, then filter it at render time to hide items where `permissions[module].read === false`.

**Files**:
- `src/components/Layout.tsx` *(modify)*

**Done when**:
- Each nav item has a `module` field (`null` for Inicio and Calculadora)
- The rendered nav only includes items where `module === null` OR `permissions[module]?.read === true`
- All three existing nav iterations (desktop list, mobile menu, any `slice`) consume the filtered variable
- An owner sees all items; a viewer-preset collaborator sees all items except those with `read: false` in viewer preset (`config`, none others for viewer — but custom scenarios vary)
- No TypeScript errors

---

## Group 7: Page-Level Action Button Guards

> Depends on AUTH-2 (`usePermission` hook). These tasks can run in parallel with each other.

### PAGE-1: Stock page — disable write/delete buttons

**What**: In `src/pages/Stock.tsx` (or equivalent), use `usePermission` to disable the "+ Nuevo producto", "Editar", and "Eliminar" buttons when `stock.write` or `stock.delete` is `false`. Disabled buttons must have a `title="Sin permiso"` tooltip.

**Files**:
- `src/pages/Stock.tsx` *(modify)* — add `usePermission` calls; set `disabled` and `title` props on action buttons

**Done when**:
- `const canWrite = usePermission('stock', 'write')` and `const canDelete = usePermission('stock', 'delete')` are declared
- "+ Nuevo producto", "Editar" buttons are `disabled={!canWrite}` with `title="Sin permiso"` when disabled
- "Eliminar" button is `disabled={!canDelete}` with `title="Sin permiso"` when disabled
- Owner (all true) sees all buttons enabled; viewer-preset collaborator sees all buttons disabled

---

### PAGE-2: Sales / Ventas page — disable write/delete buttons

**What**: In `src/pages/Sales.tsx` (or `Ventas.tsx`), guard write and delete actions with `usePermission('ventas', 'write')` and `usePermission('ventas', 'delete')`.

**Files**:
- `src/pages/Sales.tsx` or `src/pages/Ventas.tsx` *(modify)*

**Done when**:
- New sale / edit sale buttons are disabled with tooltip when `ventas.write === false`
- Delete sale button is disabled with tooltip when `ventas.delete === false`

---

### PAGE-3: Cash Flow / Caja page — disable write buttons

**What**: In the Caja page, guard write actions with `usePermission('caja', 'write')`.

**Files**:
- `src/pages/CashFlow.tsx` or equivalent *(modify)*

**Done when**:
- Add movement / create entry buttons are disabled with tooltip when `caja.write === false`

---

### PAGE-4: Ingresos page — disable write buttons

**What**: In the Ingresos page, guard write actions with `usePermission('ingresos', 'write')`.

**Files**:
- `src/pages/Ingresos.tsx` or equivalent *(modify)*

**Done when**:
- Add intake buttons are disabled with tooltip when `ingresos.write === false`

---

### PAGE-5: Pedidos page — disable write/delete buttons

**What**: In the Pedidos page, guard write and delete actions with the `pedidos` module.

**Files**:
- `src/pages/Pedidos.tsx` or equivalent *(modify)*

**Done when**:
- New order / edit buttons disabled when `pedidos.write === false`
- Delete button disabled when `pedidos.delete === false`

---

### PAGE-6: Presupuestos page — disable write/delete buttons

**What**: In the Presupuestos page, guard write and delete actions with the `presupuestos` module.

**Files**:
- `src/pages/Presupuestos.tsx` or equivalent *(modify)*

**Done when**:
- New quote / edit buttons disabled when `presupuestos.write === false`
- Delete button disabled when `presupuestos.delete === false`

---

### PAGE-7: Clientes page — disable write/delete buttons

**What**: In the Clientes page, guard write and delete actions with the `clientes` module.

**Files**:
- `src/pages/Clientes.tsx` or equivalent *(modify)*

**Done when**:
- New client / edit buttons disabled when `clientes.write === false`
- Delete button disabled when `clientes.delete === false`

---

### PAGE-8: Proveedores page — disable write/delete buttons

**What**: In the Proveedores page, guard write and delete actions with the `proveedores` module.

**Files**:
- `src/pages/Proveedores.tsx` or equivalent *(modify)*

**Done when**:
- New supplier / edit buttons disabled when `proveedores.write === false`
- Delete button disabled when `proveedores.delete === false`

---

## Group 8: Storage Path Fix

> Depends on AUTH-1 (`ownerUid` must be available in context). Should be verified before EF-1 ship.

### STORE-1: Use `ownerUid` as storage path prefix for product images

**What**: Find all places that construct the storage upload path for product images and replace any `user.id` / `authUser.uid` reference with `ownerUid`, so images are always stored under the owner's folder.

**Files**:
- `src/pages/Stock.tsx` or whichever file contains the image upload call *(modify)*
- Any other file that calls `supabase.storage.from('assets').upload(...)` with a user-scoped path *(modify if found)*

**Done when**:
- Upload path is constructed as `${ownerUid}/products/...` (using `ownerUid` from `useAuth()`)
- A collaborator with `stock.write = true` successfully uploads an image that lands in the owner's folder
- The image URL stored in the product row is consistent with the owner's path prefix

---

## Group 9: Team Management UI

> Depends on AUTH-1 (isOwner), TYPE-1 (types), DB-3 (RPCs must exist), EF-1 (Edge Function). All sub-tasks within this group can start once those deps are met; UI-T1 through UI-T5 build on each other sequentially.

### UI-T1: Create `useTeam` hook

**What**: Create `src/hooks/useTeam.ts` — fetches collaborators and invitations via `list_collaborators` and `list_invitations` RPCs, exposes `{ collaborators, invitations, loading, refetch }`.

**Files**:
- `src/hooks/useTeam.ts` *(create)*

**Done when**:
- Both RPCs are called in parallel with `Promise.all`
- Results are mapped through `fromDb<Collaborator>` and `fromDb<Invitation>`
- `refetch()` re-runs both RPCs and updates state
- TypeScript compiles cleanly; no `any` types

---

### UI-T2: Create `PermissionsEditor` component

**What**: Create `src/components/team/PermissionsEditor.tsx` — a 9×3 toggle grid that renders all `ModuleKey` rows with `read`, `write`, `delete` checkbox/toggle columns and fires `onChange(newMatrix: PermissionMatrix)`.

**Files**:
- `src/components/team/PermissionsEditor.tsx` *(create)*

**Done when**:
- Renders all 9 module rows with their 3 action columns
- Each toggle calls `onChange` with an updated matrix (immutable — no mutation)
- Works as a controlled component: `value: PermissionMatrix` + `onChange` props
- No TypeScript errors

---

### UI-T3: Create `InviteForm` component

**What**: Create `src/components/team/InviteForm.tsx` — a form/modal with email input, role preset selector, `PermissionsEditor` (auto-populated from preset, overridable), and submit button that calls `inviteCollaborator`.

**Files**:
- `src/components/team/InviteForm.tsx` *(create)*
- `src/lib/inviteCollaborator.ts` *(create)* — the `fetch` wrapper that POSTs to the Edge Function with the user's JWT (per design §11.3)

**Done when**:
- Email field validates format on submit (non-empty, contains `@`)
- Selecting a preset fills the permissions matrix via `ROLE_PRESETS[preset]`
- Modifying any toggle after preset selection sets `role_preset` to `'custom'`
- Submit calls `inviteCollaborator({ email, permissions, role_preset })`
- On success: calls `onSuccess()` (prop), closes the modal, shows toast "Invitación enviada a {email}"
- On failure: shows toast with the error message from the response; form stays open

---

### UI-T4: Create `CollaboratorRow` component

**What**: Create `src/components/team/CollaboratorRow.tsx` — a table row that displays collaborator/invitation info and renders the correct action buttons (Edit permissions / Revoke / Resend).

**Files**:
- `src/components/team/CollaboratorRow.tsx` *(create)*

**Done when**:
- Shows: email, `ROLE_PRESET_LABELS[rolePreset]`, status (active / pending / revoked)
- Active collaborator: "Editar permisos" opens `PermissionsEditor` modal; on save calls `update_collaborator_permissions` RPC → toast → `refetch()`
- Active collaborator: "Revocar" shows confirmation dialog → calls `revoke_collaborator` RPC → toast → `refetch()`
- Pending invitation (no `acceptedAt`): "Revocar" calls `revoke_invitation` RPC
- Pending invitation: "Reenviar" calls `inviteCollaborator` with the same args → toast on success/error

---

### UI-T5: Create `TeamTab` and wire into Settings

**What**: Create `src/components/team/TeamTab.tsx` as the top-level Equipo tab content (lists collaborators + invitations via `useTeam`, "Invitar colaborador" button). Add the tab to `src/pages/Settings.tsx` behind an `isOwner` guard.

**Files**:
- `src/components/team/TeamTab.tsx` *(create)*
- `src/pages/Settings.tsx` *(modify)* — add "Equipo" tab, render only when `isOwner === true`

**Done when**:
- "Equipo" tab is visible in Configuración only when `isOwner === true`; collaborators navigating to `/config` see no Equipo tab
- Tab renders a loading state, then a list of `CollaboratorRow` entries
- Pending invitations appear in the list
- "Invitar colaborador" button opens `InviteForm`; success closes form and calls `refetch()`
- Route `/config` with `isOwner === false` redirects to `/` (handled by the `config` `<RequirePermission>` wrapper; the Equipo subtab relies on the `isOwner` conditional render inside Settings)

---

## Group 10: Final Integration Verification

> Depends on all previous groups being complete. Sequential — do after everything else.

### INT-1: Smoke-test all acceptance scenarios against local Supabase

**What**: Manually walk through all 10 acceptance scenarios (SC-1 through SC-10 in spec) against the local Supabase stack and confirm each passes. Document any failures as follow-up issues.

**Files**: No file changes — verification step only.

**Done when**:
- SC-1 (invite flow): invitation sent, row created, toast shown
- SC-2 (accept magic link): collaborator row materialized, AuthContext loads owner's profile
- SC-3 (read-only stock): buttons disabled with tooltip; direct RPC call rejected
- SC-4 (no caja.read): redirect to `/`, toast shown, sidebar item hidden
- SC-5 (ventas.write blocked at RPC): RPC raises exception, no DB insert
- SC-6 (revocation): `revoked_at` set; next request fails RLS
- SC-7 (stale permissions): owner update immediate in DB; collaborator UI stale until reload; write RPC rejects immediately
- SC-8 (two collaborators — UNIQUE fix): both accounts created without constraint error
- SC-9 (existing owner flow): all features work identically to pre-change behavior
- SC-10 (image upload): upload stored under `ownerUid` folder path

---

### INT-2: Verify RPC prologue pattern — zero legacy `v_uid := auth.uid()` in 0020

**What**: Run the grep verification rule from design §3.3 to confirm no RPC in `0020` was missed.

**Files**: Read-only verification.

**Done when**:
- `rg -n "v_uid\s+uuid\s+:=\s+auth\.uid\(\)" supabase/migrations/0020_extend_rls_and_rpcs.sql` returns zero matches
- If any match is found, the corresponding RPC must be corrected before the PR is opened

---

## Execution Order (Dependency Graph)

```
DB-1 ──► DB-2 ──► DB-3 ──────────────────────────────────────────────────►┐
                    │                                                         │
                    ├──► EF-1                                                 │
                    │                                                         │
TYPE-1 ──► TYPE-2                                                            │
    │                                                                         │
    └──► AUTH-1 ──► AUTH-2 ──► AUTH-3 ──► ROUTE-1                          │
              │                     │                                         │
              └──────────────────── ├──► NAV-1                              │
                                    │                                         │
                                    └──► PAGE-1..8 (parallel)               │
                                    │                                         │
                                    └──► STORE-1                             │
                                                                              │
              AUTH-1 + DB-3 + EF-1 ──► UI-T1 ──► UI-T2 ──► UI-T3 ──►      │
                                             UI-T4 ──► UI-T5 ──────────────►┤
                                                                              │
                                                                         INT-1 ──► INT-2
```

**Parallel opportunities**:
- TYPE-1 and TYPE-2 can start immediately (no DB dependency)
- DB-1, DB-2, DB-3 are strictly sequential (each migration depends on the previous)
- EF-1 can start once DB-2 is applied (needs `invitations` table)
- AUTH-1 can start once TYPE-1 is done (code-only, testable against local DB with DB-2 applied)
- PAGE-1 through PAGE-8 are all independent of each other — run in parallel
- STORE-1 is independent of the page guards

**Critical path**: DB-1 → DB-2 → DB-3 → (AUTH-1 + EF-1) → AUTH-2 → AUTH-3 → ROUTE-1 → INT-1

---

## Task Count Summary

| Group | Tasks | Sequential | Parallel |
|-------|-------|------------|---------|
| DB Migrations | 3 (DB-1..3) | Sequential | — |
| Edge Function | 1 (EF-1) | After DB-2 | With DB-3 |
| Type System | 2 (TYPE-1..2) | TYPE-1 first | With DB-1 |
| Auth Layer | 3 (AUTH-1..3) | Sequential | — |
| Route Guards | 1 (ROUTE-1) | After AUTH-3 | — |
| Nav Guard | 1 (NAV-1) | After AUTH-1 | With ROUTE-1 |
| Page Guards | 8 (PAGE-1..8) | After AUTH-2 | All parallel |
| Storage | 1 (STORE-1) | After AUTH-1 | With page guards |
| Team UI | 5 (UI-T1..5) | Sequential | — |
| Integration | 2 (INT-1..2) | After all | — |
| **Total** | **27** | | |
