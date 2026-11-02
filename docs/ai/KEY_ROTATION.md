# Supabase API key rotation — A1

**Project:** `RivaStock_Oficial` (`nkfqhuqrgrpfufdymkcr`)
**Updated:** 2026-11-02
**Status:** implementation in progress; production rollout and legacy-key deactivation pending.

No API key values belong in this inventory. The project currently has a `default` publishable key and a `default` secret key; the Management API and CLI inventory exposed only their names, types, and IDs for this check.

## Consumer inventory

| Consumer | Previous key path | Migrated path | State |
|---|---|---|---|
| `ai-bridge`, `automation`, `knowledge`, `invite-collaborator`, `delete-collaborator` admin clients | Runtime `SUPABASE_SERVICE_ROLE_KEY` | Shared selector reads `SUPABASE_SECRET_KEYS.default`, or the first configured secret; legacy is a temporary fallback. Each function logs only `key_mode: "secret"` or `"legacy"`. New opaque keys are sent only through `apikey`; user JWT authorization headers are preserved. | Local code updated; production deploy and mode verification pending. |
| User scoped clients in `ai-bridge`, `automation`, `invite-collaborator`, and `delete-collaborator` | Runtime `SUPABASE_ANON_KEY` | Shared bundled publishable key | Local code updated; production smoke pending. |
| Web client, Facebook pairing, collaborator calls | `VITE_SUPABASE_ANON_KEY` | `VITE_SUPABASE_PUBLISHABLE_KEY`, then bundled public constant, then the legacy env fallback during rollout | Local code updated. |
| Facebook extension `connect.js` and `pairing.js` | Previously accepted publishable keys and legacy `anon` JWTs | Version 0.5.22 accepts only `sb_publishable_`; the trusted RivaStock page can refresh the stored key for the matching Supabase project when no job is active, preserving the device token and ID | Code/tests updated locally. The active production device still reports 0.5.15; G2 is closed until the owner profile runs a compatible extension and sends a recent heartbeat. |
| `vercel.json` | Embedded `VITE_SUPABASE_ANON_KEY` | Removed; no Vercel key configuration is required | Local config updated; deployed bundle check pending. |
| AI Bridge worker and local `.env` | Source tree contains no Supabase API-key consumer; it uses its own device token | No API key is needed by the worker | No legacy-key references found in `tools/rivastock-ai-bridge`; no `.env` was found under `%USERPROFILE%\.rivastock-ai-bridge`. |
| `scripts/migrate/3-load.ts`, `4-verify.ts`, `5-link-profiles.ts` | `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SECRET_KEY`; scripts are documented as historical | Local code/docs updated. |
| `scripts/automation-trace-dump.mjs` | Legacy service-role/anon variable names | `SUPABASE_SECRET_KEY` or owner-scoped `SUPABASE_USER_JWT` with a publishable key | Local code updated. |
| Current setup guides | Legacy variable names | Publishable and secret key names | `README.md`, `AI_BRIDGE_SETUP.md`, `DEPLOY_CHECKLIST.md`, `GO_LIVE.md`, and `MIGRATION_CHECKLIST.md` updated. Historical progress reports retain their original names as records. |

## `cli_login_postgres` password

Supabase’s official [CLI login role guidance](https://supabase.com/kb/troubleshooting/permission-denied-when-deleting-the-cli_login_postgres-role) says these temporary role passwords typically expire within a few hundred seconds. A read-only query of `pg_roles` confirmed `rolvaliduntil = 2026-11-02 21:55:39.986916+00` and `password_expired = true` at 21:59:38 UTC. No application consumer uses the database password. The role itself can remain in the catalog and may be recreated by a later CLI command, so it is not deleted with SQL. The old owner action was removed. This follows the [current migration guidance](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys), which requires checking all existing clients before disabling both legacy keys.

## Production rollout

Still pending: deploy all five functions; verify each reports only `key_mode: "secret"`; push the frontend and confirm the served production bundle uses a publishable key; verify login, a product read, all required functions, Bridge connectivity, and a current Facebook device heartbeat; then disable both legacy API keys through the Management API. The Management API switch is project-wide, so do not disable it while the current 0.5.15 extension still stores the legacy `anon` key. Run the same smoke immediately after disabling. If any check fails, re-enable legacy keys before investigating.
