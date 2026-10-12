# RivaStock performance improvements

Measured frontend improvements are implemented locally. This is **not a guarantee of production response times or completion of every backend optimization**. No production database, deployment, account or uploaded asset was modified.

## Results

Baseline: clean source at commit `8097924`, installed lockfile, Vite production build. Final comparison uses the same default build mode and gzip calculation. Values below are **KiB of JavaScript in the entry + route's static dependency closure**, counted once per file; optional dynamic imports, HTML, CSS, API data and images are excluded. These are payload reductions, not percentage improvements in load time.

| Route | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Shared entry | 316.2 | 196.4 | 38% |
| Login | 317.5 | 197.7 | 38% |
| Dashboard | 459.1 | 319.1 | 30% |
| Stock | 610.9 | 248.4 | 59% |
| Sales | 575.7 | 216.3 | 62% |
| Cash flow | 565.7 | 206.0 | 64% |
| Audit trail | 565.3 | 205.7 | 64% |
| Reports | 564.5 | 319.1 | 43% |
| POS | 442.1 | 212.5 | 52% |
| Intake | 438.9 | 209.3 | 52% |
| Quick price | 435.9 | 206.3 | 53% |
| Customers | 322.1 | 203.0 | 37% |
| Quotes | 326.4 | 207.3 | 36% |
| Orders | 319.0 | 199.8 | 37% |
| Suppliers | 322.2 | 202.4 | 37% |
| Settings | 337.1 | 224.5 | 33% |
| Public catalog | 328.5 | 209.4 | 36% |
| Public product detail | 319.9 | 200.2 | 37% |
| Public quote | 318.4 | 198.6 | 38% |
| Calculator | 320.6 | 200.8 | 37% |
| Forgot password | 317.3 | 197.5 | 38% |
| Reset password | 318.0 | 198.2 | 38% |
| Auth confirmation | 317.1 | 197.3 | 38% |

CSS was not reduced: shared stylesheet remains approximately 19 KiB gzip.

### CPU scaling

Restock recommendation benchmark: deterministic paid/unpaid, itemized and legacy sales; same input and fixed date; five samples after warmup, median wall-clock milliseconds. Outputs were compared with the original implementation and matched exactly for every dataset.

| Products / sales | Original | Indexed implementation |
| --- | ---: | ---: |
| 100 / 100 | 0.504 ms | 0.185 ms |
| 1,000 / 1,000 | 13.354 ms | 1.268 ms |
| 10,000 / 10,000 | 837.622 ms | 11.204 ms |

These are local synthetic CPU measurements, not server benchmarks or browser-wide speedups.

### Mobile browser fixture

One local production-build Chromium run: 390×844 viewport, 4× CPU throttling, 100 ms network latency, 200,000 bytes/s download. Supabase responses were intercepted with 10,000 sanitized synthetic products; external fonts/images were blocked. Mocked API traffic does not represent real Supabase network/database latency. Two test workers shared the machine.

| Measurement | Observed |
| --- | ---: |
| Cold stock useful render (50 rows) | 3,716 ms |
| Warm SPA return to stock | 676 ms |
| FCP | 1,632 ms |
| LCP candidate | 2,532 ms |
| CLS (maximum session window) | 0.1184 |
| Long tasks across the scenario | 14, totaling 1,698 ms |
| Maximum observed Event Timing interaction duration | 24 ms |
| DOM elements at final stock render | 2,588 |

There is no equivalent pre-change mobile run. The interaction value is **not a field INP percentile**. LCP and CLS are still slightly outside the requested 2.5 s / 0.1 targets in this fixture; no production Core Web Vitals compliance is claimed. Browser attachments and timings are available in ignored `test-results/results.json` after E2E execution.

## Changes and safety boundaries

