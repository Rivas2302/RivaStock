# EXECUTION_PLAN.md

## Bug Summary
Two related production bugs share a common root in [src/AuthContext.tsx](src/AuthContext.tsx) and [src/components/Layout.tsx](src/components/Layout.tsx). **Symptom 1 (random logout):** Supabase fires `onAuthStateChange` on every `INITIAL_SESSION`, `TOKEN_REFRESHED`, and `USER_UPDATED` event (the token-refresh event fires ~every 50 minutes by default). The current handler unconditionally calls `loadProfile(session)` again; if that profile fetch fails transiently (network blip, slow DB, the 10s query-cache stalls, the 3-retry budget exhausts), the handler returns `null` and calls `setUser(null)`. `ProtectedRoute` reads `user === null` and immediately redirects to `/login` — the Supabase session is still perfectly valid, but the UI logs the user out. **Symptom 2 (stale data):** every data-fetching page (Dashboard, Sales, Stock, CashFlow, etc.) uses `useEffect(() => { fetchData() }, [user])` and Layout's `clearDbCache()` on `focus`/`visibilitychange` only wipes the cache without triggering any re-fetch. When the user switches tabs and returns, the cached React state is still the old data; the cache being empty doesn't help because nothing re-runs the fetch effect. The two symptoms are linked: the broken `onAuthStateChange` handler is the only reliable trigger for a re-fetch today (because `setUser` produces a new reference, which changes the `[user]` dependency), so users develop a habit of "refresh to see new data" — and every refresh runs through `loadProfile` again, exposing them to the logout bug.

## Root Causes

### Logout issue
**File:** [src/AuthContext.tsx](src/AuthContext.tsx:62-72)
**Cause:** The `onAuthStateChange` listener treats every event (`SIGNED_IN`, `TOKEN_REFRESHED`, `USER_UPDATED`, `INITIAL_SESSION`, `SIGNED_OUT`) identically: if `session` exists, it re-runs `loadProfile()` and unconditionally `setUser(profile)`. `loadProfile` returns `null` on any error (line 32). So a transient profile-fetch failure during the hourly `TOKEN_REFRESHED` event triggers `setUser(null)` → `<ProtectedRoute>` (`src/App.tsx:46`) sees `!user` and `<Navigate to="/login" />` fires. The user is force-logged-out even though Supabase still has a valid refreshed session in localStorage.

A secondary contributor: `loadProfile` (line 19-33) treats "profile row not found" identically to "network failed" — both return `null`. With the 10s `QUERY_CACHE_TTL_MS` in `db.ts`, a hung promise can poison the cache and make subsequent profile reads fail.

### Stale data issue
**File:** [src/components/Layout.tsx](src/components/Layout.tsx:48-57)
**Cause:** The `focus` and `visibilitychange` listeners call `clearDbCache()` only — they do NOT signal any React component to re-fetch. Pages like `Dashboard.tsx:28-58`, `Sales.tsx:104-126`, `Stock.tsx:64-80`, `CashFlow.tsx`, `Orders.tsx`, `Quotes.tsx`, `Customers.tsx`, `Suppliers.tsx` all have effects shaped like `useEffect(() => { fetchData() }, [user])`. Without a dependency that changes when the tab regains focus, those effects never re-run, so the page keeps showing its in-memory React state. The user must navigate away and back, or hard-reload the page, to observe fresh data.

### Shared root cause
The application has **no central "refresh now" signal**. The `[user]` dep is repurposed (accidentally) as the refetch trigger because Supabase's `onAuthStateChange` produces a new `user` object reference roughly every hour. Fixing the logout (so that `setUser` is no longer called on every token refresh) will eliminate the only re-fetch trigger that currently exists. Both fixes therefore must ship together: stabilize the user reference AND introduce an explicit refetch token in `AuthContext` that pages depend on.

