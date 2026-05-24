# SDD Init — RivaStock

## Stack
- **Frontend**: React 18 + TypeScript + Vite (PWA)
- **UI**: Tailwind CSS + Lucide React + Motion (Framer Motion)
- **Routing**: React Router v6 (lazy-loaded pages)
- **Backend**: Supabase (PostgreSQL + Auth + Storage + RLS)
- **DB layer**: Custom `src/lib/db.ts` abstraction (cache + RPC invalidations)
- **State**: React Context (`AuthContext`) + custom hooks

## Architecture
- Multi-tenant: all data tables have `user_id` FK → `profiles.id`
- RLS enforced at DB level: `user_id = auth.uid()` on every table
- Migrations in `supabase/migrations/` (sequential SQL, `0001_init.sql` → `0017_...`)
- Types centralized in `src/types.ts`
- Pages in `src/pages/`, components in `src/components/`, hooks in `src/hooks/`
- RPCs for complex mutations (register_sale, delete_sale, intake_stock, etc.)

## Current Auth Model
- `profiles` table: `id`, `email`, `display_name`, `role CHECK('admin','viewer','user')`
- `UserProfile` type: `role: 'admin' | 'viewer'`
- `Collaborator` interface exists in `types.ts` but is NOT implemented
- All RLS policies: `user_id = auth.uid()` — no shared access

## Testing
- **No tests detected** (no jest/vitest config, no test files)
- `strict_tdd: false`

## Conventions
- Migrations: numbered prefix `XXXX_description.sql`
- No ORM — raw SQL in migrations, Supabase JS client in `db.ts`
- RPC functions for transactional operations
- Cache invalidation keyed by table name

## Initialized
2026-05-23
