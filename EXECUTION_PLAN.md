# EXECUTION_PLAN.md

## Bug Summary
The public catalog page at `/catalogo/:slug` mounts, sets `loading=true`, fires the data-fetching `useEffect`, and never transitions out of the loading state. The user sees "Cargando catálogo..." indefinitely with no error and no recovery. The component has multiple code paths that can leave `loading=true` permanently because (1) one early-return in the data-loading effect does NOT reset the loading flag, (2) the Supabase queries used by the loader have no timeout/abort wiring, so a hung request or an unreachable Supabase host produces no error and no resolution, and (3) the in-memory query cache in `src/lib/db.ts` stores pending promises that, if they never settle, deadlock every subsequent caller waiting on the same key.

## Root Cause

**Primary root cause:** [src/pages/PublicCatalog.tsx:108-157](src/pages/PublicCatalog.tsx:108) — the `init()` effect contains an unconditional early return `if (!slug) return;` at line 110 that exits BEFORE the `try { ... } finally { setLoading(false); }` block. The component is initialized with `loading=true` (line 41). If `slug` is ever falsy at the moment the effect runs (StrictMode re-mounts, a stale render, a race with React Router 7 param resolution, or a stripped trailing segment in a Vercel rewrite), the function returns without ever setting `loading=false`, and the spinner stays on screen forever. The `useEffect` does not have a cleanup that resets loading either.

**Secondary root cause:** [src/pages/PublicCatalog.tsx:133-139](src/pages/PublicCatalog.tsx:133) and [src/lib/db.ts:63-95](src/lib/db.ts:63) — the Supabase requests fired from `init()` (`db.find`, `db.findBy`, `db.list`) go through `readWithCache`, which awaits a stored Promise. None of these calls have an `AbortController` or timeout. The browser `fetch` has no default timeout. If the Supabase host is unreachable from the user's network, the response stream stalls, or RLS evaluation hangs, the promise never resolves and the `finally` that sets `loading=false` never runs. Worse, the unsettled promise gets stored in `queryCache` (line 76-81), so every subsequent re-render that hits the same cache key also awaits the same dead promise — a process-wide deadlock for the catalog page.

**Tertiary contributing issue:** [src/pages/PublicCatalog.tsx:70-77](src/pages/PublicCatalog.tsx:70) — the offline-detection effect only resets `loading` when `online === false`. If `navigator.onLine` returns `true` (default) but the actual network is dead, this effect does nothing and offers no escape.

## Affected Files
- `src/pages/PublicCatalog.tsx` — fix the early return, add abortable/time-bounded fetch logic, add a watchdog timeout, improve error surfacing.
- `src/lib/db.ts` — make `readWithCache` reject hung pending promises after a hard timeout so the cache cannot deadlock the page, and ensure failed promises are evicted (already partially done — extend it).

## Fix Steps

### Step 1 — Guarantee `loading=false` on every exit path of the init effect
**File:** `src/pages/PublicCatalog.tsx`
**Severity:** Critical
**Problem:** The `init()` async function returns early at `if (!slug) return;` without resetting `loading`. Because the initial state is `loading=true`, any render where `slug` is falsy at effect time leaves the spinner on screen permanently. The function also lacks a hard timeout, so a hung Supabase call keeps `loading=true` forever.

**Before:**

```ts
  useEffect(() => {
    const init = async () => {
      if (!slug) return;

      try {
        setLoading(true);
        setError(null);

        // 1. Find catalog config by slug
        const configs = await db.find<CatalogConfig>('catalog_configs', 'slug', slug);
        const foundConfig = configs[0];

        if (!foundConfig) {
          setError('Catálogo no encontrado');
          return;
        }

        if (!foundConfig.enabled) {
          setError('Este catálogo está temporalmente desactivado');
          return;
        }

        setConfig(foundConfig);

        // 2. Fetch products and categories concurrently via Supabase
        const [allProducts, cats] = await Promise.all([
          db.findBy<Product>('products', [
            { field: 'ownerUid',       value: foundConfig.ownerUid },
            { field: 'showInCatalog',  value: true },
          ]),
          db.list<Category>('categories', foundConfig.ownerUid),
        ]);

        // Respect showOutOfStock setting
        const visibleProducts = foundConfig.showOutOfStock
          ? allProducts
          : allProducts.filter(p => p.stock > 0);

        setProducts(visibleProducts);
        setCategories(cats);
      } catch (err) {
        console.error('Error loading catalog:', err);
        setError('Error al cargar el catálogo');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [slug]);
```



