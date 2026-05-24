# Design — user-roles

**Change ID**: `user-roles`
**Phase**: Design
**Date**: 2026-05-23
**Backend**: openspec

---

## 0. Architecture Approach (summary)

- **DB-first authority**: source of truth for "who am I working as" is the `collaborators` table, surfaced to the app by a single SECURITY DEFINER function `get_owner_uid(uuid)`. Every RPC and RLS policy that today references `auth.uid()` for **data ownership** is rewritten to reference `get_owner_uid(auth.uid())`. `auth.uid()` is still used everywhere the *identity* of the caller matters (e.g. `profiles_select_own`, audit fields).
- **Layering**: three layers, each with its own enforcement.
  1. **RLS (read-only)**: lets a collaborator `SELECT` the owner's rows. One uniform extension per table; no permission-aware policies.
  2. **RPC (write authority)**: every existing RPC validates permission via `has_permission(auth.uid(), module, action)` and uses `get_owner_uid(auth.uid())` as the `user_id` of any row it writes.
  3. **Client (UX gate)**: `usePermission` hook reads from `AuthContext.permissions`, drives `<RequirePermission>` route guards and disables/hides UI affordances. Never the security boundary — only ergonomics.
- **JSONB permissions** on `collaborators.permissions`, mirrored 1-to-1 by a TypeScript `PermissionMatrix` type. Role presets are pure client-side templates that fill the JSONB.
- **Edge Function** `invite-collaborator` is the only new operational surface, used exclusively for the admin-only `inviteUserByEmail` call. The lifecycle materialization runs inside the DB trigger so the magic-link path is deterministic and independent of the function.
- **AuthContext is the single seam**: `loadProfile` is rewritten to first look up `collaborators` and, when matched, hydrate with the owner's profile and the collaborator's permissions. Every consumer (existing `db.ts` already takes `ownerUid`) keeps working with the new value.

---

## 1. Migration Strategy

Three new sequential migration files. Order is mandatory — `0018` MUST run before any code that creates a 2nd collaborator (see R1 in proposal).

| File | Purpose |
|------|---------|
| `supabase/migrations/0018_fix_profiles_business_name_unique.sql` | Drop plain UNIQUE on `profiles.business_name_lower`, replace with partial unique index excluding `''`. |
| `supabase/migrations/0019_collaborators_schema.sql` | Create `collaborators` + `invitations` tables, indexes, RLS on both, helpers `get_owner_uid`/`has_permission`, extend `handle_new_user`. |
| `supabase/migrations/0020_extend_rls_and_rpcs.sql` | Drop and recreate all existing per-table policies (12 tables) to add the collaborator-SELECT branch; recreate all existing RPCs that hardcode `auth.uid()` so they resolve `ownerUid` via `get_owner_uid` and enforce `has_permission`; extend storage bucket policies. |

`0020` is a single file (not split per RPC) because all of these changes ship together — splitting risks deploying half the system where reads work for collaborators but writes silently target the wrong owner (the R2 catastrophe).

---

## 2. DB Schema (complete SQL)

### 2.1 `0018_fix_profiles_business_name_unique.sql`

```sql
-- Replace global UNIQUE with partial index so empty-string defaults from
-- handle_new_user no longer collide as collaborator accounts get created.
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_business_name_lower_key;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_business_name_lower_unique
  ON profiles (business_name_lower)
  WHERE business_name_lower <> '';
```

The constraint name `profiles_business_name_lower_key` is the default Postgres assigns to a `UNIQUE (business_name_lower)` declared inline in `CREATE TABLE`. Verify in the running DB (`\d profiles`) before applying; if it differs, adjust the `DROP CONSTRAINT` accordingly.

### 2.2 `0019_collaborators_schema.sql`

```sql
-- ─────────── INVITATIONS (pending magic-link state) ───────────
CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  permissions  jsonb NOT NULL,
  role_preset  text,
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  UNIQUE (owner_uid, email)
);
CREATE INDEX invitations_email_pending_idx
  ON invitations (lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invitations_owner_all" ON invitations
  USING (owner_uid = auth.uid())
  WITH CHECK (owner_uid = auth.uid());

-- ─────────── COLLABORATORS (active membership) ───────────
CREATE TABLE collaborators (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_uid        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text NOT NULL,
  permissions     jsonb NOT NULL,
  role_preset     text,
  invitation_id   uuid REFERENCES invitations(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  UNIQUE (owner_uid, user_uid)
);
CREATE INDEX collaborators_user_uid_active_idx
  ON collaborators (user_uid)
  WHERE revoked_at IS NULL;
CREATE INDEX collaborators_owner_uid_active_idx
  ON collaborators (owner_uid)
  WHERE revoked_at IS NULL;

ALTER TABLE collaborators ENABLE ROW LEVEL SECURITY;

-- Owners can read/write rows where they are the owner.
CREATE POLICY "collaborators_owner_all" ON collaborators
  USING (owner_uid = auth.uid())
  WITH CHECK (owner_uid = auth.uid());

-- A collaborator can read their own membership row (to populate AuthContext).
CREATE POLICY "collaborators_self_select" ON collaborators
  FOR SELECT USING (user_uid = auth.uid());

-- ─────────── HELPERS ───────────
CREATE OR REPLACE FUNCTION get_owner_uid(v_uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT owner_uid
       FROM collaborators
      WHERE user_uid = v_uid
        AND revoked_at IS NULL
      LIMIT 1),
    v_uid
  );
$$;

CREATE OR REPLACE FUNCTION has_permission(
  v_uid    uuid,
  v_module text,
  v_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM collaborators
       WHERE user_uid = v_uid AND revoked_at IS NULL
    ) THEN true   -- owner has all permissions
    ELSE COALESCE(
      (SELECT (permissions -> v_module ->> v_action)::boolean
         FROM collaborators
        WHERE user_uid = v_uid AND revoked_at IS NULL
        LIMIT 1),
      false
    )
  END;
$$;

REVOKE ALL ON FUNCTION get_owner_uid(uuid) FROM public;
GRANT EXECUTE ON FUNCTION get_owner_uid(uuid) TO authenticated;
REVOKE ALL ON FUNCTION has_permission(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION has_permission(uuid, text, text) TO authenticated;

-- ─────────── handle_new_user EXTENSION ───────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv invitations%ROWTYPE;
BEGIN
  -- 1. Check for pending invitation matching this email
  SELECT * INTO v_inv
    FROM invitations
   WHERE lower(email) = lower(COALESCE(NEW.email, ''))
     AND accepted_at IS NULL
     AND revoked_at IS NULL
   ORDER BY invited_at DESC
   LIMIT 1;

  IF FOUND THEN
    -- Materialize collaborator membership
    INSERT INTO collaborators (
      owner_uid, user_uid, email, permissions, role_preset, invitation_id, created_at
    ) VALUES (
      v_inv.owner_uid, NEW.id, COALESCE(NEW.email, v_inv.email),
      v_inv.permissions, v_inv.role_preset, v_inv.id, now()
    )
    ON CONFLICT (owner_uid, user_uid) DO NOTHING;

    UPDATE invitations
       SET accepted_at = now()
     WHERE id = v_inv.id;

    -- Create a minimal placeholder profile so FKs/joins don't break.
    -- business_name stays '' (partial index ignores it). The AuthContext
    -- will route this user to the owner's profile, so this row is never
    -- presented in the UI.
    INSERT INTO profiles (id, email, display_name, role, currency_symbol, dark_mode, created_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
      'user', '$', false, now()
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- 2. Normal owner signup (unchanged behavior)
  INSERT INTO profiles (id, email, display_name, role, currency_symbol, dark_mode, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
    'user', '$', false, now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
```