## Affected Files
- `src/AuthContext.tsx` — rewrite `onAuthStateChange` handler; expose `refetchToken` and `refetchData()`; protect against transient `loadProfile` failures.
- `src/lib/supabase.ts` — pass explicit `auth` options to `createClient` for clarity and to set a stable `storageKey`.
- `src/components/Layout.tsx` — replace `clearDbCache()`-only handler with one that also calls `refetchData()`.
- `src/pages/Dashboard.tsx` — depend on `refetchToken` so the page reloads when focus returns.
- `src/pages/Sales.tsx` — depend on `refetchToken`.
- `src/pages/Stock.tsx` — depend on `refetchToken`.
- `src/pages/CashFlow.tsx` — depend on `refetchToken`.
- `src/pages/Orders.tsx` — depend on `refetchToken`.
- `src/pages/Quotes.tsx` — depend on `refetchToken`.
- `src/pages/Customers.tsx` — depend on `refetchToken`.
- `src/pages/Suppliers.tsx` — depend on `refetchToken`.
- `src/pages/Settings.tsx` — depend on `refetchToken`.
- `src/pages/Intake.tsx` — depend on `refetchToken`.

## Fix Steps

### Step 1 — Stop the random logout by isolating the auth listener from profile-fetch failures
**File:** `src/AuthContext.tsx`
**Severity:** Critical
**Problem:** The `onAuthStateChange` handler unconditionally calls `setUser(profile)` after re-running `loadProfile(session)` on every auth event. When `loadProfile` returns `null` (any transient error: network, slow DB, poisoned query cache, missing profile row), `setUser(null)` fires, `<ProtectedRoute>` sees `!user`, and the user is force-redirected to `/login`. Token refresh happens roughly every hour, so this guarantees a logout-per-hour for any user whose network has even one bad request. The listener also re-loads the profile on every event including `TOKEN_REFRESHED`, when the user identity hasn't changed at all — wasteful and the source of the failure window.

**Before:**

```ts
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile } from './types';
import { supabase } from './lib/supabase';
import { db, clearDbCache } from './lib/db';
import type { Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: UserProfile) => void;
  sendResetEmail: (email: string) => Promise<void>;
  resetPassword: (code: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function loadProfile(session: Session): Promise<UserProfile | null> {
  try {
    // Retry up to 3 times with backoff — the auth trigger may not have run yet
    for (let attempt = 0; attempt < 3; attempt++) {
      const profile = await db.get<UserProfile>('users', session.user.id);
      if (profile) return { ...profile, uid: session.user.id };
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
    // Trigger failed or took too long — don't create duplicate; surface error
    throw new Error('No se pudo cargar el perfil. Recargá la página.');
  } catch (err) {
    console.error('[Auth] loadProfile error:', err);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);

  const init = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const profile = await loadProfile(session);
        setUser(profile);
      }
    } catch (err) {
      console.error('[Auth] Init failed:', err);
    } finally {
      setLoading(false);
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!isReady) return;
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session) {
          const profile = await loadProfile(session);
          setUser(profile);
        } else {
          clearDbCache();
          setUser(null);
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [isReady]);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Email o contraseña incorrectos. Por favor verificá tus datos.');
      }
      throw new Error(error.message);
    }
    if (data.user && !data.user.email_confirmed_at) {
      await supabase.auth.signOut();
      throw new Error('Tu email no está verificado. Revisá tu casilla de correo.');
    }
  };

  const logout = async () => {
    clearDbCache();
    await supabase.auth.signOut();
    setUser(null);
  };

  const sendResetEmail = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error('Error al enviar el email de recuperación.');
  };

  const resetPassword = async (_code: string, newPassword: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('Link inválido o vencido. Solicitá un nuevo email de recuperación.');
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      if (error.message.includes('expired') || error.message.includes('Auth')) {
        throw new Error('El link ha expirado. Por favor solicitá uno nuevo.');
      }
      throw new Error('Error al actualizar la contraseña.');
    }
    // Force re-login after reset for security
    await supabase.auth.signOut();
  };

  const updateUser = (updatedUser: UserProfile) => setUser(updatedUser);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, updateUser, sendResetEmail, resetPassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
```



**After:**

