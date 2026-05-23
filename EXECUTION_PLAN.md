# EXECUTION_PLAN.md

## Overview

Three independent features are added to RivaStock:

1. **Feature 1 — RBAC (admin / viewer):** A `useRole()` hook reads `user.role` from the existing `profiles` table. Every write action (Plus / Edit / Delete buttons) in Stock, Sales, Quotes, Customers, Suppliers, and CashFlow is guarded with `disabled={isViewer}`. The Settings page becomes admin-only. A new "Colaboradores" tab in Settings lets admins manage invites via a new `collaborators` table. Two new SQL migrations enforce the role at the DB level and fix a trigger bug (new users received `role = 'user'` but TypeScript only accepts `'admin' | 'viewer'`).

2. **Feature 2 — Charts + Export:** Three recharts charts are added to Dashboard (monthly sales bar, stock-by-category pie, monthly net-balance line). A PDF "Exportar reporte" button is added to Dashboard. The placeholder "Exportar CSV" button in Sales is replaced with a real dropdown that exports to `.xlsx` (via the `xlsx` package) and `.pdf` (via `jspdf` + `jspdf-autotable`), both respecting current filters.

3. **Feature 3 — Per-product sharing:** A new public page at `/catalogo/:slug/:productId` shows product details with a carousel and two share actions (copy link + WhatsApp pre-fill). Each product card in the public catalog gains a share icon that opens a mini share menu. Each row in the admin Stock page gains a share icon for products where `showInCatalog === true`.

---

## New dependencies to install

```bash
npm install xlsx jspdf jspdf-autotable
npm install --save-dev @types/jspdf
```

> `recharts` is already installed at `^3.8.1`. No additional install needed for it.

---

## Affected Files

**New files:**
- `src/hooks/useRole.ts`
- `src/pages/PublicProductPage.tsx`
- `supabase/migrations/0018_collaborators.sql`
- `supabase/migrations/0019_role_rls.sql`

**Edited files:**
- `src/App.tsx`
- `src/components/Layout.tsx`
- `src/pages/Stock.tsx`
- `src/pages/Sales.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/Quotes.tsx`
- `src/pages/Customers.tsx`
- `src/pages/Suppliers.tsx`
- `src/pages/CashFlow.tsx`
- `src/pages/Settings.tsx`
- `src/pages/PublicCatalog.tsx`

---

## FEATURE 1 — Role-based access control

### Root cause / gap analysis

| What exists | What is missing |
|-------------|-----------------|
| `profiles.role` column with `'admin'│'viewer'│'user'` | Trigger sets `role = 'user'` for new users; TS type only has `'admin'│'viewer'` |
| `UserProfile.role: UserRole` already in `useAuth()` | No `useRole()` hook exposing `isAdmin`/`isViewer` |
| `Collaborator` type in `types.ts` | No `collaborators` table in DB |
| `ProtectedRoute` in App.tsx | No admin-only route wrapper |
| All pages import `useAuth` | No buttons are guarded for viewers |
| RLS enforces `user_id = auth.uid()` | No RLS blocks writes for viewer role |

---

### Step 1.1 — Create useRole hook

**File:** `src/hooks/useRole.ts`
**Action:** Create
**Severity:** Critical

**After:**

```ts
import { useAuth } from '../AuthContext';

export function useRole() {
  const { user } = useAuth();
  // Treat legacy 'user' role as admin (assigned before RBAC was added)
  const isAdmin = user?.role === 'admin' || user?.role === ('user' as never);
  const isViewer = user?.role === 'viewer';
  return { isAdmin, isViewer };
}
```

**Why:** Single source of truth for role checks; handles the legacy `'user'` value that existing profiles still hold until migration runs.

---

### Step 1.2 — Fix trigger + update existing rows

**File:** `supabase/migrations/0018_collaborators.sql`
**Action:** Create
**Severity:** Critical

**After:**

```sql
-- 0018_collaborators.sql

-- ── Fix: existing profiles with role='user' should be 'admin' ─────────────
UPDATE profiles SET role = 'admin' WHERE role = 'user';

-- ── Fix: trigger sets new users to 'admin' (they own their own business) ──
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, role, currency_symbol, dark_mode, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
    'admin',
    '$',
    false,
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ── Collaborators table ───────────────────────────────────────────────────
CREATE TABLE collaborators (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_uid  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email      text NOT NULL,
  role       text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_uid, email)
);

CREATE INDEX collaborators_owner_uid_idx ON collaborators (owner_uid);

ALTER TABLE collaborators ENABLE ROW LEVEL SECURITY;

-- Only the owner can manage their collaborators list
CREATE POLICY "collaborators_owner" ON collaborators
  USING (owner_uid = auth.uid())
  WITH CHECK (owner_uid = auth.uid());
```

**Why:** Fixes the critical mismatch between DB `'user'` role and TypeScript `UserRole`, and creates the `collaborators` table the Settings UI will read/write.

---

### Step 1.3 — Update RLS to block writes for viewers

**File:** `supabase/migrations/0019_role_rls.sql`
**Action:** Create
**Severity:** Critical

**After:**

```sql
-- 0019_role_rls.sql
-- Replace unified owner policies with split SELECT / write policies.
-- Viewers (role = 'viewer') may SELECT their own data but not INSERT/UPDATE/DELETE.

-- ── Helper: inline role check ─────────────────────────────────────────────
-- We use a subquery instead of a function to avoid cross-schema deps.

-- ── PRODUCTS ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "products_owner" ON products;

CREATE POLICY "products_select" ON products
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "products_insert" ON products
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "products_update" ON products
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "products_delete" ON products
  FOR DELETE USING (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

-- ── CATEGORIES ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "categories_owner" ON categories;

CREATE POLICY "categories_select" ON categories
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "categories_insert" ON categories
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "categories_update" ON categories
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "categories_delete" ON categories
  FOR DELETE USING (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

-- ── PRICE RANGES ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "price_ranges_owner" ON price_ranges;

CREATE POLICY "price_ranges_select" ON price_ranges
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "price_ranges_insert" ON price_ranges
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "price_ranges_update" ON price_ranges
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "price_ranges_delete" ON price_ranges
  FOR DELETE USING (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

-- ── SALES ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sales_owner" ON sales;

CREATE POLICY "sales_select" ON sales
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "sales_insert" ON sales
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "sales_update" ON sales
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "sales_delete" ON sales
  FOR DELETE USING (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

-- ── CASH FLOW ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cash_flow_owner" ON cash_flow;

CREATE POLICY "cash_flow_select" ON cash_flow
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "cash_flow_insert" ON cash_flow
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "cash_flow_update" ON cash_flow
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "cash_flow_delete" ON cash_flow
  FOR DELETE USING (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

-- ── STOCK INTAKES ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "stock_intakes_owner" ON stock_intakes;

CREATE POLICY "stock_intakes_select" ON stock_intakes
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "stock_intakes_insert" ON stock_intakes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "stock_intakes_update" ON stock_intakes
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "stock_intakes_delete" ON stock_intakes
  FOR DELETE USING (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

-- ── CUSTOMERS ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "customers_owner" ON customers;

CREATE POLICY "customers_select" ON customers
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "customers_insert" ON customers
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "customers_update" ON customers
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "customers_delete" ON customers
  FOR DELETE USING (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

-- ── CUSTOMER TRANSACTIONS ────────────────────────────────────────────────
DROP POLICY IF EXISTS "customer_transactions_owner" ON customer_transactions;

CREATE POLICY "customer_transactions_select" ON customer_transactions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "customer_transactions_insert" ON customer_transactions
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "customer_transactions_update" ON customer_transactions
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "customer_transactions_delete" ON customer_transactions
  FOR DELETE USING (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

-- ── QUOTES ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "quotes_owner" ON quotes;

CREATE POLICY "quotes_select" ON quotes
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "quotes_insert" ON quotes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "quotes_update" ON quotes
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "quotes_delete" ON quotes
  FOR DELETE USING (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

-- ── CATALOG CONFIG ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "catalog_config_owner" ON catalog_config;

CREATE POLICY "catalog_config_select" ON catalog_config
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "catalog_config_insert" ON catalog_config
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "catalog_config_update" ON catalog_config
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );

CREATE POLICY "catalog_config_delete" ON catalog_config
  FOR DELETE USING (
    user_id = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) <> 'viewer'
  );
```

