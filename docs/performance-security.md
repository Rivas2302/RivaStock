# Performance and security rollout

This change reduces blocking page dependencies, isolates offline work by signed-in user, and authenticates the email hook. Frontend changes require a Vercel deployment. The email change requires separate Supabase configuration and deployment; it is not activated by deploying Vercel.

## Deploy safely

1. Run `npm ci` and `npm run verify`. Run `npm run test:e2e -- --workers=2` with Playwright Chromium installed (`npx playwright install chromium`).
2. In Supabase Auth Hooks, obtain the signing secret for the existing Send Email hook. Set it as the Edge Function secret `SEND_EMAIL_HOOK_SECRET` using the Supabase dashboard or secure deployment environment. Never store it in source code or a `VITE_` variable.
3. Deploy `send-email` with JWT verification disabled for this **specific hook** (`supabase functions deploy send-email --no-verify-jwt`). Supabase signs these HTTP requests using Standard Webhooks; the handler verifies that signature and timestamp before sending anything. Do not disable JWT verification on the collaborator functions.
4. Verify a recovery email using a controlled test account, including the destination and successful password recovery. A missing signing secret now returns 503 instead of accepting unauthenticated requests. Keep the current function until its secret is configured.
5. Deploy the frontend and `vercel.json` to Vercel. Verify login, Stock, sales, supplier PDFs and tracking. No additional database migration is introduced by this performance/security change.

Official hook configuration: [Supabase Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook).

## Measured changes

Measurements are compressed JavaScript dependency sizes from production builds, not percentage improvements to elapsed loading time.

| Page | Before | After (approximately) | Change |
| --- | ---: | ---: | --- |
| Dashboard | 321 KB | 207 KB | Charts load in their own boundary after the main page can render. |
| Stock | 250 KB | 227 KB | Reseller pricing and barcode labels load on first use. Their state is retained when closed. |

The graph payload is still downloaded when graphs are displayed. The shared application entry remains approximately 199 KB. Authentication now starts profile and collaborator verification together, while retaining authorization checks and cancellation on logout.

Hashed assets receive a one-year immutable cache policy. This policy only covers `/assets/`, not application HTML, private API data or PDFs. Completed database query results are bounded to 128 cache entries; in-flight requests remain deduplicated.

`npm run perf:check` covers every page, including routes renamed to shared chunks by Rollup. It fails when blocking JavaScript or CSS exceeds the configured budget. The Dashboard budget is now 220 KB and Stock 235 KB.

## Security behavior

- Offline queues are namespaced by authenticated actor, not just business owner. Replay checks the session and pins that actor's authorization token. Repeated synchronization calls share one job; Web Locks serialize replay across supported browser tabs. Failed mutations stay queued.
- Old `rivastock:offline-mutations` entries cannot be reliably attributed to a user. They are retained untouched for controlled manual recovery and are **not automatically replayed or counted**. Check for these entries on devices used offline before upgrading; reconcile them with server records before manual recovery. Do not copy them into another user's queue.
- The email endpoint rejects unsigned, tampered and expired webhook requests. It does not log tokens or provider response bodies. Retries carry the signed webhook event ID as the provider idempotency key.
- Production and development dependencies were updated within supported versions, including Vitest 4.1.11. `npm audit` reported zero known advisories on 2026-10-14. This is not a claim that the application has no vulnerabilities.
- HTTPS transport is reinforced with HSTS. Existing frame restrictions remain specific to the configured domains; supplier PDFs continue to use authenticated downloads and local browser previews.

## Verification scope and remaining work

Automated coverage includes SQL isolation, financial consistency, offline actor separation, webhook signatures, session cancellation, anonymous route protection, a 10,000-product fixture and supplier document flows. Browser tests use controlled API responses, not production accounts.

Production RLS policies, applied migration state, backups, MFA settings, Auth rate limits, database query plans and real user latency have **not** been audited remotely. Review those in Supabase before claiming a comprehensive production security assessment. Measure real-user performance before choosing further database indexes or changing pagination semantics.