```ts
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { UserProfile } from './types';
import { supabase } from './lib/supabase';
import { db, clearDbCache, invalidateDbCache } from './lib/db';
import type { Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  refetchToken: number;
  refetchData: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: UserProfile) => void;
  sendResetEmail: (email: string) => Promise<void>;
  resetPassword: (code: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function loadProfile(session: Session): Promise<UserProfile | null> {
  try {
    // Retry up to 3 times with backoff — the auth trigger may not have run yet
    for (let attempt = 0; attempt < 3; attempt++) {
      const profile = await db.get<UserProfile>('users', session.user.id);
      if (profile) return { ...profile, uid: session.user.id };
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
    throw new Error('No se pudo cargar el perfil. Recargá la página.');
  } catch (err) {
    console.error('[Auth] loadProfile error:', err);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]               = useState<UserProfile | null>(null);
  const [loading, setLoading]         = useState(true);
  const [isReady, setIsReady]         = useState(false);
  const [refetchToken, setRefetchToken] = useState(0);
  const currentUserIdRef              = useRef<string | null>(null);

  const refetchData = useCallback(() => {
    clearDbCache();
    setRefetchToken(t => t + 1);
  }, []);

  const init = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const profile = await loadProfile(session);
        if (profile) {
          currentUserIdRef.current = profile.uid;
          setUser(profile);
        } else {
          // Profile failed to load on initial boot. Keep user null but DO NOT
          // sign out — let the user retry by reloading.
          console.warn('[Auth] Initial profile load failed; user must reload.');
        }
      }
    } catch (err) {
      console.error('[Auth] Init failed:', err);
    } finally {
      setLoading(false);
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!isReady) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Hard logout — only when Supabase explicitly signs out.
        if (event === 'SIGNED_OUT' || !session) {
          currentUserIdRef.current = null;
          clearDbCache();
          setUser(null);
          return;
        }

        // Token refresh / user updated — keep existing user object unless the
        // underlying auth user actually changed (different uid). A profile
        // re-fetch failure here MUST NOT log the user out.
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          // Identity unchanged; nothing to do. Supabase already persisted the
          // refreshed access token to localStorage.
          if (currentUserIdRef.current === session.user.id) return;
          // Edge case: identity changed under the same listener. Fall through
          // to reload profile.
        }

        // INITIAL_SESSION / SIGNED_IN / identity changed: load profile.
        const sameUser = currentUserIdRef.current === session.user.id;
        const profile = await loadProfile(session);

        if (profile) {
          currentUserIdRef.current = profile.uid;
          setUser(profile);
          return;
        }

        // Profile load failed.
        // - If we already had a user with this id, KEEP it — this is a transient
        //   network failure, not a real logout.
        // - If we didn't have a user yet, leave it null; UI will show the
        //   login page or a profile-error state.
        if (sameUser) {
          console.warn('[Auth] Profile re-fetch failed during', event, '— preserving session.');
        } else {
          console.error('[Auth] Profile fetch failed for new session; user not signed in.');
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [isReady]);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Email o contraseña incorrectos. Por favor verificá tus datos.');
      }
      throw new Error(error.message);
    }
    if (data.user && !data.user.email_confirmed_at) {
      await supabase.auth.signOut();
      throw new Error('Tu email no está verificado. Revisá tu casilla de correo.');
    }
  };

  const logout = async () => {
    currentUserIdRef.current = null;
    clearDbCache();
    await supabase.auth.signOut();
    setUser(null);
  };

  const sendResetEmail = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error('Error al enviar el email de recuperación.');
  };

  const resetPassword = async (_code: string, newPassword: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('Link inválido o vencido. Solicitá un nuevo email de recuperación.');
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      if (error.message.includes('expired') || error.message.includes('Auth')) {
        throw new Error('El link ha expirado. Por favor solicitá uno nuevo.');
      }
      throw new Error('Error al actualizar la contraseña.');
    }
    await supabase.auth.signOut();
  };

  const updateUser = (updatedUser: UserProfile) => {
    currentUserIdRef.current = updatedUser.uid;
    invalidateDbCache('users');
    setUser(updatedUser);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, refetchToken, refetchData, login, logout, updateUser, sendResetEmail, resetPassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
```


**Why this fixes it:**
- `currentUserIdRef` tracks the *already-signed-in* user identity. The listener now only writes `setUser(null)` on an explicit `SIGNED_OUT` event or when Supabase itself reports no session — never on a transient profile-load failure.
- `TOKEN_REFRESHED` and `USER_UPDATED` events are no-ops when the user id hasn't changed. The hourly token refresh no longer triggers a profile re-fetch, eliminating the failure window that caused the random logouts.
- On profile-load failure during a `SAME-USER` event, the existing `user` state is preserved and a warning is logged — the user stays signed in.
- `refetchToken` and `refetchData()` are introduced as the proper "refresh now" signal that Step 3 wires into the focus/visibility handlers and that Steps 4-12 wire into each data-fetching page.

