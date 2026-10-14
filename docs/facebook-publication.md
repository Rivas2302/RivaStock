# Publish approved RivaStock products from Chrome

The local implementation prepares an existing product, persists its approved content and destinations, and processes that queue through the Chrome extension. Marketplace and direct text/photo posts in **Vende de todo - Gral. Pico** are supported. Production migration/deployment and a new real publication through the installed extension remain to be authorized and validated; the earlier real Khamrah test used browser automation, not this queue.

## Install and connect

1. Review `supabase/migrations/0049_facebook_publications.sql`. Apply it after the existing migrations in local/staging first. Production application requires explicit authorization. This migration has not been applied to production.
2. Build/deploy the matching RivaStock interface. Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the repository's `extensions/facebook` folder. No extension build is required. Reload an older installed copy after updating these files.
3. Keep Facebook signed in in that same Chrome profile. As the RivaStock account owner, open **Stock → Publicar en Facebook → Vincular computadora**, then generate the connection code.
4. Open the extension. Enter the public Supabase project URL, its public anon/publishable key, and the code. Never enter a service key or a Facebook password. Grant access to that project and `www.facebook.com` when Chrome asks.
5. Click **Activar cola** in the extension. Pairing initially pauses processing. Chrome must stay running. Use **Pausar cola** to stop taking additional jobs; an already running job finishes or requires attention.

The code expires after five minutes and can be redeemed once. The device capability expires after 30 days. **Desvincular** in RivaStock revokes it on the server; disconnecting the extension only removes its local copy. Heartbeats run every minute and during active work; RivaStock reports a disconnected computer after 150 seconds without a heartbeat.

## Publish a product

From Stock, open **Publicar en Facebook**, review or edit the publication-only title, description and price, select/order up to ten existing photos, and configure category, condition and location. Save the prefilled group if needed. Select Marketplace, the compatible group, or both. The group preview shows the exact text that will be submitted. Check the approval box and press **Confirmar y publicar**.

The original product and stock are not modified. The approved snapshot and each destination are committed atomically. Jobs remain pending while Chrome is disconnected or its queue is paused. Cancel individual pending destinations in publication history. Running jobs cannot be cancelled or blindly retried.

The extension opens its own Facebook tabs and leaves them available for inspection. Results are shown per destination with links when the interface provides verifiable evidence. A created Marketplace listing under review is **Pendiente de aprobación**, not publicly published. A direct group post must match the approved text, current Facebook author and a newly observed post id before it is recorded as published. Administrator approval requirements are not inferred from another successful post.

## Failure and recovery

- Session expiration, verification, restrictions, missing/ambiguous controls, photo failures or unsupported destinations pause the queue and mark the assigned destination **Requiere atención**. Resolve Facebook's verification yourself; the extension does not evade it.
- A submit checkpoint is committed before the final click. A second checkpoint is rejected by the database. If the worker restarts afterward, it checks the existing tab for evidence and never repeats that click.
- A captured result is persisted locally before writing it to the server. A lost acknowledgement retries only that idempotent write. Interrupted server leases become attention after five minutes, never pending.
- Existing Marketplace titles or already visible identical group content stop a new attempt for review. The client also retains its confirmation intent across reopening/reloading. Changed content is refused while that intent exists. Additional publication cycles for the same product are not enabled in this first version.
- Uncertain outcomes are not automatically retried. Inspect the preserved tab and publication history before authorizing any separate publication. Queue approval never authorizes bypassing Facebook restrictions.

## Scope and permissions

Only Marketplace and `https://www.facebook.com/groups/PicoVendedeTodo` (canonical id `710102875717376`) have inspected adapters. Other groups can be saved, but cannot be selected until their forms are verified. The selected mechanism is a direct text/photo group post; it does not share a Marketplace listing or silently select other groups in Marketplace's audience step.

The extension requests storage, alarms and scripting plus optional host access to the configured Supabase project and Facebook. It does not request cookies, general tabs access, all-sites access, passwords or service credentials. Photos must belong to the existing product and be public JPG/PNG/WebP assets in that project's Supabase storage, up to 10 MB each. Device secrets are hashed in a table with no client access. Stock read/write and tenant permissions, including collaborator revocation, are checked when approving, claiming and authorizing the final submission.

Category/condition labels and the photo controls were inspected in the Spanish UI. Marketplace location must be resolved unambiguously to the approved city; the adapter stops if it cannot verify a match. Facebook UI changes can require further inspection. Published results attest to observed UI evidence; the server validates destination ownership and link shape, not external Facebook content through a private API.

## What was actually verified

On October 14, 2026, the user approved **Perfume Khamrah Dukhan (rojo)**, ARS 43,000, new, General Pico, category **Salud y belleza**, its one existing product photo, and both destinations. The public description in RivaStock was empty. The approved text was:

```text
Perfume Khamrah Dukhan (rojo)

Precio: $43.000
Disponible en General Pico.
```

Browser automation uploaded the real photo and submitted each destination once:

| Destination | Verified evidence |
| --- | --- |
| Marketplace | https://www.facebook.com/marketplace/item/1111109635218150/ — seller detail displayed **Esta publicación está en revisión** |
| Direct group post | https://www.facebook.com/groups/PicoVendedeTodo/posts/29224111830556433 — permalink displayed the approved text and photo |

The original product was not edited. These publications already exist: **do not enqueue Khamrah again as an extension test**. This real test establishes the UI workflow, not a successful production queue/extension run.

Local verification also loads the actual MV3 extension into disposable Chromium, injects its real content scripts, uploads real `File` objects to controlled replicas of the inspected forms, processes two approved queue destinations and saves destination-specific evidence. Its Supabase responses and Facebook pages are controlled fixtures, and Facebook DNS is denied. The SQL migration is separately executed in PGlite with authenticated/anonymous roles to test authorization, isolation, immutable snapshots, idempotency, one-time pairing, exclusive claims, submit checkpoints, recovery and destination-matching results.

## Release gate

Run `npm run verify` and `npx playwright test e2e/facebook-publications.spec.ts e2e/facebook-extension.spec.ts`. Review the migration and source, obtain explicit production migration/deployment authorization, install/connect the extension in the real Chrome profile, and validate a **new separately approved product** through the complete queue. That last real extension run is still pending; it must not be represented as complete based on controlled tests.

Chrome API references: [script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting), [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).