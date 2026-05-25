# EXECUTION PLAN — Fix Persistent Loading States

Generated: 2026-05-24  
Scope: Eliminate all stuck spinner / stuck loading state bugs across module pages, Team tab, and the logout flow.

---

## 0. Problem Summary

The app gets stuck showing a spinner in three scenarios:
1. **Navigating into certain modules** (Stock, Orders, CashFlow, Quotes, Customers, Intake, Suppliers)
2. **After signing out** (logout flow may fail to navigate if `signOut()` throws)
3. **Opening the "Equipo" tab** inside Settings → Configuración

**Root cause (shared across all three scenarios):**  
`loading` state is set to `true` (or starts as `true`) and `setLoading(false)` is inside an `await` chain without a `finally` block. If the awaited Supabase call throws — which happens whenever the 20-second `AbortSignal.timeout` fires, an RLS violation occurs, or a network error fires — `setLoading(false)` is never reached. The spinner stays forever and requires a manual page refresh.

**Secondary cause (logout):**  
`AuthContext.logout()` calls `setAuth(null)` **after** `await supabase.auth.signOut()`. If `signOut()` rejects, the React state is never updated, the user stays visually logged in, and `navigate('/login')` in the Layout handler is skipped.

---

## 1. State Architecture Overview

| File | Loading pattern | Problem? |
|---|---|---|
| `src/AuthContext.tsx` | Single `loading` useState, set false in `init()` finally | Logout race (see FIX-9) |
| `src/hooks/useTeam.ts` | `useState(true)`, reset in `refetch()` | **CRITICAL — no try/catch/finally** |
| `src/pages/Dashboard.tsx` | `useState(true)`, proper try/catch/finally | ✅ OK |
| `src/pages/Sales.tsx` | `useState(true)`, `Promise.allSettled`, always reaches `setLoading(false)` | ✅ OK |
| `src/pages/Stock.tsx` | `useState(true)`, standalone + inline IIFE | **Missing try/catch/finally in both** |
| `src/pages/Orders.tsx` | `useState(true)`, standalone + inline IIFE | **Missing try/catch/finally in both** |
| `src/pages/CashFlow.tsx` | `useState(true)`, standalone + inline IIFE | **Missing try/catch/finally in both** |
| `src/pages/Quotes.tsx` | `useState(true)`, standalone + inline IIFE | **Missing try/catch/finally in both** |
| `src/pages/Customers.tsx` | `useState(true)`, standalone + inline IIFE | **Missing try/catch/finally in both** |
| `src/pages/Intake.tsx` | `useState(true)`, standalone fetchData, no cancelled guard | **Missing try/catch/finally + no cancelled guard** |
| `src/pages/Settings.tsx` | `useState(true)`, try/catch in both branches | ✅ OK (loading always clears) |
| `src/hooks/useSuppliers.ts` | `useState(true)`, direct `.select()` call | **Missing try/catch/finally** |

---

## 2. Trigger for the "20-second hang"

`src/lib/supabase.ts` configures:
```js
global: {
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }),
}
```

After 20 seconds with no response, `fetch` throws a `DOMException: AbortError`. This bubbles up through `supabase.rpc()`, `supabase.from().select()`, and `db.list()`. Without `try/catch/finally`, any component that was showing a spinner at that moment stays frozen.

`db.list()` (`src/lib/db.ts:180-186`) also throws directly when the Supabase query returns an error:
```js
if (error) throw new Error(`[db.list:${tbl}] ${error.message}`);
```

---

## 3. Fixes (Prioritized)

---

### FIX-1 ★ CRITICAL — `src/hooks/useTeam.ts` — Equipo tab stuck forever

**Lines:** 11–19  
**Root cause:** `refetch()` calls `setLoading(true)` then awaits two RPCs with no `try/catch/finally`. If either RPC throws (network timeout, AbortError, auth error), `setLoading(false)` is never called. The spinner in `TeamTab` freezes forever.  
**Risk:** Low — pure error handling, no logic change.

**Apply this Edit (old_string → new_string):**