---

### Step 2 — Make the Supabase client config explicit (persistence + auto-refresh)
**File:** `src/lib/supabase.ts`
**Severity:** High
**Problem:** `createClient` is called with no `auth` options. While Supabase v2 defaults to `persistSession: true, autoRefreshToken: true, detectSessionInUrl: true`, leaving this implicit is fragile: a future Supabase version, an alternate `storageKey`, or any code path that re-instantiates the client could subtly break session persistence and produce phantom logouts. We also want a stable `storageKey` (independent of project ref) and an idempotent module-level singleton.

**Before:**

```ts
/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

function normalizeSupabaseUrl(value: string | undefined): string {
  const trimmedValue = value?.trim() ?? '';
  if (!trimmedValue) return '';
  if (/^https?:\/\//i.test(trimmedValue)) return trimmedValue;
  return `https://${trimmedValue}`;
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Credentials missing or invalid; set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```



**After:**

```ts
/// <reference types="vite/client" />
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function normalizeSupabaseUrl(value: string | undefined): string {
  const trimmedValue = value?.trim() ?? '';
  if (!trimmedValue) return '';
  if (/^https?:\/\//i.test(trimmedValue)) return trimmedValue;
  return `https://${trimmedValue}`;
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Credentials missing or invalid; set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local');
}

// Module-level singleton — guard against accidental re-instantiation (HMR, tests).
declare global {
  // eslint-disable-next-line no-var
  var __rivastock_supabase__: SupabaseClient | undefined;
}

export const supabase: SupabaseClient =
  globalThis.__rivastock_supabase__ ??
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      storageKey: 'rivastock-auth',
      flowType: 'pkce',
    },
  });

if (typeof window !== 'undefined') {
  globalThis.__rivastock_supabase__ = supabase;
}
```


**Why this fixes it:** Explicit `persistSession: true` and `autoRefreshToken: true` lock in the session-lifetime guarantees. A stable `storageKey: 'rivastock-auth'` means the session survives even if the Supabase project ref changes. The global singleton guard prevents Vite HMR or duplicate imports from creating a second auth instance that would silently lose state.

---

### Step 3 — Replace Layout's cache-only handler with a real refetch signal
**File:** `src/components/Layout.tsx`
**Severity:** Critical
**Problem:** `clearDbCache()` on `focus` / `visibilitychange` empties the query cache but does NOT cause any React component to re-fetch. Pages keep showing the in-memory state from the previous fetch until something else changes (navigation, mount, manual reload). This is the direct cause of "data not loading without manual page refresh."

**Before:**

```ts
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { clearDbCache } from '../lib/db';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ArrowDownCircle,
  Wallet,
  ClipboardList,
  Calculator,
  Settings,
  LogOut,
  Menu,
  X,
  ExternalLink,
  FileText,
  Users,
  Building2
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../AuthContext';

