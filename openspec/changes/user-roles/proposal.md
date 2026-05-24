# Proposal: User Roles & Collaborators

**Change ID**: `user-roles`
**Status**: Proposed
**Date**: 2026-05-23
**Delivery**: Single PR

---

## 1. Intent

### Problem

RivaStock today is strictly single-user per business: every table in the schema scopes data with `user_id = auth.uid()` and every RPC hardcodes `auth.uid()` as the owner. There is no concept of a "team", no way for a business owner to grant a partner, employee, or accountant access to the same product catalog, sales, cash register, or suppliers.

This blocks real-world adoption: most of the target users (small retail, gastronomy, services) operate with at least one employee at the register, an accountant who needs read-only access to `ingresos`, or a partner who shares stock management. Today the only workaround is to share the owner's password — which destroys audit trail, breaks RLS as a security model, and forces full-trust access where the owner only wants scoped access.

### Why now

1. Several pilot users have explicitly requested multi-user access in the last weeks.
2. The data model is already parameterized via `ownerUid` in `db.ts` — the structural cost is much lower than it appears.
3. Postponing this means accumulating more RLS policies and RPCs that hardcode `auth.uid()`, each one a future migration cost.
4. The existing (broken) `Collaborator` type in `src/types.ts:151` already leaks the intent into the codebase but with the wrong shape — it must either be implemented correctly or removed.

### Success looks like

- An owner can invite a collaborator by email; the collaborator receives a magic link and on first login lands inside the owner's business with the exact permissions the owner granted.
- All read queries (products, sales, cash, suppliers, etc.) return the owner's data regardless of who is logged in (owner or collaborator).
- All write/delete operations are blocked at both UI and RPC level when the logged-in collaborator lacks the permission.
- The owner can edit/revoke a collaborator's permissions at any time and changes take effect on next request.
- Three role presets (admin / employee / viewer) make onboarding fast, but every permission remains independently togglable.

---

## 2. Scope

### In scope

- New tables: `collaborators`, `invitations`.
- New PL/pgSQL helper `get_owner_uid(v_uid uuid) returns uuid` used by every RPC and (where reasonable) RLS policy.
- RLS extension on all 12 user-scoped tables to allow collaborators of the owner to `SELECT`.
- Modification of all existing RPCs to resolve the effective `ownerUid` via the helper instead of `auth.uid()`.
- Fix `profiles.business_name_lower` UNIQUE constraint to be a partial unique index that ignores empty strings.
- AuthContext extension: expose `ownerUid`, `isOwner`, `permissions`, `collaboratorId`.
- New `usePermission(module, action)` hook.
- New `<RequirePermission>` route/component guard.
- UI page: "Equipo / Colaboradores" under Configuración — list, invite, edit permissions, revoke.
- Edge Function `invite-collaborator` that uses `service_role` to call `auth.admin.inviteUserByEmail` and creates the `invitations` row.
- Trigger / handler that on first sign-in of an invited user materializes the `collaborators` row from the pending `invitations` row.
- Storage bucket policy extension so collaborators with `stock.write` can upload product images into the owner's folder.
- Three client-side role presets (admin / employee / viewer) that populate the JSONB permissions on the form.

### Out of scope (see §5)

Per-record permissions, audit logs, ownership transfer, multiple businesses per user, collaborator-to-collaborator invitations, billing/seats, granular field-level permissions, real-time permission revocation push.

---

## 3. Architecture Decisions

### 3.1 DB Schema

**Decision**: Two new tables — `collaborators` (active membership) and `invitations` (pending magic-link state) — separated by lifecycle.

```sql
-- pending invites (pre-acceptance)
create table invitations (
  id           uuid primary key default gen_random_uuid(),
  owner_uid    uuid not null references auth.users(id) on delete cascade,
  email        text not null,
  permissions  jsonb not null,
  role_preset  text,                       -- 'admin'|'employee'|'viewer'|'custom' (informational)
  invited_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  unique (owner_uid, email)                -- one pending invite per email per owner
);

-- active membership (post first sign-in)
create table collaborators (
  id              uuid primary key default gen_random_uuid(),
  owner_uid       uuid not null references auth.users(id) on delete cascade,
  user_uid        uuid not null references auth.users(id) on delete cascade,
  email           text not null,
  permissions     jsonb not null,
  role_preset     text,
  invitation_id   uuid references invitations(id),
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  unique (owner_uid, user_uid)             -- a user can only be a collaborator once per owner
);

create index on collaborators (user_uid) where revoked_at is null;
create index on collaborators (owner_uid) where revoked_at is null;
```