### 2.3 `0020_extend_rls_and_rpcs.sql` — RLS extension pattern

For every existing per-table policy that uses `user_id = auth.uid()`, drop and recreate split into two:

- **SELECT** policy: owner OR active collaborator of the owner.
- **INSERT/UPDATE/DELETE** policy: owner only (`user_id = auth.uid()`). Writes by collaborators go through RPCs that bypass RLS via `SECURITY DEFINER`.

Pattern, shown for `products`:

```sql
DROP POLICY IF EXISTS "products_owner" ON products;

CREATE POLICY "products_select" ON products
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.user_uid = auth.uid()
        AND c.owner_uid = products.user_id
        AND c.revoked_at IS NULL
    )
  );

CREATE POLICY "products_modify_owner" ON products
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "products_update_owner" ON products
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "products_delete_owner" ON products
  FOR DELETE USING (user_id = auth.uid());
```

Apply this exact pattern to all 12 tables that today have an `*_owner` `FOR ALL` policy (kept the existing public-catalog policies untouched):

`categories`, `price_ranges`, `products`, `sales`, `cash_flow`, `stock_intakes`, `customers`, `customer_transactions`, `quotes`, `orders`, `catalog_config`, `suppliers`.

Note: `profiles` is NOT extended this way. For collaborators, AuthContext reads the **owner's** profile via the RPC `get_owner_profile()` (defined below), not via direct table access, so the existing `profiles_select_own` stays.

```sql
CREATE OR REPLACE FUNCTION get_owner_profile()
RETURNS SETOF profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles
   WHERE id = get_owner_uid(auth.uid());
$$;
GRANT EXECUTE ON FUNCTION get_owner_profile() TO authenticated;
```

### 2.4 Storage policy extension

```sql
DROP POLICY IF EXISTS "assets_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "assets_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "assets_auth_delete" ON storage.objects;

CREATE POLICY "assets_auth_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'assets'
    AND get_owner_uid(auth.uid())::text = (storage.foldername(name))[1]
    AND has_permission(auth.uid(), 'stock', 'write')
  );

CREATE POLICY "assets_auth_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'assets'
    AND get_owner_uid(auth.uid())::text = (storage.foldername(name))[1]
    AND has_permission(auth.uid(), 'stock', 'write')
  );

CREATE POLICY "assets_auth_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'assets'
    AND get_owner_uid(auth.uid())::text = (storage.foldername(name))[1]
    AND has_permission(auth.uid(), 'stock', 'delete')
  );
```

Storage paths continue to be `{owner_uid}/products/...` — the client code stays the same as long as it builds the path from `auth.ownerUid` (not `auth.user.uid`). This is enforced in §8.

---

## 3. RPC Update Pattern

### 3.1 The rule

Every existing RPC that today has `v_uid uuid := auth.uid();` and uses `v_uid` as the data owner must change to:

```sql
DECLARE
  v_caller uuid := auth.uid();
  v_uid    uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, '<module>', '<action>') THEN
    RAISE EXCEPTION 'Sin permiso para esta acción';
  END IF;
  -- ...rest of function body unchanged, still uses v_uid for ownership
```

`v_caller` is the human/account doing the call; `v_uid` is the data owner. The body of every RPC keeps working with `v_uid` exactly as today — that's why the change is mechanical despite the blast radius.

### 3.2 Concrete before/after — `register_sale`

**Before** (current `0012_fix_register_sale_product_id.sql`):

```sql
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  -- ... uses v_uid as owner in INSERT INTO sales (..., v_uid, ...)
```

**After**:

```sql
DECLARE
  v_caller uuid := auth.uid();
  v_uid    uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar ventas';
  END IF;
  -- ... body unchanged
```

### 3.3 Full RPC update list (module, action, file)

All entries below recreate the function in `0020_extend_rls_and_rpcs.sql`. The "Action" is what the RPC does, used to drive `has_permission`.

