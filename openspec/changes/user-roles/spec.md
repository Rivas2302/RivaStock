# Spec — user-roles

**Change ID**: `user-roles`
**Status**: Spec
**Date**: 2026-05-23
**Derived from**: proposal.md

---

## Functional Requirements

### FR-1: Collaborator Table

1. A table `invitations` must exist in the public schema with columns: `id uuid pk`, `owner_uid uuid not null references auth.users(id) on delete cascade`, `email text not null`, `permissions jsonb not null`, `role_preset text nullable`, `invited_at timestamptz not null default now()`, `accepted_at timestamptz nullable`, `revoked_at timestamptz nullable`.
2. `invitations` must have a UNIQUE constraint on `(owner_uid, email)` — one pending invite per email per owner.
3. A table `collaborators` must exist in the public schema with columns: `id uuid pk`, `owner_uid uuid not null references auth.users(id) on delete cascade`, `user_uid uuid not null references auth.users(id) on delete cascade`, `email text not null`, `permissions jsonb not null`, `role_preset text nullable`, `invitation_id uuid nullable references invitations(id)`, `created_at timestamptz not null default now()`, `revoked_at timestamptz nullable`.
4. `collaborators` must have a UNIQUE constraint on `(owner_uid, user_uid)` — a user can be a collaborator of the same owner at most once.
5. `collaborators` must have an index on `user_uid where revoked_at is null`.
6. `collaborators` must have an index on `owner_uid where revoked_at is null`.
7. Revocation is represented by setting `revoked_at` to a non-null timestamp. Hard deletes are not used.
8. The `handle_new_user` trigger must be extended: when a new auth user is created whose email matches a pending, non-revoked `invitations` row, skip creating a `profiles` row for that user (or mark a created profile with `is_collaborator = true`); instead, proceed to materialize the `collaborators` row (see FR-4).

### FR-2: Owner Resolution

1. A PL/pgSQL function `get_owner_uid(v_uid uuid) returns uuid` must exist in the public schema.
2. The function must be `STABLE`, `SECURITY DEFINER`, with `search_path = public`.
3. Behavior: if `v_uid` matches a row in `collaborators` where `revoked_at is null`, return that row's `owner_uid`. Otherwise return `v_uid` itself.
4. The function must use `coalesce(..., v_uid)` so an owner always resolves to themselves without an extra branch.
5. All existing RPCs must call `get_owner_uid(auth.uid())` to resolve the effective owner UID. No RPC may hardcode `auth.uid()` as a write target after this change.
6. A second function `has_permission(v_uid uuid, v_module text, v_action text) returns boolean` must exist.
7. `has_permission` must be `STABLE`, `SECURITY DEFINER`, with `search_path = public`.
8. Behavior: if `v_uid` has no active row in `collaborators` (i.e., they are an owner), return `true`. Otherwise, return `(permissions -> v_module ->> v_action)::boolean`, defaulting to `false` if the key is missing or null.

### FR-3: Permission Model

1. The `permissions` column on both `invitations` and `collaborators` must store a JSONB document conforming to the `PermissionMatrix` shape.
2. The canonical module keys are: `stock`, `ventas`, `caja`, `ingresos`, `pedidos`, `presupuestos`, `clientes`, `proveedores`, `config`.
3. Each module key maps to an object with boolean fields: `read`, `write`, `delete`. All three fields are required for each module.
4. A TypeScript type `PermissionMatrix` must be the single source of truth for module and action keys. It must enforce all 9 modules and the `read | write | delete` action set per module.
5. The JSONB must be validated at write time inside the RPC / Edge Function using a Zod schema that mirrors `PermissionMatrix`. An invalid permissions document must be rejected with an error before any DB write.
6. Owner users (those without a `collaborators` row) are treated as having all permissions set to `true` for every module and action. This is enforced in-memory in `AuthContext`; no DB row is written for owner permissions.

### FR-4: Invitation Flow