**Rationale**: Splitting `invitations` from `collaborators` keeps lifecycle clean (pending vs active vs revoked), makes the magic-link flow idempotent, and lets the owner re-send / cancel an invite without polluting the active membership table. The `user_uid` is only known after the invited user actually creates the auth account, so it cannot live in `invitations`.

**Helper function** (single source of truth for owner resolution):

```sql
create or replace function get_owner_uid(v_uid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select owner_uid
       from collaborators
      where user_uid = v_uid
        and revoked_at is null
      limit 1),
    v_uid
  );
$$;
```

If the caller is a collaborator → returns their owner's uid. Otherwise → returns the caller's own uid (they are their own owner). This is the **single function** every RPC will call.

### 3.2 RLS Strategy

**Decision**: Extend every existing `using (user_id = auth.uid())` policy to `using (user_id = auth.uid() OR exists (select 1 from collaborators where user_uid = auth.uid() and owner_uid = user_id and revoked_at is null))` **for SELECT only**. Writes are enforced at the **RPC layer**, not via RLS, because per-permission enforcement at the RLS level would require either a function call per row or per-module policy variants.

**Rationale**:

- RLS for SELECT is uniform across all collaborators (read access is implied by being a collaborator at all — finer read scoping was explicitly deferred). One pattern, one migration, low cost.
- Writes are already funneled through RPCs (`db.ts` does not do raw `insert`/`update`/`delete` against most tables; the ones that do — like `productos` — will be audited and either routed through RPCs or have a per-module RLS policy check using `permissions->>'stock'->>'write'` against `collaborators`).
- Doing per-permission enforcement at the RLS level would mean either (a) 12 tables × N modules of policy variants, or (b) a SECURITY DEFINER function called for every row, which kills query planning. RPC-level enforcement is one check per call.

**Helper to check permission inside RPCs**:

```sql
create or replace function has_permission(v_uid uuid, v_module text, v_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from collaborators where user_uid = v_uid and revoked_at is null)
      then true  -- owner has all permissions
    else coalesce(
      (select (permissions -> v_module ->> v_action)::boolean
         from collaborators
        where user_uid = v_uid and revoked_at is null
        limit 1),
      false
    )
  end;
$$;
```

### 3.3 Permissions Model — JSONB vs Normalized

**Decision**: JSONB column on `collaborators.permissions`.

**Shape**:

```json
{
  "stock":       { "read": true, "write": true, "delete": false },
  "ventas":      { "read": true, "write": true, "delete": false },
  "caja":        { "read": true, "write": true, "delete": false },
  "ingresos":    { "read": true, "write": false, "delete": false },
  "pedidos":     { "read": true, "write": true, "delete": false },
  "presupuestos":{ "read": true, "write": true, "delete": false },
  "clientes":    { "read": true, "write": true, "delete": false },
  "proveedores": { "read": true, "write": true, "delete": false },
  "config":      { "read": false,"write": false,"delete": false }
}
```

**Rationale**:

- Permissions are read together (the whole matrix is loaded once on login into AuthContext) and written together (the owner saves the form atomically). Normalization would force a join or a multi-row `select` for what is conceptually one document.
- Adding a new module = adding a key in JSONB and updating the TypeScript type. No migration. With a normalized table we'd need a new row per existing collaborator + a backfill.
- Querying "does user X have stock.write?" is `permissions -> 'stock' ->> 'write'` — supported by GIN if we ever need it (we don't right now; the lookup is by `user_uid` which is already indexed).
- Role presets are **client-side templates** that fill the JSONB — the DB does not know about "admin" as a concept. This keeps the DB dumb and makes presets cheap to add/modify/rename without migrations.

**Tradeoff acknowledged**: no referential integrity on module names. Mitigated by a TypeScript `PermissionMatrix` type that is the single source of truth in the frontend and a Zod schema validating the JSONB on write inside the RPC.

### 3.4 Invitation Flow

**Decision**: Edge Function `invite-collaborator` (deployed to Supabase) that:

1. Validates the caller is authenticated and is the owner (not a collaborator).
2. Validates `email`, `permissions`, `role_preset`.
3. Calls `supabase.auth.admin.inviteUserByEmail(email, { redirectTo })` using the `service_role` key.
4. Inserts the `invitations` row.
5. Returns `{ invitation_id, status }`.

On the invitee side, when they click the magic link and sign in for the first time, a Postgres trigger on `auth.users` (extension of the existing `handle_new_user`) checks `invitations` for `email = NEW.email` and if a pending invite exists, materializes it into `collaborators`.

**Rationale**:

- `inviteUserByEmail` is an admin-only operation; it **requires** `service_role`. That key cannot live on the client. An Edge Function is the standard Supabase pattern for this.
- Doing the materialization in the DB trigger (not in the Edge Function) makes it robust: even if the user delays clicking the link for days, or signs in from a different device, the trigger fires deterministically.
- The Edge Function is small, stateless, and the only "ops" surface introduced by this change.

### 3.5 AuthContext Changes

**Decision**: Extend `AuthContext` to expose:

```ts
{
  user: User | null,
  profile: Profile | null,        // already exists; for collaborators this is the OWNER's profile
  ownerUid: string | null,        // = collaborator.owner_uid OR user.id
  isOwner: boolean,               // = ownerUid === user.id
  collaboratorId: string | null,  // = collaborators.id if isOwner === false, else null
  permissions: PermissionMatrix,  // full matrix; for owners all true
}
```

On `signIn` / session restore, after fetching the `auth.user`, the context does:

1. `select * from collaborators where user_uid = auth.uid() and revoked_at is null limit 1`
2. If a row exists → load the OWNER's profile (`select * from profiles where id = collaborator.owner_uid`), set `ownerUid = collaborator.owner_uid`, `isOwner = false`, `permissions = collaborator.permissions`.
3. If no row → load own profile, `ownerUid = user.id`, `isOwner = true`, `permissions = ALL_TRUE`.

`db.ts` already accepts `ownerUid` as parameter — we just need to pass `auth.ownerUid` instead of `auth.user.id` everywhere it's called.

**Rationale**: Concentrates the "who am I working as" decision in a single place, computed once at login, available everywhere. Avoids scattering `coalesce(collaborator.owner, user)` logic across the app.

### 3.6 Permission Hook

**Decision**: A single `usePermission(module: ModuleKey, action: 'read' | 'write' | 'delete'): boolean` hook backed by `AuthContext.permissions`.

```ts
const canDelete = usePermission('stock', 'delete');
<Button disabled={!canDelete} onClick={onDelete}>Eliminar</Button>
```

**Rationale**: One API, trivially testable, no network call (pulls from context). Components stay declarative. Mirroring the DB shape (`module.action`) keeps frontend and backend mental model identical.

### 3.7 UI Guard Strategy

**Decision**: Two complementary guards.

1. **Route-level**: `<RequirePermission module="caja" action="read">` wraps each route in the router. If the user lacks the permission → redirect to `/` with a toast "Sin acceso a este módulo". Sidebar items use the same hook to hide what the user can't reach.
2. **Action-level**: Inside pages, individual buttons (`+ Nuevo`, `Editar`, `Eliminar`) use `usePermission` to disable themselves and show a tooltip.

**Rationale**: Route guards prevent users from landing on a page that would render empty/broken; action guards prevent the more granular case (read OK, write denied). Defense in depth — neither replaces the RPC check, both improve UX.

---

## 4. Risks & Mitigations

### R1 — `profiles.business_name_lower` UNIQUE constraint will break the 2nd invite

**Risk**: Today the column has a plain UNIQUE constraint. New users (and collaborators created via the trigger) get `business_name_lower = ''` by default. The second collaborator created across the entire system will violate the constraint and the invite flow will fail in production with a cryptic 23505.

**Mitigation**: Drop the existing UNIQUE constraint, replace with a partial unique index: `create unique index profiles_business_name_lower_unique on profiles (business_name_lower) where business_name_lower <> ''`. Migration runs before any collaborator code is enabled. This must be the first migration in the change.

### R2 — RPC owner-resolution blast radius

**Risk**: Every existing RPC hardcodes `auth.uid()`. Missing one means a collaborator's writes silently go to their own (empty) account instead of the owner's data, with no error — extremely hard to detect.

**Mitigation**: (a) Grep the entire migrations folder for `auth.uid()` and produce an exhaustive list during the spec phase. (b) Replace `auth.uid()` with `get_owner_uid(auth.uid())` everywhere the value is used as a write target. (c) Add an integration test per RPC that logs in as a collaborator and asserts the write landed in the owner's row. (d) Document the rule in the design phase so future RPCs follow it.

### R3 — Storage bucket policy for collaborator uploads

**Risk**: Product images are uploaded to a path prefixed by `user.id` and the bucket policy only allows `user.id = auth.uid()`. A collaborator with `stock.write` cannot upload, breaking the new-product flow.

**Mitigation**: Extend the storage policy to allow upload when the path prefix matches `get_owner_uid(auth.uid())` instead of `auth.uid()`. Same pattern as RLS — read and write allowed when the prefix is the owner you belong to. Listed as a specific item in the spec.

### R4 — Edge Function as new operational dependency

**Risk**: The invite flow now depends on a deployed Edge Function. If it's not deployed, or fails, invites silently break. The team hasn't operated Edge Functions before.

**Mitigation**: (a) Keep the function minimal — input validation + one admin call + one insert. (b) Document deployment in the change's README. (c) Surface errors clearly in the UI ("No se pudo enviar la invitación, reintentá"). (d) Add a manual "resend invitation" button in the team page so transient failures are recoverable without DB access.

### R5 — Collaborator sees stale permissions after owner edits

**Risk**: Permissions live in AuthContext, loaded at login. If the owner toggles off `caja.write` while the collaborator is logged in, the collaborator's UI still allows it until next refresh.

**Mitigation**: Acceptable for v1 — the RPC will reject the write (defense in depth) and the user gets an error toast. Real-time push of permission changes is explicitly out of scope. Document this in the spec.

### R6 — `handle_new_user` trigger creates orphan profile for invited users

**Risk**: When an invitee signs in for the first time, the existing `handle_new_user` trigger fires and creates a `profiles` row for them. They don't need one — they consume the owner's profile. This creates dead rows.

**Mitigation**: Extend `handle_new_user` to check `invitations` first. If the new user matches a pending invitation, skip profile creation (or mark the profile as `is_collaborator = true` and never read from it). The AuthContext already routes collaborators to the owner's profile, so this is mainly hygiene.

---

## 5. Out of Scope (explicit)

The following are intentionally excluded and will not be addressed in this change:

- **Per-record permissions** (e.g. "this collaborator can only edit products in category X"). Module-level granularity only.
- **Field-level permissions** (e.g. "can see product name but not cost"). All-or-nothing per module/action.
- **Audit log** of who did what. Future change.
- **Ownership transfer** (owner hands the business to another user). Future change.
- **Multi-business per user** (a user is owner of business A AND collaborator of business B). For v1 a user belongs to exactly one context — either they are an owner or a collaborator of exactly one other owner.
- **Collaborator-to-collaborator invitations**. Only the owner can invite.
- **Billing / seats / limits**. Unlimited collaborators per business.
- **Real-time permission revocation push**. Permissions are refreshed on login; mid-session edits take effect on next reload (RPC still enforces — see R5).
- **Two-factor authentication**, **SSO**, **SCIM**.
- **Soft delete / restore of collaborators** beyond setting `revoked_at`.

---

## 6. Success Criteria

The change is done when:

1. An owner can navigate to **Configuración → Equipo**, click "Invitar colaborador", enter an email, pick a preset or customize permissions, and submit. The invitee receives a magic-link email.
2. The invitee clicks the link, completes sign-in, and lands at `/` viewing the owner's products, sales, suppliers, etc. — not an empty account.
3. With `stock.write = false`, the invitee sees the stock module but the "+ Nuevo producto" and "Editar" buttons are disabled with a "Sin permiso" tooltip. If they call the RPC directly, it returns an authorization error.
4. With `caja.read = false`, the **Caja** entry does not appear in the sidebar and `/caja` redirects to `/` with a toast.
5. The owner can edit permissions at any time; the next time the collaborator reloads, the change is in effect. Mid-session, the RPC continues to enforce correctly.
6. The owner can revoke a collaborator (sets `revoked_at`). The collaborator's next request fails the RLS / RPC check and they are effectively logged out of the owner's data.
7. The original UNIQUE constraint bug on `profiles.business_name_lower` is fixed and verified by inviting at least 2 collaborators across 2 different owners in the staging environment.
8. All 12 user-scoped tables have their RLS policies extended; all existing RPCs route through `get_owner_uid`; storage bucket allows collaborator uploads.
9. The existing single-user flow (owner with no collaborators) is unaffected — regression-tested against the current happy path.
10. The Edge Function is deployed and documented in the change's README with rollback instructions.
