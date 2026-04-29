# RivaStock — Firestore → Supabase Migration Scripts

## Prerequisites

- Node.js 20+
- Firebase service account JSON at `./firebase-sa.json`
- Supabase project with schema already applied (run `supabase/migrations/` first)
- Supabase **service role** key (not anon key)

## Setup

```bash
cd scripts/migrate
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, confirm FIRESTORE_* values
npm install
```

## Steps

### Step 1 — Export from Firestore

```bash
tsx 1-export.ts
```

Reads all Firestore collections and writes `dump/<collection>.json`.

### Step 2 — Transform

```bash
tsx 2-transform.ts
```

Converts camelCase fields to snake_case, maps `ownerUid→user_id`, `uid→id` (for profiles),
and Firestore Timestamps to ISO strings. Output: `transformed/<table>.json`.

### Step 3 — Load into Supabase

```bash
tsx 3-load.ts
```

Upserts all rows into Supabase tables in FK-safe order. Safe to re-run.

### Step 4 — Verify

```bash
tsx 4-verify.ts
```

Checks row counts and runs spot-checks (no negative stock, valid sale statuses).

### Step 5 — Link profiles to auth users

This step must be run **after** the human creates auth users in Supabase Dashboard.

For each migrated profile, match by email to find the Supabase auth UUID and update
`profiles.id` + all `user_id` FK references.

```bash
tsx 5-link-profiles.ts
```

## Notes

- `dump/` and `transformed/` are in `.gitignore` — they may contain PII.
- `firebase-sa.json` is also in `.gitignore` — never commit it.
- Use the Supabase **service role** key only for migration; the app uses the anon key.
