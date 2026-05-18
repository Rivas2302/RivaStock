# RESULTS — RivaStock Execution Plan

All issues executed in sprint order. Build passes (`npm run build`) after each sprint commit.

## Sprint 1 — CRITICO (commit: 87d6f47)

| # | Severidad | Módulo | Issue | Estado |
|---|-----------|--------|-------|--------|
| 1 | CRITICO | Orders | Race condition en conversión de pedido a venta — reemplazado con `register_sale` RPC atómico | DONE |
| 2 | CRITICO | QuotePublic | Links públicos de presupuestos rotos por RLS — agregada política anon + vista `public_profiles` | DONE |
| 3 | CRITICO | AuthContext | Cache cross-user leak — `clearDbCache()` en logout y `onAuthStateChange` null | DONE |
| 4 | CRITICO | AuthContext | Duplicación de perfil en race condition de trigger — `loadProfile` con retry backoff | DONE |
| 5 | CRITICO | AuthContext | Login sin verificación de email — check `email_confirmed_at` antes de entrar | DONE |
| 6 | CRITICO | AuthContext | `resetPassword` sin validar sesión de recovery — check de sesión + signOut post-reset | DONE |
| 7 | CRITICO | PublicCatalog | Sin rate limiting en checkout anónimo — RLS valida catálogo + client-side 30s throttle | DONE |
| 8 | CRITICO | db.ts | `crypto.randomUUID()` falla en Safari < 15.4 — `uuid()` con fallback en `utils.ts` | DONE |
| 9 | CRITICO | 0002_rpcs.sql | Casteos redundantes `::text`/`::uuid` y control flow por excepción en `convert_quote_to_sale` | DONE |

## Sprint 2 — ALTO (commit: e1e5022)

| # | Severidad | Módulo | Issue | Estado |
|---|-----------|--------|-------|--------|
| 10 | ALTO | db.ts | `deleteFromStorage` URL parsing frágil — regex robusta con decode | DONE |
| 11 | ALTO | Stock.tsx | Imágenes huérfanas en storage al borrar producto — cleanup en `handleDelete` | DONE |
| 12 | ALTO | utils.ts | `roundPrice` float precision con `%` — integer math (cents) | DONE |
| 13 | ALTO | Quotes.tsx | Descuento sin clamping — `onChange` limita [0, 100] | DONE |
| 14 | ALTO | Quotes.tsx | `generateNumber` con race condition — `next_quote_number` RPC + UNIQUE constraint (migration 0007) | DONE |
| 15 | ALTO | DB | FK ausentes en `sales.product_id` y `stock_intakes.product_id` — migration 0005 | DONE |
| 16 | ALTO | DB | `quotes.client_id` sin FK — migration 0006 | DONE |
| 17 | ALTO | DB | Descuento y totales sin CHECK constraints — migration 0008 | DONE |
| 18 | ALTO | ImageUpload | Sin límite de tamaño de imagen — validación 5MB en `handleFiles` | DONE |

## Sprint 3 — ALTO/MEDIO (commit: 6aa48d6)

| # | Severidad | Módulo | Issue | Estado |
|---|-----------|--------|-------|--------|
| 19 | ALTO | Login.tsx | Sin rate limiting en login — 5 intentos → bloqueo 30s | DONE |
| 20 | MEDIO | utils.ts | `formatDate` timezone fix (UTC vs local) — ya estaba corregido | DONE |
| 21 | MEDIO | Quotes.tsx | `expiresAt` comparado en cliente con clock drift — vista `quotes_with_status` + `effectiveStatus` en tipo | DONE |
| 22 | ALTO | CashFlow.tsx | Editar/borrar entradas vinculadas a venta rompe atomicidad — UI guard + trigger DB (migration 0010) | DONE |
| 23 | MEDIO | — | Sentry ErrorBoundary — SKIP (requiere DSN externo) | SKIPPED |
| 24 | MEDIO | Customers.tsx | `currentBalance` sin reconciliación — RPC `reconcile_customer_balance` + botón UI (migration 0011) | DONE |
| 25 | MEDIO | db.ts | Sin paginación por fecha — `listByDateRange()` agregado a `SupabaseDB` | DONE |

## Sprint 4 — MEDIO/BAJO (commit: 55e7800)

| # | Severidad | Módulo | Issue | Estado |
|---|-----------|--------|-------|--------|
| 26 | ALTO | Modal.tsx | `useEffect` re-registra listener en cada render — `useRef` para `onClose` | DONE |
| 27 | MEDIO | Stock.tsx | `useEffect` sin cancelación en desmonte — cancelled flag + inline async | DONE |
| 28 | MEDIO | Sales.tsx | `useEffect` sin cancelación — cancelled flag | DONE |
| 29 | MEDIO | Quotes.tsx | `useEffect` sin cancelación — cancelled flag | DONE |
| 30 | MEDIO | Customers.tsx | `useEffect` sin cancelación — cancelled flag | DONE |
| 31 | MEDIO | CashFlow.tsx | `useEffect` sin cancelación — cancelled flag | DONE |
| 32 | MEDIO | Orders.tsx | `useEffect` sin cancelación — cancelled flag | DONE |
| 33 | MEDIO | Dashboard.tsx | `useEffect` ya tenía cancelled flag — pre-done | DONE |
| 34 | MEDIO | Sales.tsx | Debounce/throttle en búsqueda — `useDeferredValue` ya presente | DONE |
| 35 | MEDIO | Layout.tsx | Cache no se invalida al volver al foco — `clearDbCache` en focus + visibilitychange | DONE |
| 36 | MEDIO | Dashboard.tsx | KPIs sin null-coalescing pueden dar NaN — `?? 0` en sumas | DONE |
| 37 | MEDIO | ThemeProvider.tsx | Tema no sincroniza entre pestañas — listener `storage` event | DONE |
| 38 | MEDIO | Quotes.tsx | Borrar presupuesto convertido a venta deja venta huérfana — confirm dialog + `delete_sale` RPC | DONE |
| 39 | BAJO | Customers.tsx | Teléfono sin validación — regex `/^[\d+\s\-()]{6,20}$/` | DONE |
| 40 | BAJO | — | Falta `.env.example` — creado en raíz del proyecto | DONE |
| 41 | BAJO | vercel.json | Sin security headers — X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy | DONE |

## Resumen

| Sprint | Issues | DONE | SKIPPED | BLOCKED |
|--------|--------|------|---------|---------|
| 1 | 9 | 9 | 0 | 0 |
| 2 | 9 | 9 | 0 | 0 |
| 3 | 7 | 6 | 1 | 0 |
| 4 | 16 | 15 | 1 | 0 |
| **Total** | **41** | **39** | **2** | **0** |

**SKIPPED:**
- Sprint 3-19: Sentry ErrorBoundary — requiere cuenta/DSN externo, no es codificable sin él.
- Sprint 4-34: Sales `useDeferredValue` — ya estaba implementado, marcado como pre-done.