```
old_string:
  const refetch = useCallback(async () => {
    setLoading(true);
    const [{ data: collabs }, { data: invs }] = await Promise.all([
      supabase.rpc('list_collaborators'),
      supabase.rpc('list_invitations'),
    ]);
    setCollaborators((collabs ?? []).map(r => fromDb<Collaborator>(r)));
    setInvitations((invs ?? []).map(r => fromDb<Invitation>(r)));
    setLoading(false);
  }, []);

new_string:
  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: collabs, error: e1 }, { data: invs, error: e2 }] = await Promise.all([
        supabase.rpc('list_collaborators'),
        supabase.rpc('list_invitations'),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setCollaborators((collabs ?? []).map(r => fromDb<Collaborator>(r)));
      setInvitations((invs ?? []).map(r => fromDb<Invitation>(r)));
    } catch (err) {
      console.error('[useTeam] refetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);
```

---

### FIX-2 ★ HIGH — `src/pages/Intake.tsx` — Ingresos stuck on navigation

**Lines:** 42–59  
**Root cause:** `fetchData` has no `try/catch/finally`. `useEffect` calls `fetchData()` directly with no cancelled guard. If `db.list()` throws, `setLoading(false)` is never reached. The Ingresos page stays on the spinner.  
**Risk:** Low.

**Apply this Edit (targets lines 42–59):**

```
old_string:
  const fetchData = async () => {
    if (!user) return;
    const [i, p] = await Promise.all([
      db.list<StockIntake>('stock_intakes', user.uid),
      db.list<Product>('products', user.uid)
    ]);
    setIntakes(i.sort((a, b) => {
      const dc = b.date.localeCompare(a.date);
      if (dc !== 0) return dc;
      return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
    }));
    setProducts(p);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user, refetchToken]);

new_string:
  const fetchData = async () => {
    if (!user) return;
    try {
      const [i, p] = await Promise.all([
        db.list<StockIntake>('stock_intakes', user.uid),
        db.list<Product>('products', user.uid),
      ]);
      setIntakes(i.sort((a, b) => {
        const dc = b.date.localeCompare(a.date);
        if (dc !== 0) return dc;
        return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
      }));
      setProducts(p);
    } catch (err) {
      console.error('[Intake] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchData();
  }, [user, refetchToken]);
```

---

### FIX-3 ★ HIGH — `src/pages/Orders.tsx` — Pedidos stuck on navigation

**Two locations in this file.**  
**Root cause:** Both the standalone `fetchData` and the inline IIFE lack `try/catch/finally`.  
**Risk:** Low.

**Edit A — standalone fetchData (lines 35–40):**

```
old_string:
  const fetchData = async () => {
    if (!user) return;
    const o = await db.list<Order>('orders', user.uid);
    setOrders(o.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    setLoading(false);
  };

new_string:
  const fetchData = async () => {
    if (!user) return;
    try {
      const o = await db.list<Order>('orders', user.uid);
      setOrders(o.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (err) {
      console.error('[Orders] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  };
```

**Edit B — inline IIFE inside useEffect (lines 45–50):**

```
old_string:
    (async () => {
      const o = await db.list<Order>('orders', user.uid);
      if (cancelled) return;
      setOrders(o.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setLoading(false);
    })();

new_string:
    (async () => {
      try {
        const o = await db.list<Order>('orders', user.uid);
        if (cancelled) return;
        setOrders(o.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      } catch (err) {
        if (cancelled) return;
        console.error('[Orders] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
```

---

### FIX-4 ★ HIGH — `src/pages/CashFlow.tsx` — Flujo de Caja stuck on navigation

**Two locations.**  
**Root cause:** Same pattern — no `try/catch/finally` in either fetch path.  
**Risk:** Low.

**Edit A — standalone fetchData (lines 72–81):**

```
old_string:
  const fetchData = async () => {
    if (!user) return;
    const cf = await db.list<CashFlowEntry>('cash_flow', user.uid);
    setEntries(cf.sort((a, b) => {
      const dc = b.date.localeCompare(a.date);
      if (dc !== 0) return dc;
      return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
    }));
    setLoading(false);
  };

new_string:
  const fetchData = async () => {
    if (!user) return;
    try {
      const cf = await db.list<CashFlowEntry>('cash_flow', user.uid);
      setEntries(cf.sort((a, b) => {
        const dc = b.date.localeCompare(a.date);
        if (dc !== 0) return dc;
        return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
      }));
    } catch (err) {
      console.error('[CashFlow] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  };
```

**Edit B — inline IIFE inside useEffect (lines 86–95):**