| RPC | Module | Action | Current file |
|-----|--------|--------|--------------|
| `register_sale` | `ventas` | `write` | `0012_fix_register_sale_product_id.sql` (latest) |
| `edit_sale` | `ventas` | `write` | `0016_fix_edit_sale_toggle_sale_bypass.sql` |
| `toggle_sale_status` | `ventas` | `write` | `0016_fix_edit_sale_toggle_sale_bypass.sql` |
| `delete_sale` | `ventas` | `delete` | `0013_fix_delete_sale_cascade.sql` |
| `register_customer_payment` | `clientes` | `write` | `0002_rpcs.sql` |
| `reconcile_customer_balance` | `clientes` | `write` | `0011_reconcile_customer_balance.sql` |
| `intake_stock` | `ingresos` | `write` | `0002_rpcs.sql` |
| `convert_quote_to_sale` | `ventas` | `write` (+ implicit `presupuestos` read) | `0002_rpcs.sql` |
| `register_supplier` | `proveedores` | `write` | `0014_create_suppliers.sql` |
| `update_supplier` | `proveedores` | `write` | `0017_fix_update_supplier_catalog_url.sql` (latest) |
| `delete_supplier` | `proveedores` | `delete` | `0014_create_suppliers.sql` |
| `toggle_supplier_active` | `proveedores` | `write` | `0014_create_suppliers.sql` |

For each RPC, `0020_extend_rls_and_rpcs.sql` MUST include the **full** latest body of the function (per the "current file" column) with only the DECLARE/BEGIN prologue rewritten as in §3.1. Copy from the latest migration that recreated the function so we don't accidentally roll back a previous fix.

Verification rule for the apply phase: after writing `0020`, `rg -n "v_uid\s+uuid\s+:=\s+auth\.uid\(\)" supabase/migrations/0020_extend_rls_and_rpcs.sql` must return **zero matches**. Any match means an RPC was forgotten.

### 3.4 New RPCs

```sql
-- Used by the Equipo page to list active+revoked collaborators (with the owner's row)
CREATE OR REPLACE FUNCTION list_collaborators()
RETURNS SETOF collaborators
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM collaborators
   WHERE owner_uid = auth.uid()
   ORDER BY revoked_at NULLS FIRST, created_at DESC;
$$;

CREATE OR REPLACE FUNCTION list_invitations()
RETURNS SETOF invitations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM invitations
   WHERE owner_uid = auth.uid()
   ORDER BY invited_at DESC;
$$;

CREATE OR REPLACE FUNCTION update_collaborator_permissions(
  p_collab_id  uuid,
  p_permissions jsonb,
  p_role_preset text
)
RETURNS SETOF collaborators
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row collaborators%ROWTYPE;
BEGIN
  UPDATE collaborators
     SET permissions = p_permissions,
         role_preset = p_role_preset
   WHERE id = p_collab_id AND owner_uid = auth.uid()
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador no encontrado'; END IF;
  RETURN NEXT v_row;
END; $$;

CREATE OR REPLACE FUNCTION revoke_collaborator(p_collab_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE collaborators
     SET revoked_at = now()
   WHERE id = p_collab_id AND owner_uid = auth.uid() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador no encontrado o ya revocado'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION revoke_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE invitations
     SET revoked_at = now()
   WHERE id = p_invitation_id AND owner_uid = auth.uid() AND accepted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitación no encontrada o ya aceptada/revocada'; END IF;
END; $$;

GRANT EXECUTE ON FUNCTION list_collaborators() TO authenticated;
GRANT EXECUTE ON FUNCTION list_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION update_collaborator_permissions(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_collaborator(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_invitation(uuid) TO authenticated;
```

These five RPCs are owner-only (filtered by `owner_uid = auth.uid()`). No collaborator can call them meaningfully — a collaborator calling `list_collaborators()` gets zero rows back, which is fine.

---

## 4. Edge Function `invite-collaborator`

### 4.1 File location

`supabase/functions/invite-collaborator/index.ts` (standard Supabase functions layout).

### 4.2 Implementation

```ts
// supabase/functions/invite-collaborator/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL               = Deno.env.get('APP_URL') ?? 'https://rivastock.app';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  email: string;
  permissions: Record<string, Record<string, boolean>>;
  role_preset?: 'admin' | 'employee' | 'viewer' | 'custom';
}

function isValidEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isValidPermissions(p: unknown): p is Body['permissions'] {
  if (!p || typeof p !== 'object') return false;
  for (const mod of Object.values(p as Record<string, unknown>)) {
    if (!mod || typeof mod !== 'object') return false;
    for (const v of Object.values(mod as Record<string, unknown>)) {
      if (typeof v !== 'boolean') return false;
    }
  }
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // 1. AuthN: verify caller via their JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'No autenticado' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Sesión inválida' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // 2. AuthZ: caller must be an owner (not a collaborator)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const { data: collabRows } = await admin
    .from('collaborators')
    .select('id')
    .eq('user_uid', user.id)
    .is('revoked_at', null)
    .limit(1);
  if (collabRows && collabRows.length > 0) {
    return new Response(JSON.stringify({ error: 'Solo el propietario puede invitar' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // 3. Validate body
  let body: Body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'JSON inválido' }),
    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  if (!isValidEmail(body.email)) {
    return new Response(JSON.stringify({ error: 'Email inválido' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  if (!isValidPermissions(body.permissions)) {
    return new Response(JSON.stringify({ error: 'Permisos inválidos' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // 4. Idempotency: if a pending invite for (owner, email) exists, return it.
  const { data: existing } = await admin
    .from('invitations')
    .select('*')
    .eq('owner_uid', user.id)
    .eq('email', body.email)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle();

  let invitationId: string;
  if (existing) {
    invitationId = existing.id;
    // Refresh permissions on resend
    await admin.from('invitations').update({
      permissions: body.permissions,
      role_preset: body.role_preset ?? null,
    }).eq('id', invitationId);
  } else {
    const { data: inserted, error: insErr } = await admin
      .from('invitations')
      .insert({
        owner_uid:   user.id,
        email:       body.email,
        permissions: body.permissions,
        role_preset: body.role_preset ?? null,
      })
      .select('id')
      .single();
    if (insErr) {
      return new Response(JSON.stringify({ error: `Error al crear invitación: ${insErr.message}` }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    invitationId = inserted.id;
  }

  // 5. Send magic-link invite (admin-only)
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    body.email,
    { redirectTo: `${APP_URL}/` },
  );
  if (inviteErr) {
    // Don't roll back the invitations row — owner can hit "resend".
    return new Response(JSON.stringify({
      error: `Error al enviar email: ${inviteErr.message}`,
      invitation_id: invitationId,
    }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ invitation_id: invitationId, status: 'sent' }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
```