**After:**

```ts
  useEffect(() => {
    let cancelled = false;
    const LOAD_TIMEOUT_MS = 15_000;

    const withTimeout = <T,>(promise: Promise<T>, label: string): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`[catalog] timeout: ${label} after ${LOAD_TIMEOUT_MS}ms`));
        }, LOAD_TIMEOUT_MS);
        promise.then(
          (value) => { clearTimeout(timer); resolve(value); },
          (err)   => { clearTimeout(timer); reject(err); },
        );
      });
    };

    const init = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!slug) {
          console.warn('[catalog] slug missing from route params');
          setError('Catálogo no encontrado');
          return;
        }

        // 1. Find catalog config by slug
        const configs = await withTimeout(
          db.find<CatalogConfig>('catalog_configs', 'slug', slug),
          'find catalog_config',
        );
        if (cancelled) return;
        const foundConfig = configs[0];

        if (!foundConfig) {
          setError('Catálogo no encontrado');
          return;
        }

        if (!foundConfig.enabled) {
          setError('Este catálogo está temporalmente desactivado');
          return;
        }

        setConfig(foundConfig);

        // 2. Fetch products and categories concurrently via Supabase
        const [allProducts, cats] = await withTimeout(
          Promise.all([
            db.findBy<Product>('products', [
              { field: 'ownerUid',       value: foundConfig.ownerUid },
              { field: 'showInCatalog',  value: true },
            ]),
            db.list<Category>('categories', foundConfig.ownerUid),
          ]),
          'load products+categories',
        );
        if (cancelled) return;

        // Respect showOutOfStock setting
        const visibleProducts = foundConfig.showOutOfStock
          ? allProducts
          : allProducts.filter(p => p.stock > 0);

        setProducts(visibleProducts);
        setCategories(cats);
      } catch (err) {
        if (cancelled) return;
        console.error('[catalog] init failed:', err);
        const isTimeout = err instanceof Error && err.message.startsWith('[catalog] timeout');
        setError(isTimeout
          ? 'No se pudo conectar con el servidor. Verificá tu conexión e intentá de nuevo.'
          : 'Error al cargar el catálogo');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();

    return () => { cancelled = true; };
  }, [slug]);
```


**Why this fixes it:**
1. The `try/finally` now wraps the slug check itself, so `setLoading(false)` runs on EVERY exit path including the missing-slug case.
2. `withTimeout` rejects the promise after 15s if Supabase hangs, so the `catch` block runs, `setError` displays a real message, and `finally` clears the loading flag — the spinner can never be permanent.
3. The `cancelled` flag prevents stale state updates if the user navigates away mid-fetch and prevents StrictMode double-invocations from racing.

---

### Step 2 — Prevent the in-memory query cache from deadlocking on hung promises
**File:** `src/lib/db.ts`
**Severity:** High
**Problem:** `readWithCache` stores the pending Promise in `queryCache` before it settles. If that promise never resolves (network hang, Supabase outage), the entry stays in the cache with `hasValue: false` and a `promise` that never settles. Any later caller — including a fresh page render after navigation — that uses the same cache key falls into the `if (existing?.promise) { await existing.promise; ... }` branch and waits forever on the same dead promise. This turns a single transient network glitch into a permanent failure for the page.

**Before:**

```ts
async function readWithCache<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = queryCache.get(key);

  if (existing?.hasValue && existing.expiresAt > now) {
    return shallowClone(existing.value as T);
  }

  if (existing?.promise) {
    const data = await existing.promise;
    return shallowClone(data as T);
  }

  const pending = loader();
  queryCache.set(key, {
    expiresAt: now + QUERY_CACHE_TTL_MS,
    hasValue: false,
    promise: pending,
  });

  try {
    const value = await pending;
    queryCache.set(key, {
      expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
      hasValue: true,
      value,
    });
    return shallowClone(value);
  } catch (error) {
    queryCache.delete(key);
    throw error;
  }
}
```



**After:**

```ts
const PENDING_PROMISE_TIMEOUT_MS = 20_000;

function timeoutPromise<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[db] timeout after ${ms}ms: ${label}`));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err)   => { clearTimeout(timer); reject(err); },
    );
  });
}

