# Supabase API key rotation — A1

**Project:** `RivaStock_Oficial` (`nkfqhuqrgrpfufdymkcr`)
**Updated:** 2026-11-02
**Status:** implementation deployed; legacy-key deactivation remains open pending the owner extension refresh (G2) and a replacement for Storage's JWT-only admin authorization.

No API key values belong in this inventory. The project currently has a `default` publishable key and a `default` secret key; the Management API and CLI inventory exposed only their names, types, and IDs for this check.

## Consumer inventory

| Consumer | Previous key path | Migrated path | State |
|---|---|---|---|
| `ai-bridge`, `automation`, `knowledge`, `invite-collaborator`, `delete-collaborator` admin clients | Runtime `SUPABASE_SERVICE_ROLE_KEY` | Shared selector reads `SUPABASE_SECRET_KEYS.default`, or the first configured secret; legacy is a temporary fallback. Each function logs only `key_mode: "secret"` or `"legacy"`. New opaque keys are sent through `apikey`; user JWT authorization headers are preserved. `automation` and `knowledge` additionally use the legacy service-role JWT only for same-project `/storage/v1/` calls. | Deployed; all five emit `key_mode: "secret"`; `automation` v10 and `knowledge` v8 retain `verify_jwt=false`. |
| User scoped clients in `ai-bridge`, `automation`, `invite-collaborator`, and `delete-collaborator` | Runtime `SUPABASE_ANON_KEY` | Shared bundled publishable key | Deployed; authenticated product read returned 200. |
| Web client, Facebook pairing, collaborator calls | `VITE_SUPABASE_ANON_KEY` | `VITE_SUPABASE_PUBLISHABLE_KEY`, then bundled public constant, then the legacy env fallback during rollout | Commit `69ecadd` deployed; served bundle includes `sb_publishable_` and no legacy JWT. |
| Facebook extension `connect.js` and `pairing.js` | Previously accepted publishable keys and legacy `anon` JWTs | Version 0.5.22 accepts only `sb_publishable_`; the trusted RivaStock page can refresh the stored key for the matching Supabase project when no job is active, preserving the device token and ID | Code deployed. The production device still reports 0.5.15 with stale heartbeat; the owner must reload a compatible extension before legacy `anon` can be disabled. |
| `vercel.json` | Embedded `VITE_SUPABASE_ANON_KEY` | Removed; no Vercel key configuration is required | Deployed bundle check passed. |
| AI Bridge worker and local `.env` | Source tree contains no Supabase API-key consumer; it uses its own device token | No API key is needed by the worker | No legacy-key references found in `tools/rivastock-ai-bridge`; no `.env` was found under `%USERPROFILE%\.rivastock-ai-bridge`. |
| `scripts/migrate/3-load.ts`, `4-verify.ts`, `5-link-profiles.ts` | `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SECRET_KEY`; scripts are documented as historical | Local code/docs updated. |
| `scripts/automation-trace-dump.mjs` | Legacy service-role/anon variable names | `SUPABASE_SECRET_KEY` or owner-scoped `SUPABASE_USER_JWT` with a publishable key | Local code updated. |
| Current setup guides | Legacy variable names | Publishable and secret key names | `README.md`, `AI_BRIDGE_SETUP.md`, `DEPLOY_CHECKLIST.md`, `GO_LIVE.md`, and `MIGRATION_CHECKLIST.md` updated. Historical progress reports retain their original names as records. |

## `cli_login_postgres` password

Supabase’s official [CLI login role guidance](https://supabase.com/kb/troubleshooting/permission-denied-when-deleting-the-cli_login_postgres-role) says these temporary role passwords typically expire within a few hundred seconds. A read-only query of `pg_roles` confirmed `rolvaliduntil = 2026-11-02 21:55:39.986916+00` and `password_expired = true` at 21:59:38 UTC. No application consumer uses the database password. The role itself can remain in the catalog and may be recreated by a later CLI command, so it is not deleted with SQL. The old owner action was removed. This follows the [current migration guidance](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys), which requires checking all existing clients before disabling both legacy keys.

## Production rollout

Completed: all five functions use the secret API key for PostgREST; all logged `key_mode: "secret"`; production login/product read, AI Bridge status, and harmless function probes succeeded; served frontend bundle uses the publishable key. A direct production request showed Storage rejects an opaque secret key as a JWT (`Invalid Compact JWS`) and also requires an `Authorization` header. To preserve file downloads, signed URLs, and trace Storage, `automation` v10 and `knowledge` v8 temporarily send the legacy service-role JWT only to the same project's `/storage/v1/` endpoints while retaining the opaque secret in `apikey`. This is a documented **Desvío**: the legacy key remains a server-side Storage consumer and cannot be disabled safely yet. Supabase's official [S3 authentication guide](https://supabase.com/docs/guides/storage/s3/authentication) documents generated S3 access-key pairs for server-side access; use that path to remove the Storage dependency before disabling legacy keys. Also pending: refresh the owner's Facebook extension and verify its recent heartbeat, then disable both legacy API keys through the Management API and immediately repeat the smoke. The Management API switch is project-wide, so do not disable it while the current 0.5.15 extension may still store the legacy `anon` key. If any check fails, re-enable legacy keys before investigating.