**Why:** Prevents viewers from bypassing the UI and writing directly to the DB via the Supabase client or any other tool.

---

### Step 1.4 — Add AdminRoute + new product route to App.tsx

**File:** `src/App.tsx`
**Action:** Edit
**Severity:** High

**Before:**
```tsx
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}
```

**After:**
```tsx
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  if (user.role === 'viewer') return <Navigate to="/" />;
  return <>{children}</>;
}
```

**Why:** `AdminRoute` redirects viewers away from `/config` so they cannot access Settings even by direct URL.

---

**Before (in AppRoutes):**
```tsx
      <Route path="/catalogo/:slug" element={withSuspense(<PublicCatalog />)} />
      <Route path="/presupuesto/:id" element={withSuspense(<QuotePublic />)} />
```

**After:**
```tsx
      <Route path="/catalogo/:slug" element={withSuspense(<PublicCatalog />)} />
      <Route path="/catalogo/:slug/:productId" element={withSuspense(<PublicProductPage />)} />
      <Route path="/presupuesto/:id" element={withSuspense(<QuotePublic />)} />
```

**Why:** Registers the new per-product public page without breaking the existing catalog route.

---

**Before (lazy imports at top of App.tsx):**
```tsx
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
```

**After:**
```tsx
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const PublicProductPage = lazy(() => import('./pages/PublicProductPage'));
```

**Why:** Lazy-loads the new page consistent with the existing pattern.

---

**Before (Settings route):**
```tsx
        <Route path="config" element={withSuspense(<Settings />)} />
```

**After:**
```tsx
        <Route path="config" element={<AdminRoute>{withSuspense(<Settings />)}</AdminRoute>} />
```

**Why:** Enforces the admin-only restriction at the router level.

---

### Step 1.5 — Hide Settings nav item for viewers

**File:** `src/components/Layout.tsx`
**Action:** Edit
**Severity:** Medium

**Before:**
```tsx
import { useAuth } from '../AuthContext';

import { cn } from '../lib/utils';
```

**After:**
```tsx
import { useAuth } from '../AuthContext';
import { useRole } from '../hooks/useRole';

import { cn } from '../lib/utils';
```

---