async function readWithCache<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = queryCache.get(key);

  if (existing?.hasValue && existing.expiresAt > now) {
    return shallowClone(existing.value as T);
  }

  if (existing?.promise) {
    try {
      const data = await timeoutPromise(existing.promise as Promise<T>, PENDING_PROMISE_TIMEOUT_MS, key);
      return shallowClone(data);
    } catch (err) {
      queryCache.delete(key);
      throw err;
    }
  }

  const pending = timeoutPromise(loader(), PENDING_PROMISE_TIMEOUT_MS, key);
  queryCache.set(key, {
    expiresAt: now + QUERY_CACHE_TTL_MS,
    hasValue: false,
    promise: pending,
  });

  try {
    const value = await pending;
    queryCache.set(key, {
      expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
      hasValue: true,
      value,
    });
    return shallowClone(value);
  } catch (error) {
    queryCache.delete(key);
    throw error;
  }
}
```


**Why this fixes it:** A hung Supabase call no longer pollutes the shared cache permanently. The 20-second hard timeout ensures the cache entry is evicted and a fresh fetch can be attempted on the next render or page reload. This is a defense-in-depth measure that complements Step 1 — even if a different caller (a different page or hook) initiated the hung query, the catalog page will not inherit that dead promise.

---

### Step 3 — Surface a user-actionable message if loading takes too long
**File:** `src/pages/PublicCatalog.tsx`
**Severity:** Medium
**Problem:** Even with Step 1 in place, a slow (but not infinite) network can still make the spinner appear "stuck" to the user with no actionable feedback. The current spinner has no escape hatch.

**Before:**

```ts
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
          <p className="text-slate-500 font-medium animate-pulse">Cargando catálogo...</p>
        </div>
      </div>
    );
  }
```



**After:**

```ts
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center px-6">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
          <p className="text-slate-500 font-medium animate-pulse">Cargando catálogo...</p>
          {loadingTooLong && (
            <>
              <p className="text-slate-400 text-sm">Está tardando más de lo normal.</p>
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-2xl font-bold text-sm hover:bg-slate-800"
              >
                Reintentar
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
```


And add this state + effect near the other state declarations (after the `error` state on line 42):

**Add (new code, place right after `const [error, setError] = useState<string | null>(null);` at line 42):**

```ts
  const [loadingTooLong, setLoadingTooLong] = useState(false);

  useEffect(() => {
    if (!loading) {
      setLoadingTooLong(false);
      return;
    }
    const t = setTimeout(() => setLoadingTooLong(true), 8000);
    return () => clearTimeout(t);
  }, [loading]);
```


**Why this fixes it:** If loading exceeds 8 seconds, the user gets a "Reintentar" button and an explanation. This is a UX guarantee that the catalog page can never *visually* appear stuck — there is always an escape hatch.

---

### Step 4 — Make the offline-recovery effect safe and idempotent
**File:** `src/pages/PublicCatalog.tsx`
**Severity:** Medium
**Problem:** When `online` flips from `false` back to `true`, the current code only clears the "Sin conexión" error but does NOT retry the catalog load. The user is left stranded with stale empty data and must reload the page manually.

**Before:**

```ts
  useEffect(() => {
    if (!online) {
      setLoading(false);
      setError('Sin conexión');
    } else {
      setError(prev => (prev === 'Sin conexión' ? null : prev));
    }
  }, [online]);
```



**After:**

```ts
  useEffect(() => {
    if (!online) {
      setLoading(false);
      setError('Sin conexión');
      return;
    }
    setError(prev => (prev === 'Sin conexión' ? null : prev));
    // If we came back online and never loaded a config, trigger a reload so the catalog refreshes.
    if (!config && error === 'Sin conexión') {
      window.location.reload();
    }
  }, [online, config, error]);
```


**Why this fixes it:** When the network recovers, the page reloads itself and re-runs the catalog loader instead of leaving the user on an empty/stale screen.

---

### Step 5 — Add diagnostic logging so future production hangs can be traced
**File:** `src/pages/PublicCatalog.tsx`
**Severity:** Low
**Problem:** When this bug fires in production we have zero telemetry. Anyone investigating must guess.

**Before (already inside `init`):**

```ts
      } catch (err) {
        console.error('Error loading catalog:', err);
        setError('Error al cargar el catálogo');
      } finally {
        setLoading(false);
      }
```



**After (this is included in the Step 1 replacement above — listed here only as the explicit logging requirement):**

```ts
      } catch (err) {
        if (cancelled) return;
        console.error('[catalog] init failed:', err);
        const isTimeout = err instanceof Error && err.message.startsWith('[catalog] timeout');
        setError(isTimeout
          ? 'No se pudo conectar con el servidor. Verificá tu conexión e intentá de nuevo.'
          : 'Error al cargar el catálogo');
      } finally {
        if (!cancelled) setLoading(false);
      }