1. A Supabase Edge Function named `invite-collaborator` must exist and be deployed.
2. The Edge Function must:
   a. Verify the caller is authenticated (valid JWT).
   b. Verify the caller is an owner — i.e., has no active row in `collaborators` with their own `user_uid`. A collaborator must not be able to invite others.
   c. Accept input: `{ email: string, permissions: PermissionMatrix, role_preset?: string }`.
   d. Validate `email` format and `permissions` shape (Zod).
   e. Call `supabase.auth.admin.inviteUserByEmail(email, { redirectTo })` using the `service_role` key.
   f. Upsert an `invitations` row: `(owner_uid, email, permissions, role_preset)`. If a previous invite for the same `(owner_uid, email)` exists (even if previously revoked), update it and clear `revoked_at` and `accepted_at`.
   g. Return `{ invitation_id: string, status: 'sent' }` on success.
   h. Return a structured error with a user-readable message on failure.
3. The Edge Function must surface invitation send errors (e.g., SMTP failure, duplicate email in Supabase Auth) as a non-2xx response with a JSON error body.
4. A Postgres trigger (extension of or addition to `handle_new_user`) must fire on `INSERT` into `auth.users`. When the new user's email matches a pending `invitations` row (`accepted_at is null AND revoked_at is null`), it must:
   a. Insert a row into `collaborators` with `owner_uid`, `user_uid = NEW.id`, `email`, `permissions`, `role_preset`, and `invitation_id` from the matching invitation.
   b. Set `invitations.accepted_at = now()` on the matched row.
   c. Skip profile creation for the new user (or mark them `is_collaborator = true`).
5. If no matching invitation is found, the trigger proceeds with the existing `handle_new_user` behavior (create a normal profile).
6. The trigger-based materialization must be idempotent: if a `collaborators` row already exists for `(owner_uid, user_uid)`, the trigger must not insert a duplicate.

### FR-5: AuthContext Changes