### 4.3 Environment variables

Set in Supabase dashboard → Edge Functions → `invite-collaborator` → Secrets:

- `SUPABASE_URL` — auto-provided by Supabase runtime.
- `SUPABASE_ANON_KEY` — auto-provided.
- `SUPABASE_SERVICE_ROLE_KEY` — auto-provided.
- `APP_URL` — explicit. e.g. `https://rivastock.app` for prod, `http://localhost:5173` for dev.

### 4.4 Deployment

```powershell
# from repo root
supabase functions deploy invite-collaborator
supabase secrets set APP_URL=https://rivastock.app
```

Local dev:

```powershell
supabase functions serve invite-collaborator --env-file ./supabase/.env.local
```

Rollback: `supabase functions delete invite-collaborator`. The DB rows continue to exist; only outbound invitations stop being sent.

---

## 5. `handle_new_user` Trigger Extension

Already shown in §2.2. Behavior:

1. Look up `invitations` by `lower(email) = lower(NEW.email)` AND pending (not accepted, not revoked).
2. **If found** → insert into `collaborators` with the invitation's `owner_uid`, `permissions`, `role_preset`. Mark invitation `accepted_at = now()`. Insert a minimal `profiles` placeholder so any FK joins or admin views don't break (the row has `business_name = ''` which the new partial index ignores). The AuthContext is the one that routes the user to the owner's profile for display.
3. **If not found** → existing owner-signup path, unchanged.

Why we still insert a `profiles` row for invitees: many existing tables / RPCs use `profiles` as the FK target for `user_id`. Even if we never present it, the row must exist. The row is *hidden* by AuthContext, not by RLS.

Edge case: if an existing owner is invited as a collaborator of someone else, the owner-signup path was never taken (they already have a profile). The trigger only fires on insert into `auth.users`, so for an existing user accepting an invite, we need a one-shot reconciliation. **Decided behavior**: this is the multi-business case which is OUT OF SCOPE (proposal §5). The invite email goes to a *new* email address that has no account yet. If the invitee already has an account, the magic link logs them in and the trigger does NOT fire (no new auth.users insert), so no collaborator row is created. Document this as a known limitation in the spec; surface a clear error on the Equipo page when the invitee is detected as an existing user (the Edge Function can detect this via `admin.auth.admin.listUsers` filtered by email — out of v1 scope; we accept the silent failure for now and document the workaround: have the invitee sign out and use a different email).

---

## 6. TypeScript Types

All changes go into `src/types.ts`. The existing broken `Collaborator` interface (lines 151–157) is **deleted and replaced**.

```ts
// ─── Permissions ──────────────────────────────────────────
export type ModuleKey =
  | 'stock'
  | 'ventas'
  | 'caja'
  | 'ingresos'
  | 'pedidos'
  | 'presupuestos'
  | 'clientes'
  | 'proveedores'
  | 'config';

export type ActionKey = 'read' | 'write' | 'delete';

export type ModulePermissions = Record<ActionKey, boolean>;

export type PermissionMatrix = Record<ModuleKey, ModulePermissions>;

export type StaffRole = 'admin' | 'employee' | 'viewer' | 'custom';

// Owner — full matrix all true. Used in AuthContext when isOwner.
export const ALL_TRUE_PERMISSIONS: PermissionMatrix = {
  stock:        { read: true, write: true, delete: true },
  ventas:       { read: true, write: true, delete: true },
  caja:         { read: true, write: true, delete: true },
  ingresos:     { read: true, write: true, delete: true },
  pedidos:      { read: true, write: true, delete: true },
  presupuestos: { read: true, write: true, delete: true },
  clientes:     { read: true, write: true, delete: true },
  proveedores:  { read: true, write: true, delete: true },
  config:       { read: true, write: true, delete: true },
};

// ─── Collaborator (replaces the existing broken interface) ──
export interface Collaborator {
  id: string;
  ownerUid: string;
  userUid: string;
  email: string;
  permissions: PermissionMatrix;
  rolePreset: StaffRole | null;
  invitationId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface Invitation {
  id: string;
  ownerUid: string;
  email: string;
  permissions: PermissionMatrix;
  rolePreset: StaffRole | null;
  invitedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}
```

Note on field naming: `db.ts` (`fromDb`/`toDb`) already converts `user_id ↔ ownerUid` automatically (line 130/138). For the new tables we leverage the generic `toSnake`/`toCamel` for everything except `owner_uid ↔ ownerUid` and `user_uid ↔ userUid`. The generic converter handles `owner_uid → ownerUid` correctly (snake→camel collapses the `_`), so **no `db.ts` change is needed** for these two columns. Verify with a quick `console.log` during apply.

Existing `UserRole` type stays (`'admin' | 'viewer'`) — it refers to the legacy `profiles.role` column and is unrelated to collaborator roles.

---

## 7. AuthContext Changes

### 7.1 New `AuthContextType`