| Work unit | Main files | Behavior / safeguards |
| --- | --- | --- |
| Correct shared chunk boundaries | `vite.config.ts` | Shared `clsx` previously pulled the complete chart vendor into the entry. Explicit shared utility chunk fixes that. Exact React package matching avoids treating `qrcode.react` as core React. Existing route splitting remains. |
| Optional exports | `src/lib/pdfRuntime.ts`, `exportUtils.ts`, `priceListPdf.ts`; export callers | XLSX/PDF imports happen when exporting. Async handlers await completion, reset busy states and handle failures. Mobile PDF tabs are still opened before awaiting to preserve user gestures. |
| Optional scanner | `src/hooks/useBarcodeScanner.ts` | ZXing is imported only when scanning becomes active. Cancellation is checked after import and before camera selection; existing controls/track cleanup remains. |
| Bounded rendering | `src/hooks/usePagination.ts`, `src/components/Pagination.tsx`; Stock, Sales, CashFlow, Customers, Quotes, Orders, AuditTrail, Reports, PublicCatalog | Render 50 rows, or 48 public cards, per page. Filter changes reset the page. Totals, search, selection and exports still use the original loaded dataset, not the displayed page. Product dropdown initially renders 50 options; further options remain accessible. |
| Reduced Stock data | `src/lib/recentSales.ts`, `src/lib/db.ts`, `src/pages/Stock.tsx` | Legacy restock fetches only recent paid-sale quantity fields. Keyset paging exhausts the matching window even with a smaller server row cap. Holdings-mode restock does not fetch sales it does not use. |
| Indexed calculations | `stockIntelligence.ts`, `inventoryHoldings.ts`, `attributedSales.ts`; Stock and Sales | Index ticket quantities, holdings per product and snapshot IDs per sale. Keep authorization-scoped inputs and rounding semantics. Sales attribution no longer recomputes on each search keystroke. |
| Cache race correctness | `src/lib/db.ts` | Invalidated pending reads cannot repopulate cache after logout or replace newer cached results. Existing TTL and mutation invalidation are retained. |
| New upload compression | `src/lib/imageOptimization.ts`, `ImageUpload.tsx`, `Settings.tsx` | Resize eligible new JPEG/static PNG uploads to at most 1,600 px (1,920 px banners), encode actual WebP only if smaller. Decode sequentially; retain originals on failure. Preserve existing WebP, animated PNG and SVG. Extensions match bytes. Existing images/URLs and deletion paths are untouched. Logos remain untouched. |
| Public detail query | `publicCatalog.ts`, `PublicProductPage.tsx`, migration `0046` | Fetch one safe retail product by slug and ID. Retain enabled, tenant, public visibility, catalog-only and stock conditions. Missing-RPC fallback supports frontend-first deployment; other errors are not hidden. Route effect ignores stale responses. |

## Verification

- Baseline: 243 existing unit tests passed; typecheck and production build passed.
- Final: 265 unit tests across 51 files; typecheck and production build passed.
- 22 Chromium E2E tests passed against a **production build**, not Vite development mode.
- Fixtures cover Stock rendering/search with 100, 1,000 and 10,000 products; a bounded public detail request; operational route smoke checks; anonymous route protection; optional tooling absent from login requests.
- Sales regression uses 123 tickets: displays 50/50/23 rows, retains the full total, and verifies all 123 tickets in the downloaded Excel workbook.
- Unit regressions cover date bounds, duplicate ticket quantities, genuine image conversion, animated-image preservation, old-request cache races, lower server paging caps, public detail fallback/security projection and complete loaded-row exports.
- Independent source review found one introduced animation issue, which was fixed and re-reviewed. No remaining actionable findings were reported.
- No live SQL execution/RLS integration test, real camera/device test, authenticated production profiling or production image-size measurement was performed.

## Run and guard against regressions

```sh
npm ci
npm run test
npm run lint
npm run build
npm run perf:bundle
npm run perf:check
npm run perf:restock
npm run test:e2e -- --workers=2
```

`perf:bundle` sums the actual emitted manifest's static dependencies. `perf:check` guards measured gzip budgets: entry 210 KiB; Stock 260; Sales 230; Dashboard/Reports 330; other routes 235; CSS 24. Dynamic export/scanner downloads are intentionally outside page-opening budgets.

For historical CPU comparison, pass an absolute path to the pre-change `stockIntelligence.ts` to `npm run perf:restock -- <path>`; its imports are type-only. No packages were added. E2E uses fake credentials and intercepts fixture API calls; it must not be treated as a deployable build. Build again with the intended deployment environment before releasing.

## Deployment and remaining work

1. Review and apply `supabase/migrations/0046_public_catalog_product_detail.sql` to a safe test database, verify hidden/disabled/cross-tenant/out-of-stock behavior, then promote through the normal release process. **Migration has not been applied.** Until then, detail loading can fall back to the full catalog.
2. Verify deployed query plans, row caps, HTTP cache headers and production cold/warm behavior with authorized accounts and representative histories.
3. Replace lifetime Dashboard/Sales/report/public-list reads with scoped server aggregates, server pagination and dedicated full-export paths. Generic `db.list` is intentionally unchanged: its completeness under production PostgREST caps is still unverified. Display pagination does **not** solve API payload size or guarantee all database rows were loaded.
4. Profile and improve mobile layout shifts, long tasks and first useful render; collect real-user INP/LCP/CLS distributions before claiming targets met.
5. Add thumbnails/backfill only after storage ownership/cleanup and compatibility are specified. New upload compression does not shrink existing objects or create thumbnails.
6. Review authentication refresh waves before changing freshness policy. Permission revocation, transactional consistency and cache TTL were not weakened.
7. Installation audit reported 11 existing dependency vulnerabilities. Review separately rather than applying unverified breaking upgrades as a performance shortcut.

## Rollback

No commits or deployment were made. Review/revert these work units independently rather than resetting unrelated future work. Reverting public-detail frontend code restores the previous full-catalog request; additive migration `0046` can safely remain unused. Reverting image preprocessing affects only future uploads; existing converted WebP objects use already-supported image URLs. Keep async export producers and their callers together when reverting. Restore the previous Vite output policy only if deliberately accepting the larger initial dependency graph.