import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
```

(... and ...)

```ts
  useEffect(() => {
    const onFocus = () => clearDbCache();
    const onVisible = () => { if (document.visibilityState === 'visible') clearDbCache(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
```



**After:**

Change the imports — remove `clearDbCache` since `refetchData` (provided by AuthContext) now handles cache-clearing internally:

```ts
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ArrowDownCircle,
  Wallet,
  ClipboardList,
  Calculator,
  Settings,
  LogOut,
  Menu,
  X,
  ExternalLink,
  FileText,
  Users,
  Building2
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../AuthContext';

import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
```

Replace the focus/visibility effect with one that triggers `refetchData` (throttled to once per 10s to avoid storms):

```ts
  const { user, logout, refetchData } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const lastRefetchAtRef = useRef(0);

  useEffect(() => {
    const MIN_REFETCH_INTERVAL_MS = 10_000;
    const maybeRefetch = () => {
      const now = Date.now();
      if (now - lastRefetchAtRef.current < MIN_REFETCH_INTERVAL_MS) return;
      lastRefetchAtRef.current = now;
      refetchData();
    };

    const onFocus = () => maybeRefetch();
    const onVisible = () => {
      if (document.visibilityState === 'visible') maybeRefetch();
    };
    const onOnline = () => maybeRefetch();

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [refetchData]);
```

(Note: the existing `const { user, logout } = useAuth();` at line 44 must be updated to also destructure `refetchData`. The replacement block above already includes that destructure — make sure to remove the original duplicate `const { user, logout } = useAuth();` line.)

**Why this fixes it:** `refetchData()` both clears the cache AND bumps `refetchToken`. Pages that include `refetchToken` in their effect dependencies (Steps 4-12) will re-fetch automatically when the tab regains focus, becomes visible, or the network reconnects. The 10s throttle prevents fetch storms from rapid focus/blur events.

---

### Step 4 — Wire Dashboard to refetch on focus
**File:** `src/pages/Dashboard.tsx`
**Severity:** High
**Problem:** Dashboard's data effect only depends on `[user]`. When user switches tabs, deposits a sale, or comes back, the dashboard shows stale data until the page is re-navigated or manually reloaded.

**Before:**

```ts
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [cashFlow, setCashFlow] = useState<CashFlowEntry[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const fetchData = async () => {
      try {
        const [p, s, cf, o] = await Promise.all([
          db.list<Product>('products', user.uid),
          db.list<Sale>('sales', user.uid),
          db.list<CashFlowEntry>('cash_flow', user.uid),
          db.list<Order>('orders', user.uid),
        ]);
        if (cancelled) return;
        setProducts(p);
        setSales(s);
        setCashFlow(cf);
        setOrders(o);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Dashboard fetch error:', err);
        setError(err instanceof Error ? err.message : 'Error cargando datos');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [user]);
```



**After:**

```ts
  const { user, refetchToken } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [cashFlow, setCashFlow] = useState<CashFlowEntry[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const fetchData = async () => {
      try {
        const [p, s, cf, o] = await Promise.all([
          db.list<Product>('products', user.uid),
          db.list<Sale>('sales', user.uid),
          db.list<CashFlowEntry>('cash_flow', user.uid),
          db.list<Order>('orders', user.uid),
        ]);
        if (cancelled) return;
        setProducts(p);
        setSales(s);
        setCashFlow(cf);
        setOrders(o);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Dashboard fetch error:', err);
        setError(err instanceof Error ? err.message : 'Error cargando datos');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [user, refetchToken]);
```


**Why this fixes it:** When Layout's focus/visibility handler bumps `refetchToken`, this effect re-runs and pulls fresh data.

---

### Step 5 — Wire Sales to refetch on focus
**File:** `src/pages/Sales.tsx`
**Severity:** High
**Problem:** Same as Dashboard.

**Before:**

```ts
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [salesResult, productsResult, customersResult] = await Promise.allSettled([
        db.list<Sale>('sales', user.uid),
        db.list<Product>('products', user.uid),
        db.list<Customer>('customers', user.uid),
      ]);
      if (cancelled) return;
      if (salesResult.status === 'fulfilled') {
        setSales(salesResult.value.sort((a, b) => {
          const dc = b.date.localeCompare(a.date);
          if (dc !== 0) return dc;
          return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
        }));
      }
      if (productsResult.status === 'fulfilled') setProducts(productsResult.value);
      if (customersResult.status === 'fulfilled') setCustomers(customersResult.value);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);
```

Also at line 31, change `const { user } = useAuth();` to read `refetchToken`.

**After:**

At the top of the component (line 31):

```ts
  const { user, refetchToken } = useAuth();
```

And the effect:

```ts
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [salesResult, productsResult, customersResult] = await Promise.allSettled([
        db.list<Sale>('sales', user.uid),
        db.list<Product>('products', user.uid),
        db.list<Customer>('customers', user.uid),
      ]);
      if (cancelled) return;
      if (salesResult.status === 'fulfilled') {
        setSales(salesResult.value.sort((a, b) => {
          const dc = b.date.localeCompare(a.date);
          if (dc !== 0) return dc;
          return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
        }));
      }
      if (productsResult.status === 'fulfilled') setProducts(productsResult.value);
      if (customersResult.status === 'fulfilled') setCustomers(customersResult.value);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, refetchToken]);
```


**Why this fixes it:** Same mechanism as Step 4 — refetch on focus / visibility / network-reconnect events.

---

### Step 6 — Wire Stock to refetch on focus
**File:** `src/pages/Stock.tsx`
**Severity:** High
**Problem:** Same.

**Before:**

```ts
  const { user } = useAuth();
```

```ts
  useEffect(() => {
    let cancelled = false;
    if (!user) return;
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
    return () => { cancelled = true; };
  }, [user]);
```



**After:**

```ts
  const { user, refetchToken } = useAuth();
```

```ts
  useEffect(() => {
    let cancelled = false;
    if (!user) return;
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
    return () => { cancelled = true; };
  }, [user, refetchToken]);
```


**Why this fixes it:** Same pattern.

---

### Step 7 — Wire CashFlow to refetch on focus
**File:** `src/pages/CashFlow.tsx`
**Severity:** High
**Problem:** Same.

**Before:** Find the existing pattern (typically at the top of the component):

```ts
  const { user } = useAuth();
```

And the data-fetching effect with dependency `[user]`.

**After:** Replace the destructure and add `refetchToken` to the effect dep array:

```ts
  const { user, refetchToken } = useAuth();
```

And on the data effect, change:

```ts
  }, [user]);
```

to:

```ts
  }, [user, refetchToken]);
```


**Why this fixes it:** Same mechanism.

---

### Step 8 — Wire Orders to refetch on focus
**File:** `src/pages/Orders.tsx`
**Severity:** High
**Problem:** Same.

**Before:**

```ts
  const { user } = useAuth();
```

…and the matching data-fetch effect ending in `[user]`.

**After:**

```ts
  const { user, refetchToken } = useAuth();
```

…and change `[user]` to `[user, refetchToken]` on the data-fetch effect.

**Why this fixes it:** Same mechanism.

---

### Step 9 — Wire Quotes to refetch on focus
**File:** `src/pages/Quotes.tsx`
**Severity:** High
**Problem:** Same.

**Before:**

```ts
  const { user } = useAuth();
```

…and the matching data-fetch effect ending in `[user]`.

**After:**

```ts
  const { user, refetchToken } = useAuth();
```

…and change `[user]` to `[user, refetchToken]` on the data-fetch effect.

**Why this fixes it:** Same mechanism.

---

### Step 10 — Wire Customers to refetch on focus
**File:** `src/pages/Customers.tsx`
**Severity:** High
**Problem:** Same.

**Before:**

```ts
  const { user } = useAuth();
```

…and the matching data-fetch effect ending in `[user]`.

**After:**

```ts
  const { user, refetchToken } = useAuth();
```

…and change `[user]` to `[user, refetchToken]` on the data-fetch effect.

**Why this fixes it:** Same mechanism.

---

### Step 11 — Wire Suppliers to refetch on focus
**File:** `src/pages/Suppliers.tsx`
**Severity:** High
**Problem:** Same.

**Before:**

```ts
  const { user } = useAuth();
```

…and the matching data-fetch effect ending in `[user]`.

**After:**

```ts
  const { user, refetchToken } = useAuth();
```

…and change `[user]` to `[user, refetchToken]` on the data-fetch effect.

**Why this fixes it:** Same mechanism.

---

### Step 12 — Wire Settings and Intake to refetch on focus
**File:** `src/pages/Settings.tsx` and `src/pages/Intake.tsx`
**Severity:** Medium
**Problem:** Same.

**Before (each file):**

```ts
  const { user } = useAuth();
```

…and the matching data-fetch effect ending in `[user]`.

**After (each file):**

```ts
  const { user, refetchToken } = useAuth();
```

…and change `[user]` to `[user, refetchToken]` on the data-fetch effect.

**Why this fixes it:** Same mechanism. Settings and Intake are lower-traffic but should still refresh when the user returns from another tab to avoid editing stale records.

---

## Verification

### A. Session persistence across tab close / browser restart
1. `npm run dev` and log in at `/login`.
2. Open DevTools → Application → Local Storage → confirm a key `rivastock-auth` exists with a non-empty JSON value containing `access_token`, `refresh_token`, `expires_at`.
3. Close the tab.
4. Re-open `http://localhost:5173/`. You must land on the Dashboard (no redirect to `/login`). The header must show your business name.

### B. The hourly random-logout regression
This is the most important test. The original bug fires when `TOKEN_REFRESHED` arrives with a failing profile fetch. We simulate it manually:
1. Log in.
2. In DevTools Console, run `await window.dispatchEvent(new Event('focus'));` — confirms focus refetch fires but does NOT log you out.
3. Force a token refresh: in DevTools Console, run:
   ```js
   const { data, error } = await window.__rivastock_supabase__.auth.refreshSession();
   console.log({ data, error });
   ```
   Confirm `data.session` is returned and you are still on the Dashboard. No redirect to `/login`.
4. Simulate transient profile-fetch failure during refresh: open DevTools → Network → right-click → Block request URL → block the Supabase REST URL pattern (`*/rest/v1/profiles*`). Then run `await window.__rivastock_supabase__.auth.refreshSession();` again. You must remain on the Dashboard with a console warning `[Auth] Profile re-fetch failed during TOKEN_REFRESHED — preserving session.` — NOT a redirect to `/login`.
5. Remove the network block.

### C. Data freshness without manual refresh
1. Log in, navigate to Sales. Note the number of sales rows.
2. In a second browser tab (or incognito), log in as the same user and create a new sale via the Sales modal.
3. Return to the first tab and click anywhere in the window (this triggers the `focus` event). Within ~1 second the sales list must update to include the new row, without a manual page reload.
4. Repeat for Dashboard — the KPIs and "Ventas Recientes" must update.
5. Network-reconnect test: throttle DevTools network to Offline for 5 seconds, then back online. The current page must refetch its data automatically (the Layout `online` handler fires `refetchData`).

### D. Confirm token refresh no longer triggers gratuitous refetches
1. Log in.
2. In DevTools Network tab, filter by `rest/v1/`.
3. Run `await window.__rivastock_supabase__.auth.refreshSession();`. Observe Network — there should be exactly ONE auth `/token?grant_type=refresh_token` request and ZERO additional `/rest/v1/profiles` requests. (Before the fix, this would have produced a profile fetch.)

### E. SIGNED_OUT still works
1. Log in.
2. In DevTools Console: `await window.__rivastock_supabase__.auth.signOut();`.
3. You must be redirected to `/login` within ~500ms. (Confirms the explicit `SIGNED_OUT` branch still functions.)

## Secondary Recommendations

1. **`src/lib/db.ts:309-327` — `getUniqueSlug` loops up to 100 times** without an abort signal. Combined with the 10s `QUERY_CACHE_TTL_MS`, a slow Supabase response here can stall the Settings page. Wrap each iteration in a 5s timeout and bail out after the first.
2. **`src/lib/db.ts:63-95` — `readWithCache` stores pending promises** that never get evicted if the underlying fetch hangs. Add a hard 20s `timeoutPromise` wrapper around `pending` so a hung query can't poison the cache permanently. (This is the same recommendation that was made for the catalog bug in the previous EXECUTION_PLAN.md — applies here too.)
3. **`src/AuthContext.tsx:104-118` — `resetPassword`** calls `supabase.auth.signOut()` at the end, which will trigger our `SIGNED_OUT` handler and clear all state. That's desired here. No change needed, just verified.
4. **Realtime subscriptions are not used anywhere** in this codebase. If you ever add `supabase.channel(...).subscribe(...)` for live updates (Orders dashboard, Sales notifications), wire it into `AuthContext`'s `refetchToken` increment so a dropped-and-reconnected websocket also triggers a re-fetch. Today there's nothing to clean up because nothing subscribes.
5. **`src/components/Layout.tsx:48-57` — consider adding a `storage` listener** for cross-tab sync: when localStorage `rivastock-auth` changes (the user logged in/out in another tab), reload the page or run `refetchData()`. This prevents two tabs from disagreeing about auth state.
6. **`src/AuthContext.tsx:36-39` — the `loading` flag is set to `true` initially** but is the ONLY thing gating `<ProtectedRoute>`. If `init()` ever throws synchronously before `setLoading(false)`, the user is stuck on the spinner forever. Move `setLoading(false)` into a `try/catch/finally` at the top of `init` so it always runs. (Currently it IS in `finally` — verified safe.)
7. **All page-level data effects share the same skeleton** (`useEffect(() => fetchData(), [user, refetchToken])`). After this fix lands, consider extracting `useOwnedList<T>(table)` and `useOwnedListMany([...])` hooks in `src/hooks/` to remove the boilerplate from every page. Out of scope for this bug, but recommended for the next refactor pass.
8. **`vercel.json` ships the anon key in `build.env`** — fine for the anon role (intended to be public) but rotating it requires a code commit instead of a dashboard click. Move to Vercel project environment variables.
