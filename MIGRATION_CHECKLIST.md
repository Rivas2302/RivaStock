# RivaStock — Firebase → Supabase Migration Checklist

Complete these steps in order. Do NOT merge to `main` until step 10 is verified green.

---

## 1 · Supabase Project Setup

- [ ] Create project at supabase.com (region: closest to Argentina, e.g. São Paulo)
- [ ] Note `Project URL` and `anon key` from Settings → API
- [ ] Note `service role key` (keep it secret, only for migration scripts)

## 2 · Apply Database Schema

In Supabase Dashboard → SQL Editor (or via Supabase CLI):

```bash
supabase db push   # if using CLI with supabase/config.toml
# OR copy-paste each migration file manually in the SQL editor:
#   supabase/migrations/0001_init.sql
#   supabase/migrations/0002_rpcs.sql
```

- [ ] `0001_init.sql` executed — all tables, RLS, `handle_new_user` trigger
- [ ] `0002_rpcs.sql` executed — all 7 RPCs (register_sale, edit_sale, etc.)

## 3 · Storage Bucket

In Dashboard → Storage:

- [ ] Create bucket named `assets` (public)
- [ ] Add storage policy: **INSERT/UPDATE/DELETE** for `auth.uid() = storage.foldername(name)[1]`
  ```sql
  -- Example INSERT policy for bucket "assets"
  CREATE POLICY "users upload own assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'assets' AND auth.uid()::text = (storage.foldername(name))[1]);
  ```
  Repeat for UPDATE and DELETE.

## 4 · Create Auth User

In Dashboard → Authentication → Users → Add User:

- [ ] Create user with the owner's email and a temporary password
- [ ] Note the Supabase-assigned UUID (you'll need it for step 6)

## 5 · Configure Environment Variables

Create `.env` at repo root (never commit):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

In Vercel → Project → Settings → Environment Variables:

- [ ] `VITE_SUPABASE_URL`  — Production + Preview
- [ ] `VITE_SUPABASE_ANON_KEY` — Production + Preview
- [ ] Remove any old Firebase variables (`VITE_FIREBASE_*`)

## 6 · Run Migration Scripts

```bash
cd scripts/migrate
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, confirm FIRESTORE_* values
# put firebase-sa.json service account file in this directory
npm install

tsx 1-export.ts       # → dump/*.json
tsx 2-transform.ts    # → transformed/*.json
tsx 3-load.ts         # → upserts into Supabase
tsx 4-verify.ts       # → should exit 0
tsx 5-link-profiles.ts  # links profiles.id to Supabase auth UIDs
```

- [ ] Step 1 completed without errors
- [ ] Step 2 completed without errors
- [ ] Step 3 completed without errors
- [ ] Step 4 exits 0 ("ALL CHECKS PASSED")
- [ ] Step 5 completed — all profiles linked

## 7 · Smoke-Test the App Locally

```bash
npm install   # installs @supabase/supabase-js, removes Firebase packages
npm run dev
```

- [ ] Login works with migrated user
- [ ] Dashboard loads with correct data
- [ ] Create a new sale → stock decreases
- [ ] Toggle sale status → cash flow entry appears
- [ ] Delete a sale → stock restored
- [ ] Register customer payment
- [ ] Convert a quote to sale
- [ ] Upload product image → stored in Supabase Storage
- [ ] Upload logo/banner in Settings → stored in Supabase Storage
- [ ] Public catalog accessible at `/catalogo/<slug>`

## 8 · Deploy to Vercel

```bash
git push origin claude/xenodochial-nash-105e4d
# Create PR → merge to main
```

- [ ] Vercel build passes
- [ ] Production app loads and login works
- [ ] Re-run smoke tests against production URL

## 9 · Firestore Decommission (after production is verified stable)

- [ ] Disable Firestore in Firebase Console → keep project for 30 days in case rollback needed
- [ ] Remove `GOOGLE_APPLICATION_CREDENTIALS` and old Firebase keys from any CI secrets
- [ ] Archive `scripts/migrate/dump/` and `scripts/migrate/transformed/` locally (not in git)

## 10 · Sign-off

- [ ] All smoke tests green in production
- [ ] No errors in Vercel function logs or browser console
- [ ] Product owner confirms data looks correct

---

**Emergency rollback**: The old Firebase app is unchanged — just revert to the last Firebase commit and redeploy.