```ts
interface AuthContextType {
  user: UserProfile | null;            // the OWNER's profile (for both owners and collabs)
  authUser: { uid: string; email: string } | null; // the actual auth.user identity
  ownerUid: string | null;
  isOwner: boolean;
  collaboratorId: string | null;
  permissions: PermissionMatrix;
  loading: boolean;
  refetchToken: number;
  refetchData: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: UserProfile) => void;
  sendResetEmail: (email: string) => Promise<void>;
  resetPassword: (code: string, newPassword: string) => Promise<void>;
}
```

Rationale for `authUser`: some places need the actual logged-in identity (e.g. displaying "Logged in as employee@x.com" while showing the owner's business). Keeping it explicit avoids future bugs where someone tries `user.uid` and gets the owner's id when they wanted the collaborator's id.

### 7.2 New `loadProfile` logic

```ts
interface LoadedAuth {
  profile: UserProfile;
  ownerUid: string;
  isOwner: boolean;
  collaboratorId: string | null;
  permissions: PermissionMatrix;
}

async function loadProfile(session: Session): Promise<LoadedAuth | null> {
  try {
    // 1. Resolve membership: am I a collaborator?
    const { data: collabRow } = await supabase
      .from('collaborators')
      .select('id, owner_uid, permissions')
      .eq('user_uid', session.user.id)
      .is('revoked_at', null)
      .maybeSingle();

    const isOwner = !collabRow;
    const ownerUid = collabRow ? collabRow.owner_uid : session.user.id;
    const collaboratorId = collabRow ? collabRow.id : null;
    const permissions: PermissionMatrix = collabRow
      ? (collabRow.permissions as PermissionMatrix)
      : ALL_TRUE_PERMISSIONS;

    // 2. Load OWNER profile via SECURITY DEFINER RPC (works for both cases)
    let profile: UserProfile | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase.rpc('get_owner_profile');
      if (!error && data && data.length > 0) {
        profile = fromDb<UserProfile>(data[0], true);
        profile.uid = ownerUid;
        break;
      }
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
    if (!profile) throw new Error('No se pudo cargar el perfil. Recargá la página.');

    return { profile, ownerUid, isOwner, collaboratorId, permissions };
  } catch (err) {
    console.error('[Auth] loadProfile error:', err);
    return null;
  }
}
```

### 7.3 Provider state

Replace the single `user` state with an `auth` state:

```ts
const [auth, setAuth] = useState<LoadedAuth | null>(null);
const [authUser, setAuthUser] = useState<{ uid: string; email: string } | null>(null);
```

On every successful `loadProfile`, set both `auth` and `authUser`. Provide via context:

```tsx
<AuthContext.Provider value={{
  user:           auth?.profile ?? null,
  authUser,
  ownerUid:       auth?.ownerUid ?? null,
  isOwner:        auth?.isOwner ?? false,
  collaboratorId: auth?.collaboratorId ?? null,
  permissions:    auth?.permissions ?? ALL_TRUE_PERMISSIONS,
  // ...rest unchanged
}}>
```

`updateUser` only mutates the owner's profile, and only an owner can call it (settings page) — for collaborators the settings page is read-only or hidden.

`db.ts` callers throughout the app are already parameterized with `user.uid` as the owner reference. Since `user` is now the OWNER's profile and `user.uid` is set to `ownerUid`, **no caller change is needed** — `user.uid` continues to be the right value to pass. This is the major payoff of using `profile.uid = ownerUid`.

The only caller that needs `authUser.uid` instead is anything that needs the literal logged-in identity (rare — e.g. a future "audit log"). For v1 only the Equipo page header uses it.

---

## 8. `usePermission` Hook

`src/hooks/usePermission.ts`:

```ts
import { useAuth } from '../AuthContext';
import type { ModuleKey, ActionKey } from '../types';

export function usePermission(module: ModuleKey, action: ActionKey): boolean {
  const { permissions } = useAuth();
  return Boolean(permissions[module]?.[action]);
}
```

That's the whole file. Pulls from context, no network, trivially testable.

---

## 9. `<RequirePermission>` Component

`src/components/RequirePermission.tsx`:

```tsx
import { ReactNode, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { showToast } from '../lib/toast'; // existing toast utility
import type { ModuleKey, ActionKey } from '../types';

interface Props {
  module: ModuleKey;
  action?: ActionKey;
  children: ReactNode;
  redirectTo?: string;
}

export default function RequirePermission({
  module, action = 'read', children, redirectTo = '/',
}: Props) {
  const { permissions, loading } = useAuth();
  const allowed = Boolean(permissions[module]?.[action]);

  useEffect(() => {
    if (!loading && !allowed) {
      showToast('Sin acceso a este módulo', 'error');
    }
  }, [loading, allowed]);

  if (loading) return null; // ProtectedRoute already shows a global loader
  if (!allowed) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
```

Used in `src/App.tsx`:

```tsx
<Route path="stock" element={withSuspense(
  <RequirePermission module="stock"><Stock /></RequirePermission>
)} />
<Route path="caja" element={withSuspense(
  <RequirePermission module="caja"><CashFlow /></RequirePermission>
)} />
// ...wrap every protected page except `/` (Dashboard, always visible)
```

`/config` is special: the Equipo subtab requires `isOwner === true`. Use `RequirePermission` with module `config` for the page itself, and an `isOwner` check inside the tab.

---

## 10. Layout Changes

Today `src/components/Layout.tsx` declares a static `navItems` array (lines 26–38). The change:

```tsx
import { usePermission } from '../hooks/usePermission';
import type { ModuleKey } from '../types';

interface NavItem {
  name: string;
  path: string;
  icon: typeof LayoutDashboard;
  module: ModuleKey | null; // null = always shown (e.g. Inicio, Calculadora)
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Inicio',        path: '/',             icon: LayoutDashboard, module: null },
  { name: 'Stock',         path: '/stock',        icon: Package,         module: 'stock' },
  { name: 'Ventas',        path: '/ventas',       icon: ShoppingCart,    module: 'ventas' },
  { name: 'Presupuestos',  path: '/presupuestos', icon: FileText,        module: 'presupuestos' },
  { name: 'Clientes',      path: '/clientes',     icon: Users,           module: 'clientes' },
  { name: 'Proveedores',   path: '/proveedores',  icon: Building2,       module: 'proveedores' },
  { name: 'Ingresos',      path: '/ingresos',     icon: ArrowDownCircle, module: 'ingresos' },
  { name: 'Flujo de Caja', path: '/caja',         icon: Wallet,          module: 'caja' },
  { name: 'Pedidos',       path: '/pedidos',      icon: ClipboardList,   module: 'pedidos' },
  { name: 'Calculadora',   path: '/calculadora',  icon: Calculator,      module: null },
  { name: 'Configuración', path: '/config',       icon: Settings,        module: 'config' },
];

export default function Layout() {
  const { permissions } = useAuth();
  const navItems = NAV_ITEMS.filter(it =>
    it.module === null || permissions[it.module]?.read
  );
  // ...rest unchanged, replace every `navItems` reference (already iterates over local var)
}
```

The three existing iterations (`navItems.map`, `navItems.slice(0, 5)`, mobile menu map) consume the filtered local variable transparently.

Special case: `Calculadora` is `module: null` (no permission needed). `Inicio` (dashboard) is also `null` so collaborators always have a landing page. The Dashboard component itself uses `usePermission` to hide cards/widgets the user can't access.

---

## 11. Settings > Equipo Tab

### 11.1 Component structure

```
src/pages/Settings.tsx                 (existing — add a new tab)
src/components/team/TeamTab.tsx        (new — top-level tab content)
src/components/team/InviteForm.tsx     (new — invite modal/inline form)
src/components/team/CollaboratorRow.tsx(new — row with edit/revoke buttons)
src/components/team/PermissionsEditor.tsx (new — the matrix grid)
src/hooks/useTeam.ts                   (new — fetch + mutations)
src/lib/rolePresets.ts                 (new — ROLE_PRESETS constant)
src/lib/inviteCollaborator.ts          (new — Edge Function caller)
```

### 11.2 Data fetched (in `useTeam`)

```ts
export function useTeam() {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [invitations,   setInvitations]   = useState<Invitation[]>([]);
  const [loading,       setLoading]       = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const [{ data: collabs }, { data: invs }] = await Promise.all([
      supabase.rpc('list_collaborators'),
      supabase.rpc('list_invitations'),
    ]);
    setCollaborators((collabs ?? []).map(r => fromDb<Collaborator>(r)));
    setInvitations((invs ?? []).map(r => fromDb<Invitation>(r)));
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { collaborators, invitations, loading, refetch };
}
```

### 11.3 Invite form flow

1. Owner clicks "Invitar colaborador" → modal opens with `InviteForm`.
2. Form fields: `email` (text input, required), `rolePreset` (select: Admin / Empleado / Solo lectura / Personalizado), `permissions` (matrix grid, editable when preset is "Personalizado").
3. Picking a preset writes that preset's permissions into local state; the matrix grid still renders so the owner can override.
4. On submit, the form calls `inviteCollaborator({ email, permissions, role_preset })` (helper that POSTs to the Edge Function with the user's JWT in the `Authorization` header).
5. On success, toast "Invitación enviada", close modal, `refetch()`.
6. On failure, toast with the error message from the response body.

```ts
// src/lib/inviteCollaborator.ts
import { supabase } from './supabase';
import type { PermissionMatrix, StaffRole } from '../types';

export async function inviteCollaborator(args: {
  email: string;
  permissions: PermissionMatrix;
  role_preset: StaffRole;
}): Promise<{ invitation_id: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sesión expirada');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-collaborator`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(args),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Error al enviar invitación');
  return body;
}
```

### 11.4 Edit / revoke

- Edit: click pencil on a row → opens `PermissionsEditor` pre-filled. Save calls `supabase.rpc('update_collaborator_permissions', { p_collab_id, p_permissions, p_role_preset })` → toast → `refetch()`.
- Revoke (active collaborator): confirmation dialog → `supabase.rpc('revoke_collaborator', { p_collab_id })` → toast → `refetch()`.
- Revoke (pending invitation): confirmation dialog → `supabase.rpc('revoke_invitation', { p_invitation_id })` → toast → `refetch()`.
- Resend (pending invitation): calls `inviteCollaborator` again with the same args (Edge Function is idempotent — see §4.2 step 4).

### 11.5 Owner-only guard

Inside `Settings.tsx`, render the Equipo tab only when `isOwner === true`. Collaborators don't see the tab at all. Backstop: the RPCs `list_collaborators`, `update_collaborator_permissions`, etc. all filter by `owner_uid = auth.uid()`, so a collaborator calling them gets empty results / `Colaborador no encontrado`.

---

## 12. Role Presets

`src/lib/rolePresets.ts`:

```ts
import type { PermissionMatrix, StaffRole } from '../types';

const ALL_FALSE = (): PermissionMatrix => ({
  stock:        { read: false, write: false, delete: false },
  ventas:       { read: false, write: false, delete: false },
  caja:         { read: false, write: false, delete: false },
  ingresos:     { read: false, write: false, delete: false },
  pedidos:      { read: false, write: false, delete: false },
  presupuestos: { read: false, write: false, delete: false },
  clientes:     { read: false, write: false, delete: false },
  proveedores:  { read: false, write: false, delete: false },
  config:       { read: false, write: false, delete: false },
});

// Admin: full access except destructive ops in config and proveedores delete.
const ADMIN: PermissionMatrix = {
  stock:        { read: true, write: true, delete: true },
  ventas:       { read: true, write: true, delete: true },
  caja:         { read: true, write: true, delete: true },
  ingresos:     { read: true, write: true, delete: true },
  pedidos:      { read: true, write: true, delete: true },
  presupuestos: { read: true, write: true, delete: true },
  clientes:     { read: true, write: true, delete: true },
  proveedores:  { read: true, write: true, delete: false },
  config:       { read: true, write: false, delete: false },
};

// Employee: day-to-day operations, no deletes, no config, no ingresos write.
const EMPLOYEE: PermissionMatrix = {
  stock:        { read: true, write: true, delete: false },
  ventas:       { read: true, write: true, delete: false },
  caja:         { read: true, write: false, delete: false },
  ingresos:     { read: true, write: false, delete: false },
  pedidos:      { read: true, write: true, delete: false },
  presupuestos: { read: true, write: true, delete: false },
  clientes:     { read: true, write: true, delete: false },
  proveedores:  { read: true, write: false, delete: false },
  config:       { read: false, write: false, delete: false },
};

// Viewer: pure read.
const VIEWER: PermissionMatrix = {
  stock:        { read: true, write: false, delete: false },
  ventas:       { read: true, write: false, delete: false },
  caja:         { read: true, write: false, delete: false },
  ingresos:     { read: true, write: false, delete: false },
  pedidos:      { read: true, write: false, delete: false },
  presupuestos: { read: true, write: false, delete: false },
  clientes:     { read: true, write: false, delete: false },
  proveedores:  { read: true, write: false, delete: false },
  config:       { read: false, write: false, delete: false },
};

export const ROLE_PRESETS: Record<Exclude<StaffRole, 'custom'>, PermissionMatrix> = {
  admin:    ADMIN,
  employee: EMPLOYEE,
  viewer:   VIEWER,
};

export const ROLE_PRESET_LABELS: Record<StaffRole, string> = {
  admin:    'Administrador',
  employee: 'Empleado',
  viewer:   'Solo lectura',
  custom:   'Personalizado',
};

export function presetForMatrix(p: PermissionMatrix): StaffRole {
  const eq = (a: PermissionMatrix, b: PermissionMatrix) => JSON.stringify(a) === JSON.stringify(b);
  if (eq(p, ADMIN))    return 'admin';
  if (eq(p, EMPLOYEE)) return 'employee';
  if (eq(p, VIEWER))   return 'viewer';
  return 'custom';
}

export function emptyMatrix(): PermissionMatrix {
  return ALL_FALSE();
}
```

---

## 13. Error Handling

| Scenario | Behavior |
|----------|----------|
| Edge Function returns 4xx/5xx | `inviteCollaborator()` throws with the server's `error` message. `InviteForm` catches → toast `error.message`. Modal stays open with form intact. |
| Edge Function unreachable (network) | `fetch` throws → toast `"No se pudo enviar la invitación. Verificá tu conexión."` |
| RPC returns "Sin permiso para esta acción" | `callRpc` already throws with `[rpc:name] Sin permiso...`. Pages catch via existing try/catch and show toast. Add a top-level `onError` in mutation helpers to also log to console. |
| `loadProfile` fails (collaborator with no membership row, or RPC error) | Existing retry-3x logic stays. On final failure, user sees the "Recargá la página" message. Do NOT auto-logout (preserves existing behavior on transient errors). |
| Collaborator tries to call owner-only RPC (`list_collaborators` from a collaborator account) | RPC returns empty set; UI shows "No hay colaboradores". The Equipo tab is hidden anyway. |
| Storage upload fails because user lacks `stock.write` | Supabase storage rejects with RLS error → existing `uploadToStorage` throws → caller shows toast `"Error al subir imagen: sin permiso"`. |
| Owner edits permissions while collaborator is logged in (R5) | Stale UI allows the action; RPC rejects with "Sin permiso"; toast shows; refetch updates state. Acceptable. |
| Invitation to an email that already has an auth account | Magic link logs them in, trigger doesn't fire, no collaborator row created. Owner sees the invitation as "pendiente" indefinitely. Document; add a "this email may already have an account" hint when the Edge Function detects it (post-v1). |

Toast utility: reuse the existing `showToast` from wherever the app shows toasts today (assumed; verify path during apply — likely `src/lib/toast.ts` or via a library already in `package.json`).

---

## 14. File Manifest

### New files

| Path | Purpose |
|------|---------|
| `supabase/migrations/0018_fix_profiles_business_name_unique.sql` | Partial unique index fix (R1). |
| `supabase/migrations/0019_collaborators_schema.sql` | New tables, RLS, helpers, trigger extension. |
| `supabase/migrations/0020_extend_rls_and_rpcs.sql` | Per-table RLS split, RPC rewrites with `get_owner_uid` + `has_permission`, storage policy extension, new owner-RPCs (`list_collaborators`, etc.). |
| `supabase/functions/invite-collaborator/index.ts` | Edge Function. |
| `supabase/functions/invite-collaborator/deno.json` | Optional Deno config (import map) — only if needed by local `supabase functions serve`. |
| `src/hooks/usePermission.ts` | The hook. |
| `src/hooks/useTeam.ts` | Fetch collaborators + invitations. |
| `src/components/RequirePermission.tsx` | Route-level guard. |
| `src/components/team/TeamTab.tsx` | Equipo tab content (list + invite button). |
| `src/components/team/InviteForm.tsx` | Invite modal. |
| `src/components/team/CollaboratorRow.tsx` | Row with edit/revoke/resend. |
| `src/components/team/PermissionsEditor.tsx` | Permission matrix grid. |
| `src/lib/rolePresets.ts` | `ROLE_PRESETS` constant + helpers. |
| `src/lib/inviteCollaborator.ts` | Edge Function caller. |

### Modified files

| Path | Change |
|------|--------|
| `src/types.ts` | Delete old `Collaborator` interface (lines 151–157). Add `ModuleKey`, `ActionKey`, `ModulePermissions`, `PermissionMatrix`, `StaffRole`, `ALL_TRUE_PERMISSIONS`, new `Collaborator`, `Invitation`. |
| `src/AuthContext.tsx` | Rewrite `loadProfile` to resolve membership and load owner profile via `get_owner_profile` RPC. Add `authUser`, `ownerUid`, `isOwner`, `collaboratorId`, `permissions` to context. Keep `user` = owner profile so existing `user.uid` references stay correct. |
| `src/App.tsx` | Wrap protected route elements with `<RequirePermission module="...">`. Skip wrapping `/` (Dashboard) and `/calculadora`. |
| `src/components/Layout.tsx` | Convert `navItems` const to `NAV_ITEMS` array of `{..., module: ModuleKey | null}` and filter inside the component based on `usePermission`/`permissions[module].read`. |
| `src/pages/Settings.tsx` | Add Equipo tab. Render tab only when `isOwner`. |

### Unchanged but verified during apply

- `src/lib/db.ts` — generic `toSnake`/`toCamel` already handles `owner_uid ↔ ownerUid` and `user_uid ↔ userUid`. The special-case in `colToDb` for `ownerUid → user_id` is for the legacy `user_id` column; do not extend it. Verify with a quick log on `useTeam` first load.
- All existing pages/hooks that call `db.list(..., user.uid)` — `user.uid` is now the owner uid (because AuthContext sets it that way), so behavior is correct without code changes. This is the linchpin assumption — call it out in the spec.

---

## 15. ADR-style Decisions

### ADR-1 — Two tables (invitations + collaborators)

- **Decision**: Separate `invitations` (pre-acceptance) from `collaborators` (post-acceptance).
- **Rationale**: Different lifecycles, different fields (no `user_uid` until acceptance), clean revocation semantics, idempotent resend.
- **Rejected**: single table with `status` enum. Would require nullable `user_uid` and conditional logic in every join.

### ADR-2 — JSONB permissions, not normalized

- **Decision**: `permissions jsonb` on `collaborators`, mirrored by TypeScript `PermissionMatrix`.
- **Rationale**: Always read/written as a whole; adding a module = type + UI change, no migration; presets are pure client templates.
- **Rejected**: `permissions(collab_id, module, action, allowed)` table — too many rows for one logical object, no native upsert for "save the whole matrix".

### ADR-3 — RLS for SELECT, RPC for writes

- **Decision**: Extend SELECT policies to include collaborators of the owner; keep writes funneled through RPCs that check `has_permission`.
- **Rationale**: One uniform RLS pattern × 12 tables (cheap, auditable). Writes already go through RPCs for transactional ops; the few direct inserts/updates (e.g. `products` from `Stock.tsx`) will be routed through new write RPCs OR rely on the owner-only INSERT/UPDATE/DELETE policy + a route guard (most likely the second, since the Stock page already requires `stock.write` to render the buttons). Audit during spec phase.
- **Rejected**: per-module-per-action RLS variants — combinatorial explosion (12 tables × N actions). Function call per row for permission check — kills query planning.

### ADR-4 — `get_owner_uid()` as the single seam

- **Decision**: One SECURITY DEFINER function used by every RPC and the storage policies.
- **Rationale**: Centralizes the "who am I working as" logic. Future changes (e.g. multi-business in scope) update one function, not 17 RPCs.
- **Rejected**: inline subquery in every RPC. Untenable for refactoring; easy to forget one.

### ADR-5 — `profile.uid = ownerUid` for collaborators

- **Decision**: AuthContext sets `user.uid` to the OWNER's id even for collaborators.
- **Rationale**: Every existing call site uses `user.uid` as the owner reference (`db.list('products', user.uid)`). Keeping the meaning of `user.uid` consistent means zero changes outside AuthContext.
- **Rejected**: introduce a new `ownerUid` field everywhere and refactor every call site. Massive blast radius, no benefit.
- **Tradeoff**: code that genuinely needs the logged-in user's identity (not the owner's) must use `authUser.uid`. Documented explicitly; only the Equipo header needs it in v1.

### ADR-6 — Edge Function for invite, DB trigger for materialization

- **Decision**: Edge Function only sends the magic link + creates the invitation row. DB trigger materializes the collaborator row on first sign-in.
- **Rationale**: Trigger fires deterministically regardless of how/when/where the user signs in. Edge Function stays small (one path: send invite).
- **Rejected**: do everything in the Edge Function on invite acceptance. Requires a custom callback URL handler and a server-side step on the redirect — much more code, more failure modes.

### ADR-7 — Single migration for RLS + RPC rewrites (`0020`)

- **Decision**: One file for all 12 RLS extensions + all RPC rewrites.
- **Rationale**: They MUST ship atomically. Splitting risks deploying half (e.g. RLS lets collaborators read, but RPCs still write to wrong owner because their rewrite wasn't deployed).
- **Rejected**: per-RPC migration files. Operational simplicity > file granularity here.

---

## 16. Open Questions for Spec / Apply

1. Verify the exact name of the existing UNIQUE constraint on `profiles.business_name_lower` (likely `profiles_business_name_lower_key` but `\d profiles` against the running DB is the source of truth).
2. Audit `src/pages/Stock.tsx` (and any other page) for direct `supabase.from('products').insert/update/delete` calls. If any exist and they currently work for collaborators via the owner-INSERT-only policy, they will break for collaborators (good — collaborators must go through an owner-routed path). Spec phase MUST decide: route through a new RPC, or keep client-side writes and block at the UI level (and accept that an attacker who bypasses UI cannot write because RLS blocks them).
3. Confirm whether the app uses a centralized toast (`src/lib/toast.ts` was assumed). If not, use whichever utility `src/pages/*.tsx` currently uses for success/error messages.
4. The `convert_quote_to_sale` RPC creates a sale — should it require `ventas.write` OR `presupuestos.write` OR both? Decision in spec: require BOTH, since the action mutates both domains.