```
old_string:
    (async () => {
      const cf = await db.list<CashFlowEntry>('cash_flow', user.uid);
      if (cancelled) return;
      setEntries(cf.sort((a, b) => {
        const dc = b.date.localeCompare(a.date);
        if (dc !== 0) return dc;
        return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
      }));
      setLoading(false);
    })();

new_string:
    (async () => {
      try {
        const cf = await db.list<CashFlowEntry>('cash_flow', user.uid);
        if (cancelled) return;
        setEntries(cf.sort((a, b) => {
          const dc = b.date.localeCompare(a.date);
          if (dc !== 0) return dc;
          return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
        }));
      } catch (err) {
        if (cancelled) return;
        console.error('[CashFlow] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
```

---

### FIX-5 ★ HIGH — `src/pages/Quotes.tsx` — Presupuestos stuck on navigation

**Two locations.**  
**Root cause:** Same pattern.  
**Risk:** Low.

**Edit A — standalone fetchData (lines 99–110):**

```
old_string:
  const fetchData = async () => {
    if (!user) return;
    const [q, p, c] = await Promise.all([
      db.list<Quote>('quotes', user.uid),
      db.list<Product>('products', user.uid),
      db.list<Customer>('customers', user.uid),
    ]);
    setQuotes(q.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setProducts(p);
    setCustomers(c);
    setLoading(false);
  };

new_string:
  const fetchData = async () => {
    if (!user) return;
    try {
      const [q, p, c] = await Promise.all([
        db.list<Quote>('quotes', user.uid),
        db.list<Product>('products', user.uid),
        db.list<Customer>('customers', user.uid),
      ]);
      setQuotes(q.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setProducts(p);
      setCustomers(c);
    } catch (err) {
      console.error('[Quotes] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  };
```

**Edit B — inline IIFE inside useEffect (lines 115–126):**

```
old_string:
    (async () => {
      const [q, p, c] = await Promise.all([
        db.list<Quote>('quotes', user.uid),
        db.list<Product>('products', user.uid),
        db.list<Customer>('customers', user.uid),
      ]);
      if (cancelled) return;
      setQuotes(q.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setProducts(p);
      setCustomers(c);
      setLoading(false);
    })();

new_string:
    (async () => {
      try {
        const [q, p, c] = await Promise.all([
          db.list<Quote>('quotes', user.uid),
          db.list<Product>('products', user.uid),
          db.list<Customer>('customers', user.uid),
        ]);
        if (cancelled) return;
        setQuotes(q.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setProducts(p);
        setCustomers(c);
      } catch (err) {
        if (cancelled) return;
        console.error('[Quotes] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
```

---

### FIX-6 ★ HIGH — `src/pages/Customers.tsx` — Clientes stuck on navigation

**Two locations.**  
**Root cause:** Same pattern.  
**Risk:** Low.

**Edit A — standalone fetchData (lines 61–66):**

```
old_string:
  const fetchData = async () => {
    if (!user) return;
    const c = await db.list<Customer>('customers', user.uid);
    setCustomers(c.sort((a, b) => a.name.localeCompare(b.name)));
    setLoading(false);
  };

new_string:
  const fetchData = async () => {
    if (!user) return;
    try {
      const c = await db.list<Customer>('customers', user.uid);
      setCustomers(c.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      console.error('[Customers] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  };
```

**Edit B — inline IIFE inside useEffect (lines 71–77):**

```
old_string:
    (async () => {
      const c = await db.list<Customer>('customers', user.uid);
      if (cancelled) return;
      setCustomers(c.sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    })();

new_string:
    (async () => {
      try {
        const c = await db.list<Customer>('customers', user.uid);
        if (cancelled) return;
        setCustomers(c.sort((a, b) => a.name.localeCompare(b.name)));
      } catch (err) {
        if (cancelled) return;
        console.error('[Customers] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
```

---

### FIX-7 ★ HIGH — `src/pages/Stock.tsx` — Stock stuck on navigation

**Two locations.**  
**Root cause:** Same pattern.  
**Risk:** Low.

**Edit A — standalone fetchData (lines 55–65):**

```
old_string:
  const fetchData = async () => {
    if (!user) return;
    const [p, c, pr] = await Promise.all([
      db.list<Product>('products', user.uid),
      db.list<Category>('categories', user.uid),
      db.list<PriceRange>('price_ranges', user.uid)
    ]);
    setProducts(p);
    setCategories(c);
    setPriceRanges(pr);
    setLoading(false);
  };

new_string:
  const fetchData = async () => {
    if (!user) return;
    try {
      const [p, c, pr] = await Promise.all([
        db.list<Product>('products', user.uid),
        db.list<Category>('categories', user.uid),
        db.list<PriceRange>('price_ranges', user.uid),
      ]);
      setProducts(p);
      setCategories(c);
      setPriceRanges(pr);
    } catch (err) {
      console.error('[Stock] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  };
```