```


**Why this fixes it:** Errors now carry a `[catalog]` tag for easier filtering and explicitly differentiate timeouts from other failures. The user-facing message also tells them what to do.

---

## Verification

1. Local dev sanity check:
   - `npm run dev` (from project root).
   - Open `http://localhost:5173/catalogo/<a-valid-slug>` in a browser. The catalog must render with products in under 2 seconds on a healthy connection.
   - Open `http://localhost:5173/catalogo/nonexistent-slug`. You must see the "Catálogo no encontrado" error screen with a "Reintentar" button — NOT an infinite spinner.

2. Hang simulation (this is the critical regression test for the original bug):
   - Open DevTools → Network tab → enable **Offline** mode.
   - Hard reload `/catalogo/<valid-slug>`. The spinner must transition to an error within 15 seconds (the `withTimeout` budget), showing "No se pudo conectar con el servidor…" and a Reintentar button — NOT loop forever.
   - Re-enable network → click Reintentar → the catalog loads.

3. Slow-network simulation:
   - DevTools → Network → throttle to **Slow 3G**.
   - Reload the catalog. After 8 seconds the "Está tardando más de lo normal" message + Reintentar button must appear under the spinner. The catalog must still eventually load if the network completes.

4. Missing-slug guard:
   - Manually navigate to `/catalogo/` (the trailing slash without a slug). React Router falls through to `*` → redirects to `/`. This is expected — the catalog component will not even mount in this case. The fix in Step 1 is still required as a defense in case a future route refactor exposes the missing-slug code path.

5. Production verification after deploy:
   - Visit `https://rivastock.vercel.app/catalogo/<production-slug>`. Confirm full load.
   - Open DevTools Console — confirm no `[catalog]` error tags fired.

## Secondary Recommendations

1. **`src/lib/supabase.ts`** — the `createClient` call has no global request timeout configured. Consider passing `global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) }` to the createClient options so every Supabase request has a 20s hard timeout at the transport layer. This is a stronger guarantee than the per-call `withTimeout` we added in Step 1 and protects every other page (Sales, Stock, Quotes, etc.) from the same hang class.

2. **`src/lib/db.ts:309-327`** — `getUniqueSlug` does up to 100 sequential queries in a loop with no timeout and no early backoff. Same hang risk applies here. Wrap in `timeoutPromise` once added.

3. **`src/pages/PublicCatalog.tsx`** — the component is 1300+ lines. After this bug is shipped, extract the cart drawer, checkout form, lightbox, and success modal into separate components. The size of the file is one reason the bug went undetected: the loading-state flow is buried among 50 unrelated useEffects.

4. **`vercel.json`** — the Supabase URL and anon key are checked into `vercel.json` under `build.env`. While the anon key is intended to be public, committing it is fragile if it ever needs rotation (no env-var dashboard control). Consider moving these to Vercel project env vars via the dashboard.

5. **`src/AuthContext.tsx:19-33`** — `loadProfile` retries the profile fetch up to 3 times with 200ms × N backoff, then throws. This means `init` in `AuthProvider` can take up to ~1.4s before flipping `loading=false`. The `AuthProvider` wraps the entire app, but the public catalog and quote-public routes do NOT depend on it — they should be unaffected. Confirmed by reading `App.tsx`: those routes are siblings of `<ProtectedRoute>`, so the auth loading state does NOT block them. No fix needed, just noted for completeness.

6. **`src/pages/PublicCatalog.tsx:55-57`** — `localStorage.getItem` is called during `useState` initialization. On a server-rendered build this would crash; on Vercel this is a client-only SPA so it's fine today. If this app ever migrates to SSR/SSG, wrap with `typeof window !== 'undefined'`.