**Before (inside the `AppRoutes` Layout component's nav rendering — find the nav list render):**
```tsx
export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, refetchData } = useAuth();
```

**After:**
```tsx
export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, refetchData } = useAuth();
  const { isViewer } = useRole();
```

---

Find the section that maps `navItems` to render nav links (it iterates `navItems`). Add a filter before or inside the map:

**Before (the nav items map — exact pattern in the desktop sidebar and mobile menu):**
```tsx
  const navItems: { name: string; path: string; icon: typeof LayoutDashboard }[] = [
    { name: 'Inicio', path: '/', icon: LayoutDashboard },
    { name: 'Stock', path: '/stock', icon: Package },
    { name: 'Ventas', path: '/ventas', icon: ShoppingCart },
    { name: 'Presupuestos', path: '/presupuestos', icon: FileText },
    { name: 'Clientes', path: '/clientes', icon: Users },
    { name: 'Proveedores', path: '/proveedores', icon: Building2 },
    { name: 'Ingresos', path: '/ingresos', icon: ArrowDownCircle },
    { name: 'Flujo de Caja', path: '/caja', icon: Wallet },
    { name: 'Pedidos', path: '/pedidos', icon: ClipboardList },
    { name: 'Calculadora', path: '/calculadora', icon: Calculator },
    { name: 'Configuración', path: '/config', icon: Settings },
  ];
```

**After:**
```tsx
  const allNavItems: { name: string; path: string; icon: typeof LayoutDashboard; adminOnly?: boolean }[] = [
    { name: 'Inicio', path: '/', icon: LayoutDashboard },
    { name: 'Stock', path: '/stock', icon: Package },
    { name: 'Ventas', path: '/ventas', icon: ShoppingCart },
    { name: 'Presupuestos', path: '/presupuestos', icon: FileText },
    { name: 'Clientes', path: '/clientes', icon: Users },
    { name: 'Proveedores', path: '/proveedores', icon: Building2 },
    { name: 'Ingresos', path: '/ingresos', icon: ArrowDownCircle },
    { name: 'Flujo de Caja', path: '/caja', icon: Wallet },
    { name: 'Pedidos', path: '/pedidos', icon: ClipboardList },
    { name: 'Calculadora', path: '/calculadora', icon: Calculator },
    { name: 'Configuración', path: '/config', icon: Settings, adminOnly: true },
  ];
  const navItems = isViewer ? allNavItems.filter(i => !i.adminOnly) : allNavItems;
```

**Why:** Viewers never see the Settings link so they aren't confused by a route they can't access.

---

### Step 1.6 — Guard write actions in Stock.tsx

**File:** `src/pages/Stock.tsx`
**Action:** Edit
**Severity:** Critical

**Before (imports):**
```tsx
import { useAuth } from '../AuthContext';
import { db, deleteFromStorage } from '../lib/db';
```

**After:**
```tsx
import { useAuth } from '../AuthContext';
import { useRole } from '../hooks/useRole';
import { db, deleteFromStorage } from '../lib/db';
```

---

**Before (inside the `Stock` component, after `const { user, refetchToken } = useAuth();`):**
```tsx
  const [products, setProducts] = useState<Product[]>([]);
```

**After:**
```tsx
  const { isViewer } = useRole();
  const [products, setProducts] = useState<Product[]>([]);
```

---

**Before ("Agregar Producto" button):**
```tsx
        <button 
          onClick={() => {
            setEditingProduct(null);
            setIsUploadingImage(false);
            setFormData({
              id: crypto.randomUUID(),
              name: '',
              categoryId: categories[0]?.id || '',
              category: categories[0]?.name || '',
              purchasePrice: 0,
              salePrice: 0,
              stock: 0,
              minStock: 2,
              showInCatalog: true,
              notes: '',
              images: []
            });
            setIsModalOpen(true);
          }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all"
        >
          <Plus size={20} />
          Agregar Producto
        </button>
```

**After:**
```tsx
        <button 
          onClick={() => {
            if (isViewer) return;
            setEditingProduct(null);
            setIsUploadingImage(false);
            setFormData({
              id: crypto.randomUUID(),
              name: '',
              categoryId: categories[0]?.id || '',
              category: categories[0]?.name || '',
              purchasePrice: 0,
              salePrice: 0,
              stock: 0,
              minStock: 2,
              showInCatalog: true,
              notes: '',
              images: []
            });
            setIsModalOpen(true);
          }}
          disabled={isViewer}
          title={isViewer ? 'Solo administradores pueden agregar productos' : undefined}
          className={cn(
            "px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg transition-all",
            isViewer
              ? "bg-slate-300 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none"
              : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20"
          )}
        >
          <Plus size={20} />
          Agregar Producto
        </button>
```

---

**Before (toggle showInCatalog button in the table row):**
```tsx
                  <td className="px-6 py-4">
                    <button 
                      onClick={async () => {
                        await db.update<Product>('products', p.id, { showInCatalog: !p.showInCatalog });
                        fetchData();
                      }}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        p.showInCatalog ? "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      )}
                    >
                      {p.showInCatalog ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </td>
```

**After:**
```tsx
                  <td className="px-6 py-4">
                    <button 
                      onClick={async () => {
                        if (isViewer) return;
                        await db.update<Product>('products', p.id, { showInCatalog: !p.showInCatalog });
                        fetchData();
                      }}
                      disabled={isViewer}
                      title={isViewer ? 'Solo administradores' : (p.showInCatalog ? 'Ocultar del catálogo' : 'Mostrar en catálogo')}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        isViewer && "opacity-40 cursor-not-allowed",
                        !isViewer && p.showInCatalog && "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400",
                        !isViewer && !p.showInCatalog && "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      )}
                    >
                      {p.showInCatalog ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </td>
```

---

**Before (actions cell — Edit and Delete buttons):**
```tsx
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => {
                          setEditingProduct(p);
                          setIsUploadingImage(false);
                          setFormData(p);
                          setIsModalOpen(true);
                        }}
                        className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => handleDelete(p.id)}
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
```

**After:**
```tsx
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {p.showInCatalog && user?.catalogSlug && (
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/catalogo/${user.catalogSlug}/${p.id}`;
                            navigator.clipboard.writeText(url);
                          }}
                          title="Copiar enlace del producto en el catálogo"
                          className="p-2 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                        >
                          <Share2 size={18} />
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          if (isViewer) return;
                          setEditingProduct(p);
                          setIsUploadingImage(false);
                          setFormData(p);
                          setIsModalOpen(true);
                        }}
                        disabled={isViewer}
                        title={isViewer ? 'Solo administradores' : 'Editar'}
                        className={cn(
                          "p-2 transition-colors",
                          isViewer
                            ? "text-slate-300 dark:text-slate-700 cursor-not-allowed"
                            : "text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                        )}
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => { if (isViewer) return; handleDelete(p.id); }}
                        disabled={isViewer}
                        title={isViewer ? 'Solo administradores' : 'Eliminar'}
                        className={cn(
                          "p-2 transition-colors",
                          isViewer
                            ? "text-slate-300 dark:text-slate-700 cursor-not-allowed"
                            : "text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                        )}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
```

**Before (Stock.tsx imports for icons):**
```tsx
import { 
  Plus, 
  Search, 
  Filter, 
  Edit2, 
  Trash2, 
  Eye, 
  EyeOff, 
  Image as ImageIcon,
  Check,
  X,
  ChevronDown
} from 'lucide-react';
```

**After:**
```tsx
import { 
  Plus, 
  Search, 
  Filter, 
  Edit2, 
  Trash2, 
  Eye, 
  EyeOff, 
  Image as ImageIcon,
  Check,
  X,
  ChevronDown,
  Share2
} from 'lucide-react';
```

**Why:** Viewers see the table read-only; the share button lets admins quickly copy a shareable product link without navigating away.

---

### Step 1.7 — Guard write actions in Sales.tsx

**File:** `src/pages/Sales.tsx`
**Action:** Edit
**Severity:** Critical

Apply the same pattern as Stock.tsx:

1. Add `import { useRole } from '../hooks/useRole';` after the `useAuth` import.
2. Add `const { isViewer } = useRole();` inside the `Sales` component after `const { user, refetchToken } = useAuth();`.
3. Guard the **"Nueva Venta"** button (`onClick` opens modal — wrap with `if (isViewer) return;`, add `disabled={isViewer}`, change `className` to use conditional styling matching the Stock pattern).
4. Guard the **toggle status button** (the colored pill badge that calls `handleToggleStatus`): add `disabled={isViewer}` and `title={isViewer ? 'Solo administradores' : ...}`, add `isViewer && "cursor-not-allowed opacity-60"` to its `cn()` call.
5. Guard the **Edit button**: add `disabled={isViewer || hasDerivedSaleItems(s)}` and adjust the disabled-state styling to cover both cases.
6. Guard the **Delete button**: add `disabled={isViewer}`, `onClick={() => { if (isViewer) return; handleDelete(s.id); }}`, and `title={isViewer ? 'Solo administradores' : 'Eliminar'}`.

> The export button replacement is covered in Feature 2 (Step 2.7).

---

### Step 1.8 — Guard write actions in Quotes.tsx

**File:** `src/pages/Quotes.tsx`
**Action:** Edit
**Severity:** Critical

1. Add `import { useRole } from '../hooks/useRole';` after the `useAuth` import.
2. Add `const { isViewer } = useRole();` inside the component.
3. Guard the **"Nuevo Presupuesto"** button: `disabled={isViewer}`, conditional className.
4. Guard each row's **Edit** button (look for `<Edit2 size={18} />`): `disabled={isViewer}`, title, conditional className.
5. Guard each row's **Delete** button (look for `<Trash2 size={18} />`): `disabled={isViewer}`, title, conditional className.
6. Guard the **"Convertir a Venta"** action if it exists in the row: `disabled={isViewer}`.

> The Share2 button (copy/WhatsApp link for quotes) is NOT restricted — viewers can share quotes.

---

### Step 1.9 — Guard write actions in Customers.tsx

**File:** `src/pages/Customers.tsx`
**Action:** Edit
**Severity:** Critical

1. Add `import { useRole } from '../hooks/useRole';` after the `useAuth` import.
2. Add `const { isViewer } = useRole();` inside the component.
3. Guard the **"Nuevo Cliente"** button: `disabled={isViewer}`, conditional className.
4. Guard the **Edit** button per row: `disabled={isViewer}`.
5. Guard the **Delete** button per row: `disabled={isViewer}`.
6. In the customer ficha (detail panel), guard the **payment form submit** button: `disabled={isViewer || savingPayment}`.
7. Guard the **adjustment form submit** button: `disabled={isViewer || savingAdj}`.
8. Guard the **reconcile** button (calls `reconcile_customer_balance` RPC): `disabled={isViewer || reconciling}`.

---

### Step 1.10 — Guard write actions in Suppliers.tsx

**File:** `src/pages/Suppliers.tsx`
**Action:** Edit
**Severity:** Critical

1. Add `import { useRole } from '../hooks/useRole';` after the supplier hook import.
2. Add `const { isViewer } = useRole();` inside the component.
3. Guard the **"Nuevo Proveedor"** button (calls `openNew()`): `disabled={isViewer}`, conditional className.
4. Guard each row's **Edit** button (calls `openEdit(s)`): `disabled={isViewer}`.
5. Guard each row's **Delete** button (calls `deleteSupplier`): `disabled={isViewer}`.
6. Guard the **toggle active** button (calls `toggleSupplierActive`): `disabled={isViewer}`.

---

### Step 1.11 — Guard write actions in CashFlow.tsx

**File:** `src/pages/CashFlow.tsx`
**Action:** Edit
**Severity:** Critical

1. Add `import { useRole } from '../hooks/useRole';` after the `useAuth` import.
2. Add `const { isViewer } = useRole();` inside the component.
3. Guard the **"Nuevo Ingreso"** and **"Nuevo Gasto"** buttons: `disabled={isViewer}`, conditional className.
4. Guard the **toggle status** button per row: `disabled={isViewer || isSaleManagedEntry(entry)}`.
5. Guard each row's **Edit** button: `disabled={isViewer}`.
6. Guard each row's **Delete** button: `disabled={isViewer}`.

---

### Step 1.12 — Add Collaborators tab to Settings.tsx

**File:** `src/pages/Settings.tsx`
**Action:** Edit
**Severity:** High

**Before (type Tab definition):**
```tsx
type Tab = 'general' | 'categories' | 'prices' | 'catalog' | 'maintenance';
```

**After:**
```tsx
type Tab = 'general' | 'categories' | 'prices' | 'catalog' | 'maintenance' | 'colaboradores';
```

---

**Before (imports in Settings.tsx):**
```tsx
import {
  Category,
  PriceRange,
  CatalogConfig,
  UserProfile,
  Product
} from '../types';
```

**After:**
```tsx
import {
  Category,
  PriceRange,
  CatalogConfig,
  UserProfile,
  Product,
  Collaborator
} from '../types';
```

---

Add state for collaborators inside the Settings component, after existing state declarations:

**Before:**
```tsx
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
```

**After:**
```tsx
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Collaborators state
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [newCollabEmail, setNewCollabEmail] = useState('');
  const [newCollabRole, setNewCollabRole] = useState<'viewer' | 'admin'>('viewer');
  const [savingCollab, setSavingCollab] = useState(false);
```

---

Add a `fetchCollaborators` function and call it in the existing `useEffect` that fetches settings data. Find where Settings loads its initial data and add:

```tsx
  const fetchCollaborators = async () => {
    if (!user) return;
    const rows = await db.findBy<Collaborator>('collaborators', [
      { field: 'ownerUid', value: user.uid },
    ]);
    setCollaborators(rows);
  };
```

Call `fetchCollaborators()` inside the existing data-fetching `useEffect`.

---

Add tab navigation entry and the panel. Find where the tabs array/rendering is (look for `activeTab === 'general'` etc.) and add an entry for `'colaboradores'`. Then add the panel:

```tsx
          {activeTab === 'colaboradores' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Colaboradores</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Invitá personas para que accedan a tu negocio en modo lectura.
                </p>
              </div>

              {/* Add collaborator form */}
              <div className="flex gap-3">
                <input
                  type="email"
                  placeholder="Email del colaborador"
                  value={newCollabEmail}
                  onChange={e => setNewCollabEmail(e.target.value)}
                  className="flex-1 px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white text-sm"
                />
                <select
                  value={newCollabRole}
                  onChange={e => setNewCollabRole(e.target.value as 'viewer' | 'admin')}
                  className="px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white text-sm"
                >
                  <option value="viewer">Lector</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  disabled={savingCollab || !newCollabEmail.trim()}
                  onClick={async () => {
                    if (!user || savingCollab || !newCollabEmail.trim()) return;
                    setSavingCollab(true);
                    try {
                      await db.create<Collaborator>('collaborators', {
                        id: crypto.randomUUID(),
                        ownerUid: user.uid,
                        email: newCollabEmail.trim().toLowerCase(),
                        role: newCollabRole,
                        status: 'pending',
                      });
                      setNewCollabEmail('');
                      await fetchCollaborators();
                      setMessage({ text: 'Colaborador agregado', type: 'success' });
                    } catch (err) {
                      setMessage({ text: err instanceof Error ? err.message : 'Error al agregar', type: 'error' });
                    } finally {
                      setSavingCollab(false);
                    }
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {savingCollab ? 'Guardando...' : 'Agregar'}
                </button>
              </div>

              {/* Collaborators list */}
              <div className="space-y-2">
                {collaborators.length === 0 && (
                  <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">
                    No hay colaboradores aún.
                  </p>
                )}
                {collaborators.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white text-sm">{c.email}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {c.role === 'viewer' ? 'Lector' : 'Admin'} ·{' '}
                        <span className={c.status === 'active' ? 'text-emerald-500' : 'text-amber-500'}>
                          {c.status === 'active' ? 'Activo' : 'Pendiente'}
                        </span>
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm(`¿Eliminar colaborador ${c.email}?`)) return;
                        await db.delete('collaborators', c.id);
                        await fetchCollaborators();
                      }}
                      className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                      title="Eliminar colaborador"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
```

Also add `Trash2` to the Settings imports from `lucide-react` if not already there (it is already imported).

Add the tab button in the tabs navigation (find where `'general'`, `'categories'` etc. tabs are rendered and add):

```tsx
              <button
                onClick={() => setActiveTab('colaboradores')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors whitespace-nowrap",
                  activeTab === 'colaboradores'
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400"
                    : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                )}
              >
                <Users size={18} />
                Colaboradores
              </button>
```

Add `Users` to the Settings lucide-react import if not already there.

**Why:** Admin can see and manage who has access to their account without leaving the app.

---

## FEATURE 2 — Reports + Export

### Root cause / gap analysis

| What exists | What is missing |
|-------------|-----------------|
| `recharts ^3.8.1` installed | Zero chart usage in the codebase |
| Dashboard computes KPIs from `sales`, `cashFlow`, `products` | No monthly grouping; no chart data derived |
| Sales has a placeholder "Exportar CSV" button (no handler) | No `xlsx` or `jspdf` installed |
| `filteredSales` is already computed and respects filters | No export function |

---

### Step 2.1 — Install packages

Run in the project root:

```bash
npm install xlsx jspdf jspdf-autotable
```

> `@types/jspdf` is included in `jspdf` itself since v2. No separate `@types` install needed.

---

### Step 2.2 — Add chart data computation to Dashboard.tsx

**File:** `src/pages/Dashboard.tsx`
**Action:** Edit
**Severity:** High

**Before (imports):**
```tsx
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { Product, Sale, CashFlowEntry, Order } from '../types';
import { formatCurrency, cn, roundPrice, formatDate } from '../lib/utils';
```

**After:**
```tsx
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { Product, Sale, CashFlowEntry, Order } from '../types';
import { formatCurrency, cn, roundPrice, formatDate } from '../lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FileDown } from 'lucide-react';
```

---

Add three new `useMemo` blocks inside the `Dashboard` component, after the existing `{ kpis, lowStockProducts, recentSales }` memo. Insert them before the `if (loading)` guard:

**Before:**
```tsx
  if (loading) return <div className="animate-pulse space-y-8">
```

**After:**
```tsx
  const monthlySalesData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
      const total = sales
        .filter(s => s.status === 'Pagado' && s.date.startsWith(monthKey))
        .reduce((acc, s) => acc + s.total, 0);
      return { label, total };
    });
  }, [sales]);

  const stockByCategoryData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) {
      if (!map[p.category]) map[p.category] = 0;
      map[p.category] += roundPrice(p.salePrice) * p.stock;
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [products]);

  const monthlyBalanceData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
      let income = 0;
      let expense = 0;
      for (const entry of cashFlow) {
        if (!entry.date.startsWith(monthKey) || entry.status !== 'Pagado') continue;
        if (entry.type === 'Ingreso') income += entry.amount;
        else expense += entry.amount;
      }
      return { label, balance: income - expense };
    });
  }, [cashFlow]);

  const PIE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];

  const handleExportDashboardPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(`${user?.businessName || 'Mi Negocio'} — Panel de Control`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Generado: ${new Date().toLocaleDateString('es-AR')}`, 14, 28);

    autoTable(doc, {
      startY: 35,
      head: [['Indicador', 'Valor']],
      body: kpis.map(k => [
        k.title,
        k.isCurrency === false ? String(k.value) : formatCurrency(k.value as number),
      ]),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [99, 102, 241] },
    });

    const afterKpi = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    doc.setFontSize(13);
    doc.text('Ventas por mes (últimos 6 meses)', 14, afterKpi);
    autoTable(doc, {
      startY: afterKpi + 5,
      head: [['Mes', 'Ventas cobradas']],
      body: monthlySalesData.map(d => [d.label, formatCurrency(d.total)]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [99, 102, 241] },
    });

    doc.save(`panel-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  if (loading) return <div className="animate-pulse space-y-8">
```

---

### Step 2.3 — Add charts and export button to Dashboard JSX

**File:** `src/pages/Dashboard.tsx`
**Action:** Edit
**Severity:** High

**Before (the page header inside the return):**
```tsx
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Panel de Control</h2>
        <p className="text-slate-500 dark:text-slate-400">Resumen general de tu negocio</p>
      </div>
```

**After:**
```tsx
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Panel de Control</h2>
          <p className="text-slate-500 dark:text-slate-400">Resumen general de tu negocio</p>
        </div>
        <button
          onClick={handleExportDashboardPDF}
          className="hidden md:flex items-center gap-2 px-4 py-2.5 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <FileDown size={18} />
          Exportar reporte PDF
        </button>
      </div>
```

---

**Before (the grid with Recent Sales and Low Stock Alerts):**
```tsx
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Sales */}
```

**After (insert the three chart panels between the KPI grid and the existing two-column grid):**
```tsx
      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Sales Bar Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <h3 className="font-bold text-slate-900 dark:text-white mb-4">Ventas cobradas por mes</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlySalesData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => formatCurrency(v)} tick={{ fontSize: 10 }} width={72} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="total" fill="#6366f1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Stock by Category Pie */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <h3 className="font-bold text-slate-900 dark:text-white mb-4">Valor en stock por categoría</h3>
          {stockByCategoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={stockByCategoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                >
                  {stockByCategoryData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend
                  formatter={(value) => <span className="text-xs text-slate-600 dark:text-slate-400">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm">Sin datos</div>
          )}
        </div>
      </div>

      {/* Net Balance Line Chart */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 className="font-bold text-slate-900 dark:text-white mb-4">Balance neto mensual</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={monthlyBalanceData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => formatCurrency(v)} tick={{ fontSize: 10 }} width={72} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Line
              type="monotone"
              dataKey="balance"
              stroke="#6366f1"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#6366f1' }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Sales */}
```

**Why:** Three charts give the business owner an instant visual summary without navigating to Sales or CashFlow.

---

### Step 2.4 — Replace export placeholder in Sales.tsx and add Excel/PDF export

**File:** `src/pages/Sales.tsx`
**Action:** Edit
**Severity:** High

**Before (imports):**
```tsx
import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
```

**After:**
```tsx
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
```

---

Add export library imports after the existing imports:

**Before:**
```tsx
import {
  getSaleDisplayQuantity,
  hasDerivedSaleItems,
  isPendingSaleStatus,
} from '../lib/sales';
```

**After:**
```tsx
import {
  getSaleDisplayQuantity,
  hasDerivedSaleItems,
  isPendingSaleStatus,
} from '../lib/sales';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
```

---

Add state and refs for the export dropdown inside the `Sales` component, after the existing state declarations:

**Before:**
```tsx
  const filteredCreditCustomers = useMemo(() => {
```

**After:**
```tsx
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  const handleExportExcel = () => {
    const data = filteredSales.map(s => ({
      'Fecha': formatDate(s.date),
      'Producto': s.productName,
      'Cliente': s.client || '-',
      'Cantidad': getSaleDisplayQuantity(s),
      'Precio Unitario': roundPrice(s.unitPrice),
      'Ajuste': s.adjustment ?? 0,
      'Total': roundPrice(s.total),
      'Método de Pago': s.paymentMethod || '-',
      'Estado': s.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
    XLSX.writeFile(wb, `ventas-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setShowExportMenu(false);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Reporte de Ventas', 14, 20);
    doc.setFontSize(10);
    doc.text(`Generado: ${new Date().toLocaleDateString('es-AR')}`, 14, 28);
    if (statusFilter !== 'all' || search) {
      doc.text(`Filtros: estado="${statusFilter}" búsqueda="${search}"`, 14, 34);
    }
    autoTable(doc, {
      startY: statusFilter !== 'all' || search ? 40 : 35,
      head: [['Fecha', 'Producto', 'Cliente', 'Cant.', 'Total', 'Estado']],
      body: filteredSales.map(s => [
        formatDate(s.date),
        s.productName,
        s.client || '-',
        String(getSaleDisplayQuantity(s)),
        formatCurrency(roundPrice(s.total)),
        s.status,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [99, 102, 241] },
    });
    doc.save(`ventas-${new Date().toISOString().slice(0, 10)}.pdf`);
    setShowExportMenu(false);
  };

  const filteredCreditCustomers = useMemo(() => {
```

---

**Before (the placeholder export button):**
```tsx
          <button className="hidden md:flex items-center gap-2 px-4 py-2.5 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            <Download size={20} />
            Exportar CSV
          </button>
```

**After:**
```tsx
          <div className="relative hidden md:block" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(v => !v)}
              className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Download size={20} />
              Exportar
              <ChevronDown size={16} />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg z-20 overflow-hidden">
                <button
                  onClick={handleExportExcel}
                  className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-3"
                >
                  <FileSpreadsheet size={16} className="text-emerald-600" />
                  Exportar Excel (.xlsx)
                </button>
                <button
                  onClick={handleExportPDF}
                  className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-3 border-t border-slate-100 dark:border-slate-800"
                >
                  <FileDown size={16} className="text-rose-600" />
                  Exportar PDF
                </button>
              </div>
            )}
          </div>
```

Add `FileSpreadsheet` and `FileDown` to the lucide-react import in Sales.tsx:

**Before:**
```tsx
import {
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Download,
  CheckCircle2,
  Clock,
  ChevronDown,
  ShoppingCart,
  UserCheck,
  UserPlus,
  X
} from 'lucide-react';
```

**After:**
```tsx
import {
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Download,
  CheckCircle2,
  Clock,
  ChevronDown,
  ShoppingCart,
  UserCheck,
  UserPlus,
  X,
  FileSpreadsheet,
  FileDown,
} from 'lucide-react';
```

**Why:** Export respects whatever filters the user has active (date, status, search), so the downloaded file matches exactly what is visible on screen.

---

## FEATURE 3 — Per-product sharing

### Root cause / gap analysis

| What exists | What is missing |
|-------------|-----------------|
| Public catalog at `/catalogo/:slug` — list only | Individual product pages |
| `products_catalog_public` RLS allows unauthenticated SELECT for `show_in_catalog=true` | No public product fetch function |
| Quote share pattern: copy link + WhatsApp (`Quotes.tsx:366-379`) | No product-level share button in catalog or admin |
| `CatalogConfig.whatsappNumber` already stored | No per-product WhatsApp share message |
| `Product.images[]` supports multiple images | No carousel on product detail page |

---

### Step 3.1 — Add product route in App.tsx

Already covered in Step 1.4 (`/catalogo/:slug/:productId` route + lazy import). No additional changes needed here.

---

### Step 3.2 — Create PublicProductPage.tsx

**File:** `src/pages/PublicProductPage.tsx`
**Action:** Create
**Severity:** Critical

**After:**

```tsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fromDb } from '../lib/db';
import { Product, CatalogConfig } from '../types';
import { formatCurrency, cn, roundPrice } from '../lib/utils';
import {
  ArrowLeft,
  Copy,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Check,
  ShoppingBag,
} from 'lucide-react';

export default function PublicProductPage() {
  const { slug, productId } = useParams<{ slug: string; productId: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [config, setConfig] = useState<CatalogConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (!slug || !productId) {
        setError('Producto no encontrado');
        setLoading(false);
        return;
      }

      const [catalogRes, productRes] = await Promise.all([
        supabase
          .from('catalog_config')
          .select('*')
          .eq('slug', slug)
          .eq('enabled', true)
          .limit(1),
        supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .eq('show_in_catalog', true)
          .single(),
      ]);

      const catalogRow = catalogRes.data?.[0];
      const productRow = productRes.data;

      if (!catalogRow || !productRow) {
        setError('Producto no encontrado');
        setLoading(false);
        return;
      }

      // Verify the product belongs to this catalog
      if (productRow.user_id !== catalogRow.user_id) {
        setError('Producto no encontrado');
        setLoading(false);
        return;
      }

      setConfig(fromDb<CatalogConfig>(catalogRow));
      setProduct(fromDb<Product>(productRow));
      setLoading(false);
    };

    init().catch(() => {
      setError('Error al cargar el producto');
      setLoading(false);
    });
  }, [slug, productId]);

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleWhatsApp = () => {
    if (!product || !config) return;
    const price = config.showPrices ? ` — ${formatCurrency(roundPrice(product.salePrice))}` : '';
    const text = `¡Mirá este producto: *${product.name}*${price}!\n${shareUrl}`;
    const num = config.whatsappNumber ? config.whatsappNumber : '';
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !product || !config) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xl font-bold text-slate-700">{error || 'Producto no encontrado'}</p>
        <Link
          to={`/catalogo/${slug}`}
          className="text-indigo-600 font-semibold hover:underline flex items-center gap-1"
        >
          <ArrowLeft size={16} />
          Volver al catálogo
        </Link>
      </div>
    );
  }

  const imgs = product.images?.length
    ? product.images
    : product.imageUrl
    ? [product.imageUrl]
    : [];

  const accentColor = config.accentColor || '#6366f1';

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <Link
            to={`/catalogo/${slug}`}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-semibold transition-colors shrink-0"
          >
            <ArrowLeft size={18} />
            <span className="hidden sm:inline">{config.businessName}</span>
            <span className="sm:hidden">Catálogo</span>
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {copied ? (
                <Check size={15} className="text-emerald-500" />
              ) : (
                <Copy size={15} />
              )}
              {copied ? 'Copiado' : 'Copiar link'}
            </button>
            <button
              onClick={handleWhatsApp}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-sm font-semibold hover:bg-emerald-600 transition-colors"
            >
              <MessageCircle size={15} />
              WhatsApp
            </button>
          </div>
        </div>
      </header>

      {/* Product */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
          {/* Image carousel */}
          <div className="space-y-4">
            <div className="aspect-square rounded-3xl overflow-hidden bg-slate-50 relative">
              {imgs.length > 0 ? (
                <>
                  <img
                    src={imgs[imageIndex]}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  {imgs.length > 1 && (
                    <>
                      <button
                        onClick={() =>
                          setImageIndex(i => (i - 1 + imgs.length) % imgs.length)
                        }
                        className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white backdrop-blur-md"
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <button
                        onClick={() =>
                          setImageIndex(i => (i + 1) % imgs.length)
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white backdrop-blur-md"
                      >
                        <ChevronRight size={20} />
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-200">
                  <ShoppingBag size={64} strokeWidth={1} />
                </div>
              )}
            </div>

            {imgs.length > 1 && (
              <div className="flex gap-2 overflow-x-auto">
                {imgs.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setImageIndex(i)}
                    className={cn(
                      'w-16 h-16 rounded-xl overflow-hidden border-2 flex-shrink-0 transition-all',
                      i === imageIndex ? 'border-indigo-500' : 'border-transparent opacity-60 hover:opacity-100',
                    )}
                  >
                    <img
                      src={img}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product info */}
          <div className="space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
                {product.category}
              </p>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">
                {product.name}
              </h1>
            </div>

            {config.showPrices && (
              <p
                className="text-4xl font-black tracking-tighter"
                style={{ color: accentColor }}
              >
                {formatCurrency(roundPrice(product.salePrice))}
              </p>
            )}

            {config.showStock && (
              <div
                className={cn(
                  'inline-flex items-center px-3 py-1.5 rounded-full text-sm font-bold',
                  product.stock > 0
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-rose-100 text-rose-700',
                )}
              >
                {product.stock > 0
                  ? `Disponible${
                      config.showStockQuantity ? ` — ${product.stock} unidades` : ''
                    }`
                  : 'Sin stock'}
              </div>
            )}

            {product.description && (
              <div>
                <h2 className="font-bold text-slate-900 mb-2">Descripción</h2>
                <p className="text-slate-600 leading-relaxed">{product.description}</p>
              </div>
            )}

            {product.notes && (
              <div>
                <h2 className="font-bold text-slate-900 mb-1">Notas</h2>
                <p className="text-slate-500 text-sm leading-relaxed">{product.notes}</p>
              </div>
            )}

            {/* Share section */}
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Compartir producto
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleCopy}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-slate-200 rounded-2xl font-semibold text-slate-700 hover:border-slate-300 transition-colors"
                >
                  {copied ? (
                    <Check size={18} className="text-emerald-500" />
                  ) : (
                    <Copy size={18} />
                  )}
                  {copied ? '¡Copiado!' : 'Copiar link'}
                </button>
                <button
                  onClick={handleWhatsApp}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-white rounded-2xl font-semibold hover:bg-emerald-600 transition-colors"
                >
                  <MessageCircle size={18} />
                  WhatsApp
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
```

**Why:** Provides a standalone public URL for each catalog product — the destination for every share action throughout the app. The `user_id` cross-check prevents a valid product ID from being shown under a different catalog's slug.

---

### Step 3.3 — Add share button to each product card in PublicCatalog.tsx

**File:** `src/pages/PublicCatalog.tsx`
**Action:** Edit
**Severity:** High

**Before (imports):**
```tsx
import {
  ShoppingBag,
  Search,
  Plus,
  Minus,
  X,
  Send,
  CheckCircle2,
  XCircle,
  Trash2,
  Phone,
  MapPin,
  MessageCircle,
  User,
  Mail,
  ArrowRight,
  Instagram,
  Facebook,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
```

**After:**
```tsx
import {
  ShoppingBag,
  Search,
  Plus,
  Minus,
  X,
  Send,
  CheckCircle2,
  XCircle,
  Trash2,
  Phone,
  MapPin,
  MessageCircle,
  User,
  Mail,
  ArrowRight,
  Instagram,
  Facebook,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Share2,
  Copy,
  Check,
} from 'lucide-react';
```

---

Add state for the share menu inside the `PublicCatalog` component, after `const [darkMode, setDarkMode] = useState(...)`:

**Before:**
```tsx
  // Checkout form
  const [formData, setFormData] = useState({
```

**After:**
```tsx
  const [shareProductId, setShareProductId] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const handleShareProduct = async (product: Product, action: 'copy' | 'whatsapp') => {
    const url = `${window.location.origin}/catalogo/${slug}/${product.id}`;
    if (action === 'copy') {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => { setShareCopied(false); setShareProductId(null); }, 2000);
    } else {
      const price = config?.showPrices ? ` — ${formatCurrency(roundPrice(product.salePrice))}` : '';
      const text = `¡Mirá este producto: *${product.name}*${price}!\n${url}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      setShareProductId(null);
    }
  };

  // Checkout form
  const [formData, setFormData] = useState({
```

---

Inside the product card grid, find the product info section that renders the price and add-to-cart button (around line 723–754 of the original). The add-to-cart button is inside `<div className="flex items-end justify-between mt-6">`. Add a Share button beside it:

**Before (the bottom action row of each card):**
```tsx
                  <div className="flex items-end justify-between mt-6">
                    <div className="space-y-1">
                      {config.showPrices && (
                        <p className={cn(
                          "text-2xl font-black tracking-tighter",
                          darkMode ? "text-white" : "text-slate-900"
                        )}>
                          {formatCurrency(roundPrice(product.salePrice))}
                        </p>
                      )}
                      {config.showStock && (
                        <p className={cn(
                          "text-[10px] font-bold uppercase tracking-widest",
                          darkMode ? "text-white/20" : "text-slate-400"
                        )}>
                          {config.showStockQuantity ? 'Disponible' : `Stock: ${product.stock}`}
                        </p>
                      )}
                    </div>
                    
                    <button 
                      onClick={() => addToCart(product)}
                      disabled={product.stock <= 0}
                      className={cn(
                        "w-14 h-14 rounded-full flex items-center justify-center text-white shadow-2xl transition-all active:scale-90 disabled:opacity-20 disabled:grayscale",
                        product.stock > 0 ? "hover:scale-110 hover:shadow-indigo-500/40" : ""
                      )}
                      style={product.stock > 0 ? { backgroundColor: accentColor, boxShadow: `0 10px 30px -5px ${accentColor}80` } : {}}
                    >
                      <Plus size={28} />
                    </button>
                  </div>
```

**After:**
```tsx
                  <div className="flex items-end justify-between mt-6 relative">
                    <div className="space-y-1">
                      {config.showPrices && (
                        <p className={cn(
                          "text-2xl font-black tracking-tighter",
                          darkMode ? "text-white" : "text-slate-900"
                        )}>
                          {formatCurrency(roundPrice(product.salePrice))}
                        </p>
                      )}
                      {config.showStock && (
                        <p className={cn(
                          "text-[10px] font-bold uppercase tracking-widest",
                          darkMode ? "text-white/20" : "text-slate-400"
                        )}>
                          {config.showStockQuantity ? 'Disponible' : `Stock: ${product.stock}`}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Share button */}
                      <div className="relative">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setShareProductId(prev => prev === product.id ? null : product.id);
                            setShareCopied(false);
                          }}
                          className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                            darkMode
                              ? "bg-white/10 hover:bg-white/20 text-white/60 hover:text-white"
                              : "bg-slate-100 hover:bg-slate-200 text-slate-500"
                          )}
                          title="Compartir producto"
                        >
                          <Share2 size={18} />
                        </button>

                        {shareProductId === product.id && (
                          <div
                            className={cn(
                              "absolute bottom-full right-0 mb-2 w-44 rounded-2xl shadow-2xl border overflow-hidden z-20",
                              darkMode ? "bg-[#1a1a1a] border-white/10" : "bg-white border-slate-100"
                            )}
                          >
                            <button
                              onClick={() => handleShareProduct(product, 'copy')}
                              className={cn(
                                "w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors",
                                darkMode
                                  ? "text-white hover:bg-white/5"
                                  : "text-slate-700 hover:bg-slate-50"
                              )}
                            >
                              {shareCopied ? (
                                <Check size={15} className="text-emerald-500" />
                              ) : (
                                <Copy size={15} />
                              )}
                              {shareCopied ? 'Copiado' : 'Copiar link'}
                            </button>
                            <button
                              onClick={() => handleShareProduct(product, 'whatsapp')}
                              className={cn(
                                "w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors border-t",
                                darkMode
                                  ? "text-white hover:bg-white/5 border-white/5"
                                  : "text-slate-700 hover:bg-slate-50 border-slate-100"
                              )}
                            >
                              <MessageCircle size={15} className="text-emerald-500" />
                              WhatsApp
                            </button>
                          </div>
                        )}
                      </div>

                      <button 
                        onClick={() => addToCart(product)}
                        disabled={product.stock <= 0}
                        className={cn(
                          "w-14 h-14 rounded-full flex items-center justify-center text-white shadow-2xl transition-all active:scale-90 disabled:opacity-20 disabled:grayscale",
                          product.stock > 0 ? "hover:scale-110 hover:shadow-indigo-500/40" : ""
                        )}
                        style={product.stock > 0 ? { backgroundColor: accentColor, boxShadow: `0 10px 30px -5px ${accentColor}80` } : {}}
                      >
                        <Plus size={28} />
                      </button>
                    </div>
                  </div>
```

**Why:** The share dropdown stays inline in the card, matching the visual language of the existing catalog. Clicking outside any card dismisses it because `setShareProductId(null)` is called on any other card's share button click.

---

### Step 3.4 — Add share button to Stock.tsx rows

Already covered in **Step 1.6** — the share button was added alongside the Edit/Delete buttons in the actions cell. The logic is:

```tsx
{p.showInCatalog && user?.catalogSlug && (
  <button
    onClick={() => {
      const url = `${window.location.origin}/catalogo/${user.catalogSlug}/${p.id}`;
      navigator.clipboard.writeText(url);
    }}
    title="Copiar enlace del producto en el catálogo"
    className="p-2 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
  >
    <Share2 size={18} />
  </button>
)}
```

If `user.catalogSlug` is null (catalog not configured yet), the button is not rendered. The admin sees no broken share button.

---

## Verification

### Feature 1

1. **Hook**: Open any page component in the browser, check `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` or simply observe that buttons are disabled when logged in as a viewer.
2. **UI guard**: Create a test user, manually set `role = 'viewer'` in Supabase Table Editor (`profiles` table). Log in as that user — all Plus/Edit/Delete buttons should be visually disabled with a `title` tooltip "Solo administradores".
3. **Route guard**: With a viewer account, navigate directly to `/config` — should redirect to `/`.
4. **DB-level guard**: With the viewer account open in one tab, open the Supabase SQL editor and run:
   ```sql
   INSERT INTO products (user_id, name, category_id, category, sale_price, stock, min_stock, show_in_catalog, created_at, updated_at)
   VALUES (auth.uid(), 'Hack test', '', '', 0, 0, 0, false, now(), now());
   ```
   Should return a RLS violation error.
5. **Collaborators tab**: Log in as an admin, go to Settings → Colaboradores, add an email, verify it appears in the `collaborators` Supabase table.
6. **New user role**: Sign up a new account, check `profiles` table — `role` should be `'admin'` (not `'user'`).

### Feature 2

1. **Charts**: Log in as admin with data (sales, products with categories, cash_flow entries). Dashboard should show three charts below the KPI cards.
2. **Empty state**: If no sales data, the bar chart and line chart render with all-zero bars/lines. Pie chart shows "Sin datos".
3. **Dashboard PDF**: Click "Exportar reporte PDF" — a `.pdf` file downloads with a KPI table and a monthly sales summary table.
4. **Sales Excel export**: Go to Ventas, apply a status filter (e.g. "Pagado"), click Exportar → "Exportar Excel (.xlsx)". Open the file — it should contain only the filtered rows.
5. **Sales PDF export**: Click Exportar → "Exportar PDF". Open the file — should contain the same filtered rows in a formatted table with an indigo header.
6. **Export menu close**: Click the "Exportar" button to open the menu, then click anywhere outside it — the menu should close.

### Feature 3

1. **Product page URL**: In the public catalog (`/catalogo/your-slug`), click the Share2 icon on any product → click "Copiar link". Paste the URL — should be `/catalogo/your-slug/product-uuid`.
2. **Navigate to product page**: Open the copied URL in a browser (no auth required). Should show the product's name, price, description, images, and both share buttons.
3. **Image carousel**: If a product has multiple images, verify the prev/next arrows appear and change the displayed image.
4. **WhatsApp share from product page**: Click "WhatsApp" — should open `https://wa.me/?text=...` with product name, price, and URL in the pre-filled message.
5. **Copy link from product page**: Click "Copiar link" — button should flash green "¡Copiado!" for 2.5 seconds.
6. **Wrong slug/product mismatch**: Navigate to `/catalogo/wrong-slug/valid-product-id` — should show "Producto no encontrado" with a back link.
7. **Stock page share**: In the admin Stock page, find a row where the product has `showInCatalog = true` and the account has a `catalogSlug` set. A Share2 icon appears — clicking it copies the product URL to clipboard.
8. **Stock page no catalog**: If `user.catalogSlug` is null, no Share2 icon appears on any row.

---

## Secondary Recommendations

| Issue | File | Notes |
|-------|------|-------|
| **Collaborator data access not implemented** | All pages | Currently a viewer logs in and sees only their own empty data (ownerUid = their uid). True collaboration (viewer sees the admin's products/sales) requires adding an `admin_uid` column to profiles and updating all RLS policies and `db.list` calls to also query by `admin_uid`. This is a separate architectural change not in this plan's scope. |
| **`show_stock_quantity` missing from 0001_init.sql** | `supabase/migrations/0001_init.sql` | The `catalog_config` table in the initial migration lacks `show_stock_quantity`, but `PublicCatalog.tsx` and `types.ts` reference it. Verify it was added in a later migration; if not, add `ALTER TABLE catalog_config ADD COLUMN IF NOT EXISTS show_stock_quantity boolean NOT NULL DEFAULT false;` to migration 0018 or a new 0020. |
| **Duplicate data-fetch in Sales.tsx** | `src/pages/Sales.tsx:71-101` and `src/pages/Sales.tsx:104-126` | The same fetch logic runs twice (once in `fetchData` and once in `useEffect`). The `fetchData` function is also called after mutations. These could be consolidated without changing behavior; defer to a cleanup pass. |
| **Recharts tooltip locale** | `src/pages/Dashboard.tsx` | The Tooltip `formatter` calls `formatCurrency` but `formatCurrency` reads `user.currencySymbol` from the hook. Since the Dashboard charts are defined outside a tooltip component, pass `user?.currencySymbol` explicitly or use a stable formatter closure. |
| **Export on mobile** | `src/pages/Sales.tsx` | The export dropdown is `hidden md:block`, so mobile users cannot export. Consider adding a mobile-visible export option or a dedicated export sheet. |