**Edit B — inline IIFE inside useEffect (lines 71–82):**

```
old_string:
    (async () => {
      const [p, c, pr] = await Promise.all([
        db.list<Product>('products', user.uid),
        db.list<Category>('categories', user.uid),
        db.list<PriceRange>('price_ranges', user.uid),
      ]);
      if (cancelled) return;
      setProducts(p);
      setCategories(c);
      setPriceRanges(pr);
      setLoading(false);
    })();

new_string:
    (async () => {
      try {
        const [p, c, pr] = await Promise.all([
          db.list<Product>('products', user.uid),
          db.list<Category>('categories', user.uid),
          db.list<PriceRange>('price_ranges', user.uid),
        ]);
        if (cancelled) return;
        setProducts(p);
        setCategories(c);
        setPriceRanges(pr);
      } catch (err) {
        if (cancelled) return;
        console.error('[Stock] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
```

---

### FIX-8 ★ HIGH — `src/hooks/useSuppliers.ts` — Proveedores stuck on navigation

**Lines:** 12–43  
**Root cause:** `fetchSuppliers` awaits `supabase.from().select()` directly. If the request throws (AbortSignal timeout after 20s), `setLoading(false)` is never reached.  
**Risk:** Low.

**Apply this Edit:**

```
old_string:
  const fetchSuppliers = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('suppliers')
      .select('*')
      .eq('user_id', user.uid)
      .order('name_lower');
    if (data) {
      const mapped = data.map((r: Record<string, unknown>) => ({
        id: r.id,
        ownerUid: r.user_id,
        name: r.name,
        nameLower: r.name_lower,
        contactName: r.contact_name,
        phone: r.phone,
        email: r.email,
        address: r.address,
        cuit: r.cuit,
        category: r.category,
        notes: r.notes,
        paymentTerms: r.payment_terms,
        catalogUrl: r.catalog_url,
        facebookUrl: r.facebook_url,
        instagramUrl: r.instagram_url,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      } as Supplier));
      setSuppliers(mapped.sort((a, b) => a.name.localeCompare(b.name)));
    }
    setLoading(false);
  };

new_string:
  const fetchSuppliers = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('user_id', user.uid)
        .order('name_lower');
      if (error) throw error;
      if (data) {
        const mapped = data.map((r: Record<string, unknown>) => ({
          id: r.id,
          ownerUid: r.user_id,
          name: r.name,
          nameLower: r.name_lower,
          contactName: r.contact_name,
          phone: r.phone,
          email: r.email,
          address: r.address,
          cuit: r.cuit,
          category: r.category,
          notes: r.notes,
          paymentTerms: r.payment_terms,
          catalogUrl: r.catalog_url,
          facebookUrl: r.facebook_url,
          instagramUrl: r.instagram_url,
          isActive: r.is_active,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        } as Supplier));
        setSuppliers(mapped.sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (err) {
      console.error('[useSuppliers] fetchSuppliers error:', err);
    } finally {
      setLoading(false);
    }
  };
```

---

### FIX-9 ★ MEDIUM — `src/AuthContext.tsx` — Logout may silently fail and block navigation

**Lines:** 159–165  
**Root cause:** `setAuth(null)` is called AFTER `await supabase.auth.signOut()`. If `signOut()` rejects (network error, timeout), `setAuth(null)` and `setAuthUser(null)` are never called. React state still shows the user as logged in. `navigate('/login')` in `Layout.handleLogout` is never reached because `logout()` threw.  
**Risk:** Low — reorders two state updates before a network call (optimistic logout).

**Apply this Edit:**

```
old_string:
  const logout = async () => {
    currentUserIdRef.current = null;
    clearDbCache();
    await supabase.auth.signOut();
    setAuth(null);
    setAuthUser(null);
  };

new_string:
  const logout = async () => {
    currentUserIdRef.current = null;
    clearDbCache();
    setAuth(null);
    setAuthUser(null);
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[Auth] signOut error (ignored — local state already cleared):', err);
    }
  };
```

**Why this works:**  
Moving `setAuth(null)` before `signOut()` means the React state is immediately logged-out regardless of network status. `ProtectedRoute` will see `user = null` and redirect to `/login`. The `signOut()` call still runs for server-side session cleanup — its failure is non-critical because the local session token will expire naturally.

---

## 4. Verification Steps

### Scenario A — Equipo tab stuck spinner