1. `AuthContext` must expose the following additional fields (on top of existing `user` and `profile`):
   - `ownerUid: string | null` — the UID of the data owner (own UID for owners, the owner's UID for collaborators).
   - `isOwner: boolean` — `true` when `ownerUid === user.id`.
   - `collaboratorId: string | null` — `collaborators.id` when `isOwner === false`, otherwise `null`.
   - `permissions: PermissionMatrix` — full permission matrix; all values `true` for owners.
2. On `signIn` and on session restore, after obtaining the authenticated user, the context must:
   a. Query `select * from collaborators where user_uid = auth.uid() and revoked_at is null limit 1`.
   b. If a row is found: load the owner's profile (`select * from profiles where id = collaborator.owner_uid`), set `ownerUid = collaborator.owner_uid`, `isOwner = false`, `permissions = collaborator.permissions`, `collaboratorId = collaborator.id`.
   c. If no row is found: load the user's own profile, set `ownerUid = user.id`, `isOwner = true`, `permissions = ALL_TRUE_MATRIX`, `collaboratorId = null`.
3. For collaborators, `profile` in the context must be the **owner's** profile (name, business name, plan, etc.), not the collaborator's own (empty) profile.
4. All call sites in `db.ts` and the rest of the app that currently pass `auth.user.id` as the owner must be updated to pass `auth.ownerUid` instead.
5. Permissions are loaded once at login. Mid-session permission changes by the owner take effect only on the collaborator's next login or page reload. This is accepted behavior for v1.

### FR-6: RLS Extension

1. The SELECT policy on all 12 user-scoped tables must be extended to allow collaborators of the owner to read that owner's rows.
2. The extended SELECT policy condition must be:
   ```sql
   user_id = auth.uid()
   OR exists (
     select 1 from collaborators
     where user_uid = auth.uid()
       and owner_uid = user_id
       and revoked_at is null
   )
   ```
3. The 12 tables subject to this change are (at minimum): `products` (or `productos`), `sales` (or `ventas`), `caja` / cash register related tables, `ingresos`, `pedidos`, `presupuestos`, `clientes`, `proveedores`, `profiles`, and any other table with a `user_id = auth.uid()` SELECT policy. The implementation phase must enumerate all 12 by grepping migrations.
4. INSERT / UPDATE / DELETE RLS policies on those tables must NOT be extended for collaborators. Write enforcement is at the RPC layer exclusively.
5. RLS on `collaborators` itself: owners can SELECT their own collaborators (`owner_uid = auth.uid()`). Collaborators can SELECT their own row (`user_uid = auth.uid()`). No collaborator can INSERT/UPDATE/DELETE collaborator rows directly.
6. RLS on `invitations`: owners can SELECT invitations they created (`owner_uid = auth.uid()`). No direct INSERT/UPDATE/DELETE from the client (managed via Edge Function and trigger only).

### FR-7: RPC Updates

1. Every existing RPC that uses `auth.uid()` as a write target (insert `user_id`, update `where user_id = ...`, delete `where user_id = ...`) must be updated to use `get_owner_uid(auth.uid())` in place of `auth.uid()`.
2. Every write RPC must call `has_permission(auth.uid(), '<module>', '<action>')` before performing the write. If it returns `false`, the RPC must raise an exception with a clear error code (e.g., `SQLSTATE '42501'` or a custom code) and message (e.g., `'permission denied: <module>.<action>'`).
3. READ RPCs (those that only SELECT) do not require a `has_permission` check; the extended RLS SELECT policy is sufficient.
4. The implementation phase must audit all RPCs in the migrations folder and produce a complete list of affected functions before writing any migration.
5. Future RPCs must follow the same pattern: `get_owner_uid(auth.uid())` for data scoping and `has_permission(auth.uid(), module, action)` for write authorization. This must be documented in the design artifact.

### FR-8: Storage Policy

1. The Supabase Storage bucket policy for product images must be extended to allow uploads by collaborators.
2. The upload policy condition must be updated to: the path prefix matches `get_owner_uid(auth.uid())` instead of (or in addition to) `auth.uid()`.
3. The same `get_owner_uid` function used for RLS must be reused here — no duplication.
4. Download (read) policies must similarly allow access when the path prefix equals `get_owner_uid(auth.uid())`.
5. The collaborator's upload is stored under the **owner's** folder, not the collaborator's own folder. File paths must never use the collaborator's `user.id` as a prefix.

### FR-9: UI Permission Guards

1. A React hook `usePermission(module: ModuleKey, action: 'read' | 'write' | 'delete'): boolean` must exist. It must read from `AuthContext.permissions` synchronously with no network call.
2. A component `<RequirePermission module={ModuleKey} action={ActionKey}>` must exist. It wraps a route or component subtree. If the user lacks the permission, it redirects to `/` and shows a toast with text "Sin acceso a este módulo".
3. Every route in the React Router v6 config that corresponds to a module must be wrapped with `<RequirePermission module="<key>" action="read">`.
4. Sidebar navigation items must be hidden (not merely disabled) when the corresponding module's `read` permission is `false`.
5. Action buttons within pages (`+ Nuevo`, `Editar`, `Eliminar`, and equivalents) must use `usePermission` to disable themselves when the required action (`write` or `delete`) is `false`. Disabled buttons must show a tooltip with text "Sin permiso".
6. Permission guards are client-side UX only — they do NOT replace the RPC-level `has_permission` check. Both must be present.

### FR-10: Team Management UI

1. A new settings tab "Equipo" must exist under Configuración (`/configuracion` or equivalent), accessible only to owners (`isOwner === true`). Collaborators must not see this tab.
2. The tab must list all collaborators for the owner with at minimum: email, role preset label, active/revoked status, and a last-active indicator (if feasible from existing data).
3. The tab must include an "Invitar colaborador" action that opens a form/modal with:
   a. Email field (required, validated format).
   b. Role preset selector: "admin", "employee", "viewer", or "custom".
   c. When a preset is selected, the permissions form auto-populates with the preset values (see FR-12).
   d. A permissions matrix toggle UI showing all 9 modules × 3 actions. The owner can override any individual toggle regardless of preset.
   e. A submit button that calls the `invite-collaborator` Edge Function.
   f. On success: toast "Invitación enviada a {email}". The collaborator list updates to show the pending invitation.
   g. On error: toast with the error message returned by the Edge Function.
4. Each active collaborator row must have an "Editar permisos" action. Opening it loads the current permissions into the same matrix toggle UI and saves via an RPC (not the Edge Function). The RPC must validate the caller is the owner.
5. Each active or pending collaborator row must have a "Revocar" action. Revoking sets `collaborators.revoked_at = now()` (for active) or `invitations.revoked_at = now()` (for pending). After revocation the collaborator's next request will fail RLS/RPC checks. No immediate session termination is required for v1.
6. A "Reenviar invitación" button must exist for collaborators whose `invitations.accepted_at is null`. It re-calls the Edge Function with the same email and permissions.
7. The team page must not be reachable by a collaborator user: if `isOwner === false`, navigating to the route redirects to `/`.

### FR-11: UNIQUE Constraint Fix

1. The existing plain UNIQUE constraint on `profiles.business_name_lower` must be dropped.
2. A partial unique index must be created in its place:
   ```sql
   create unique index profiles_business_name_lower_unique
     on profiles (business_name_lower)
    where business_name_lower <> '';
   ```
3. This migration must run **before** any migration that creates `collaborators`, `invitations`, or modifies `handle_new_user`.
4. The index must allow multiple rows with `business_name_lower = ''` (i.e., collaborators and new empty-profile users must not conflict).
5. The old constraint drop and new index creation must be in the same migration transaction.

### FR-12: Role Presets

1. Three client-side role presets must be defined as TypeScript constants (not stored in the DB):
   - **admin**: all modules, all actions (`read: true, write: true, delete: true`) except `config` which is `{ read: true, write: true, delete: false }`.
   - **employee**: `stock: {read:true, write:true, delete:false}`, `ventas: {read:true, write:true, delete:false}`, `caja: {read:true, write:true, delete:false}`, `ingresos: {read:false, write:false, delete:false}`, `pedidos: {read:true, write:true, delete:false}`, `presupuestos: {read:true, write:true, delete:false}`, `clientes: {read:true, write:true, delete:false}`, `proveedores: {read:false, write:false, delete:false}`, `config: {read:false, write:false, delete:false}`.
   - **viewer**: all modules `read: true`, all `write: false`, all `delete: false`.
2. Selecting a preset populates the permissions form but does NOT lock individual toggles — the owner may override any field.
3. If the owner modifies any toggle after selecting a preset, the `role_preset` value stored is `'custom'`.
4. The preset definitions are the authoritative defaults. The DB stores the resulting JSONB (not the preset name as behavior logic) — the preset name in `role_preset` is informational only.

---

## Non-Functional Requirements

### NFR-1: Backward Compatibility
All existing owner-only flows (sign up, sign in, product management, sales, caja, suppliers, etc.) must work identically after this change. The `get_owner_uid` function returns `v_uid` unchanged for users without a `collaborators` row, so no behavioral difference for owners.

### NFR-2: Performance
The `has_permission` and `get_owner_uid` functions are `STABLE SECURITY DEFINER`. They must each execute a single indexed lookup (by `user_uid` with the partial index on `revoked_at is null`). No RPC may call these functions in a loop per row.

### NFR-3: Security
- The `service_role` key must only exist in the Edge Function environment. It must never be exposed to the client.
- All write RPCs must enforce `has_permission` server-side. Client-side guards are UX only.
- A collaborator must not be able to escalate their own permissions. Permission writes go through a dedicated RPC that verifies `auth.uid() = owner_uid`.
- Revoked collaborators (`revoked_at is not null`) must be treated as unauthorized by both RLS and `has_permission` immediately (next request, no cache).

### NFR-4: Stale Permission Acceptance (v1)
Mid-session permission changes by the owner are not propagated in real-time. The RPC rejects unauthorized writes immediately (correct behavior). The UI only reflects the change after the collaborator's next login or reload. This is explicitly accepted for v1.

### NFR-5: Single Business Context (v1)
A user is either an owner or a collaborator of exactly one other owner. A user cannot simultaneously be an owner of their own business AND a collaborator of another business. This constraint is not enforced at the DB level but is the intended use model.

---

## Acceptance Scenarios

### SC-1: Owner invites a collaborator

**Given** a logged-in owner with `isOwner === true`
**When** they navigate to Configuración → Equipo, click "Invitar colaborador", enter a valid email, select the "employee" preset, and submit
**Then**
- The `invite-collaborator` Edge Function is called with the owner's JWT
- An `invitations` row is created with `owner_uid = owner.id`, `email = entered_email`, `permissions = employee preset`, `role_preset = 'employee'`
- The invitee receives a magic-link email from Supabase Auth
- A success toast "Invitación enviada a {email}" appears in the UI
- The collaborator list in the Equipo tab shows the pending invite for that email

### SC-2: Invitee accepts the magic link and logs in

**Given** a pending `invitations` row for email `bob@example.com` with `owner_uid = alice.id`
**When** Bob clicks the magic link, completes sign-in, and the `handle_new_user` trigger fires
**Then**
- A `collaborators` row is created: `owner_uid = alice.id`, `user_uid = bob.id`, `email = bob@example.com`, `permissions = invitation.permissions`
- `invitations.accepted_at` is set to the current timestamp
- No `profiles` row is created for Bob (or it is marked `is_collaborator = true`)
- Bob's `AuthContext` resolves: `ownerUid = alice.id`, `isOwner = false`, `collaboratorId = collaborators.id`
- Bob's `profile` in context is Alice's profile (business name, plan, etc.)
- Bob lands at `/` and sees Alice's products, sales, and other data

### SC-3: Collaborator with read-only stock access tries to add a product

**Given** a logged-in collaborator Bob with `permissions.stock = { read: true, write: false, delete: false }`
**When** Bob navigates to the stock/products page
**Then**
- The page loads successfully and Bob sees the owner's product list (RLS SELECT allows it)
- The "+ Nuevo producto" button is disabled and shows a "Sin permiso" tooltip
- The "Editar" button on each product row is disabled with the same tooltip
- If Bob calls the `create_product` (or equivalent) RPC directly, it returns a permission denied error

### SC-4: Collaborator without caja.read access navigates to /caja

**Given** a logged-in collaborator with `permissions.caja = { read: false, write: false, delete: false }`
**When** the collaborator navigates to `/caja` (or its equivalent route)
**Then**
- `<RequirePermission module="caja" action="read">` intercepts the navigation
- The user is redirected to `/`
- A toast "Sin acceso a este módulo" appears
- The "Caja" entry is absent from the sidebar navigation

### SC-5: Collaborator write blocked at RPC level

**Given** a logged-in collaborator with `permissions.ventas.write = false`
**When** the collaborator calls the `create_venta` (or equivalent) RPC directly (bypassing the UI)
**Then**
- `has_permission(auth.uid(), 'ventas', 'write')` returns `false`
- The RPC raises an exception (SQLSTATE 42501 or custom code)
- No row is inserted into the ventas/sales table
- The response to the client contains a structured error message including `'ventas.write'`

### SC-6: Owner revokes a collaborator

**Given** an active collaborator Bob (`collaborators.revoked_at is null`) logged into the app
**When** Alice (the owner) navigates to Configuración → Equipo, finds Bob, and clicks "Revocar"
**Then**
- `collaborators.revoked_at` is set to the current timestamp for Bob's row
- On Bob's next API request (SELECT, RPC, or storage), the RLS policy or `has_permission` check finds no active `collaborators` row and returns unauthorized / empty result
- Bob's in-progress session may continue until next request (no real-time push)
- `get_owner_uid(bob.uid)` now returns `bob.uid` (no active collaborator row found), so Bob sees his own (empty) data, effectively locking him out

### SC-7: Owner edits collaborator permissions mid-session

**Given** collaborator Bob is actively using the app with `permissions.ingresos.read = true`
**When** Alice updates Bob's permissions to set `ingresos.read = false` via the "Editar permisos" form
**Then**
- The `collaborators.permissions` JSONB is updated in the DB immediately
- Bob's current `AuthContext.permissions` still shows `ingresos.read = true` (loaded at login, not refreshed)
- Bob can still navigate to `/ingresos` in this session (client-side guard uses stale context)
- If Bob calls a write RPC for `ingresos`, `has_permission` reads fresh DB state and returns `false`, blocking the write
- After Bob reloads or re-logs in, `AuthContext` re-fetches from DB and `ingresos.read = false` is enforced on the client too

### SC-8: Two collaborators of the same owner — UNIQUE constraint fix

**Given** the partial unique index on `profiles (business_name_lower) where business_name_lower <> ''` is in place
**When** the `handle_new_user` trigger fires for collaborator Bob (email: `bob@example.com`) and then again for collaborator Carol (email: `carol@example.com`), both invited by Alice
**Then**
- Neither Bob's nor Carol's trigger execution violates a UNIQUE constraint
- Both collaborator auth users are created without error
- Both `collaborators` rows exist for Alice's `owner_uid`
- `profiles` rows for Bob and Carol (if created at all) have `business_name_lower = ''` and do not conflict with each other or with Alice's profile

### SC-9: Existing single-user owner flow unchanged

**Given** a user Alice who has no `collaborators` row (is a plain owner)
**When** Alice signs in and uses any feature (browse products, create a sale, access caja, etc.)
**Then**
- `get_owner_uid(alice.uid)` returns `alice.uid` (coalesce falls through to the uid itself)
- `has_permission(alice.uid, any_module, any_action)` returns `true` (no collaborator row found → owner path)
- `AuthContext` sets `isOwner = true`, `permissions = ALL_TRUE_MATRIX`
- All RPCs complete successfully; no permission errors are raised
- All RLS SELECT policies evaluate `user_id = auth.uid()` as true (first branch); no subquery needed
- The Equipo tab is visible and accessible to Alice

### SC-10: Collaborator uploads a product image

**Given** a logged-in collaborator Bob with `permissions.stock.write = true`
**When** Bob creates or edits a product and uploads an image
**Then**
- The storage client constructs the upload path using `ownerUid` (Alice's UID) as the prefix, not Bob's UID
- The storage bucket policy evaluates `get_owner_uid(auth.uid()) = path_prefix_uid` which resolves to `alice.uid = alice.uid` → `true`
- The upload succeeds and the image is stored under Alice's folder
- The image URL stored in the product row references Alice's folder path (consistent with products created directly by Alice)

---

## Modules and Permission Keys

The following table is the authoritative definition of all module keys and which actions apply. This maps directly to the `PermissionMatrix` TypeScript type and the JSONB shape in the DB.

| Module key      | Description                          | read | write | delete |
|-----------------|--------------------------------------|------|-------|--------|
| `stock`         | Product catalog management           | yes  | yes   | yes    |
| `ventas`        | Sales / transactions                 | yes  | yes   | yes    |
| `caja`          | Cash register / caja chica           | yes  | yes   | yes    |
| `ingresos`      | Revenue / income records             | yes  | yes   | yes    |
| `pedidos`       | Orders / purchase orders             | yes  | yes   | yes    |
| `presupuestos`  | Quotes / budgets                     | yes  | yes   | yes    |
| `clientes`      | Customer management                  | yes  | yes   | yes    |
| `proveedores`   | Supplier management                  | yes  | yes   | yes    |
| `config`        | Business configuration / settings    | yes  | yes   | no     |

"yes" means the action is a valid key in the JSONB for that module. It does NOT mean a collaborator has that permission — permissions are set per collaborator. "no" means `delete` is not a meaningful action for `config` and must be hardcoded to `false` in all presets and the TypeScript type.

### Default Preset Values

| Module key      | admin (r/w/d) | employee (r/w/d) | viewer (r/w/d) |
|-----------------|---------------|------------------|----------------|
| `stock`         | T / T / T     | T / T / F        | T / F / F      |
| `ventas`        | T / T / T     | T / T / F        | T / F / F      |
| `caja`          | T / T / T     | T / T / F        | T / F / F      |
| `ingresos`      | T / T / T     | F / F / F        | T / F / F      |
| `pedidos`       | T / T / T     | T / T / F        | T / F / F      |
| `presupuestos`  | T / T / T     | T / T / F        | T / F / F      |
| `clientes`      | T / T / T     | T / T / F        | T / F / F      |
| `proveedores`   | T / T / T     | F / F / F        | T / F / F      |
| `config`        | T / T / F     | F / F / F        | F / F / F      |

T = `true`, F = `false`.