**Reproduce:**
1. Open DevTools → Network tab → set throttling to "Slow 3G" or check "Offline" mid-request
2. Navigate to Configuración → tab "Equipo"
3. Wait 20+ seconds (or kill the network mid-flight)

**Without fix:** Spinner stays forever.  
**With fix:** Spinner clears after timeout; empty state or error console log appears.

**Quick test (no network needed):**
Open browser console and run before opening the tab:
```js
// Temporarily override fetch to reject immediately
const orig = window.fetch;
window.fetch = () => Promise.reject(new Error('simulated network failure'));
// open Equipo tab — spinner should clear
window.fetch = orig;  // restore
```

---

### Scenario B — Module page stuck spinner

**Reproduce:**
1. Network → Offline
2. Navigate to any of: `/stock`, `/pedidos`, `/caja`, `/presupuestos`, `/clientes`, `/ingresos`, `/proveedores`
3. Wait 20+ seconds

**Without fix:** Full-page spinner stays forever.  
**With fix:** Spinner clears; module renders with empty data or shows a console error.

---

### Scenario C — Logout flow

**Reproduce (simulated):**
1. Open DevTools → Network → Offline
2. Click "Cerrar Sesión"
3. **Without fix:** Nothing happens (button re-enables, user stays on the page)
4. **With fix:** Spinner on button clears, user is immediately redirected to `/login`

**Real-world test:**
1. Log in
2. Click logout
3. Confirm redirect to `/login` with no spinner

---

## 5. Edge Cases to Test

| Edge case | Expected behavior after fix |
|---|---|
| Network goes offline while on a module page | Spinner clears after 20s; module shows previous (empty) state |
| Supabase RLS rejects (403) on load | `db.list()` throws → loading clears, console error logged |
| User navigates away before 20s timeout fires | `cancelled = true` prevents stale state update; no loading stuck |
| Equipo tab opened, network fails mid-RPC | Spinner clears, no data shown |
| Logout while a module fetch is in flight | Module component unmounts; fetch completes silently (React 18 ignores updates on unmounted components) |
| signOut() throws during logout | User is immediately logged out locally (state = null), redirected to `/login` |
| Double-click logout | `loggingOut` guard in `Layout.handleLogout` prevents second call; no race condition |

---

## 6. Files Changed

| File | Changes |
|---|---|
| `src/hooks/useTeam.ts` | Add try/catch/finally + error check to `refetch` |
| `src/pages/Intake.tsx` | Add try/catch/finally to `fetchData` + add `if (!user) return` to useEffect |
| `src/pages/Orders.tsx` | Add try/catch/finally to standalone `fetchData` + inline IIFE |
| `src/pages/CashFlow.tsx` | Add try/catch/finally to standalone `fetchData` + inline IIFE |
| `src/pages/Quotes.tsx` | Add try/catch/finally to standalone `fetchData` + inline IIFE |
| `src/pages/Customers.tsx` | Add try/catch/finally to standalone `fetchData` + inline IIFE |
| `src/pages/Stock.tsx` | Add try/catch/finally to standalone `fetchData` + inline IIFE |
| `src/hooks/useSuppliers.ts` | Add try/catch/finally + error check to `fetchSuppliers` |
| `src/AuthContext.tsx` | Move `setAuth(null)` before `signOut()`, wrap `signOut()` in try/catch |

---

## 7. Pattern to Standardize (for future pages)

All data-fetching useEffects should follow this template:

```typescript
useEffect(() => {
  if (!user) return;
  let cancelled = false;
  (async () => {
    try {
      const result = await db.list<T>('table', user.uid);
      if (cancelled) return;
      setData(result);
    } catch (err) {
      if (cancelled) return;
      console.error('[PageName] fetch error:', err);
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();
  return () => { cancelled = true; };
}, [user, refetchToken]);
```

Standalone `fetchData` used for post-mutation re-fetches:

```typescript
const fetchData = async () => {
  if (!user) return;
  try {
    const result = await db.list<T>('table', user.uid);
    setData(result);
  } catch (err) {
    console.error('[PageName] fetchData error:', err);
  } finally {
    setLoading(false);
  }
};
```

**Key rules:**
1. `setLoading(false)` MUST always be in a `finally` block
2. Inline IIFE: check `if (cancelled) return` inside `catch` AND before state updates
3. For Supabase RPCs returning `{ data, error }`: check `error` before assuming success
4. For auth operations (logout): update local state optimistically BEFORE the network call
