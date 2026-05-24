# Execution Plan — Display Logged-In Username in Navigation

**Date**: 2026-05-24
**Scope**: UI only — `src/components/Layout.tsx`. Zero backend changes, zero type changes, zero new files.
**Estimated implementation time**: 10–15 min.

---

## Summary of Findings

### Auth Model
`useAuth()` (`src/AuthContext.tsx`) exposes:

| Property | Type | What it contains |
|----------|------|-----------------|
| `user` | `UserProfile \| null` | **Always the owner's profile**, regardless of who is logged in. Loaded via `get_owner_profile` RPC. |
| `authUser` | `{ uid: string; email: string } \| null` | The **actual authenticated user** (owner or collaborator). |
| `isOwner` | `boolean` | `true` = owner session, `false` = collaborator session. |
| `collaboratorId` | `string \| null` | Non-null when the session is a collaborator. |

### User Display Name by Role
| Role | Source | Fallback |
|------|--------|----------|
| Owner | `user.displayName` | `authUser.email` |
| Collaborator | `authUser.email` | empty string |

Collaborators have **no stored display name** — only `email` exists in the `collaborators` table. This is a DB schema fact, not a code limitation.

### Navigation Component
`src/components/Layout.tsx` — single file, handles both surfaces:

| Surface | Location in file | Current footer content |
|---------|-----------------|----------------------|
| Desktop sidebar | Lines 128–137 | Logout button only |
| Mobile overlay drawer | Lines 222–231 | Logout button only |

Both surfaces already import `useAuth` and read `user`; they just don't display user identity.

---

## Files to Modify

| # | File | Severity | Risk |
|---|------|----------|------|
| 1 | `src/components/Layout.tsx` | Low | Low |

---

## Change 1 — `src/components/Layout.tsx`

### Sub-change 1a — Add `authUser` and `isOwner` to the `useAuth()` destructure

**Location:** Line 51

**Current:**
```tsx
  const { user, logout, refetchData, permissions } = useAuth();
```

**Replace with:**
```tsx
  const { user, authUser, isOwner, logout, refetchData, permissions } = useAuth();
```

---

### Sub-change 1b — Compute display values

**Location:** Insert after the `navItems` declaration (currently line 58), before the `useEffect` on line 60.

**Insert:**
```tsx
  const displayName = isOwner
    ? (user?.displayName || authUser?.email || '')
    : (authUser?.email || '');
  const displayInitial = displayName.charAt(0).toUpperCase() || '?';
```

---

### Sub-change 1c — Replace desktop sidebar footer

**Location:** Lines 128–137

**Current:**
```tsx
        <div className="p-4 mt-auto border-t border-slate-800">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-3 w-full px-3 py-2 text-slate-400 hover:text-rose-400 transition-colors disabled:opacity-50"
          >
            <LogOut size={20} />
            <span className="font-medium">Cerrar Sesión</span>
          </button>
        </div>
```

**Replace with:**
```tsx
        <div className="p-4 mt-auto border-t border-slate-800 space-y-2">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
              {displayInitial}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{displayName}</p>
              <p className="text-xs text-slate-500 truncate">{isOwner ? 'Propietario' : 'Colaborador'}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-3 w-full px-3 py-2 text-slate-400 hover:text-rose-400 transition-colors disabled:opacity-50"
          >
            <LogOut size={20} />
            <span className="font-medium">Cerrar Sesión</span>
          </button>
        </div>
```

---

### Sub-change 1d — Replace mobile overlay footer

**Location:** Lines 222–231 (inside `AnimatePresence` → `motion.div`)

**Current:**
```tsx
              <div className="p-4 border-t border-slate-800">
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-3 w-full px-3 py-2 text-slate-400 hover:text-rose-400 transition-colors disabled:opacity-50"
                >
                  <LogOut size={20} />
                  <span className="font-medium">Cerrar Sesión</span>
                </button>
              </div>
```

**Replace with:**
```tsx
              <div className="p-4 border-t border-slate-800 space-y-2">
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {displayInitial}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{displayName}</p>
                    <p className="text-xs text-slate-500 truncate">{isOwner ? 'Propietario' : 'Colaborador'}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-3 w-full px-3 py-2 text-slate-400 hover:text-rose-400 transition-colors disabled:opacity-50"
                >
                  <LogOut size={20} />
                  <span className="font-medium">Cerrar Sesión</span>
                </button>
              </div>
```

---

## Order of Execution

```
1a → 1b → 1c → 1d
```

- **1a** must be first (introduces `authUser` and `isOwner` variables).
- **1b** must follow 1a (uses those variables to compute `displayName` / `displayInitial`).
- **1c** and **1d** must follow 1b (use `displayName` and `displayInitial` in JSX).
- **1c** and **1d** are independent of each other.

---

## Edge Cases

| Case | Behavior |
|------|----------|
| Owner has no `displayName` | Falls back to `authUser.email` via `user?.displayName \|\| authUser?.email \|\| ''` |
| Collaborator (no stored name) | Shows `authUser.email` — the only available identifier |
| `displayName` is empty string | `displayInitial` returns `'?'` via `\|\| '?'` fallback |
| Very long email or name | `truncate` CSS class clips text with ellipsis; layout never breaks |
| `user` or `authUser` null at render | Layout only mounts for authenticated sessions (behind route guard). Both are set before `loading` becomes `false`. The `?.` and `\|\| ''` guards are a safety net only. |
| Dark mode | No changes needed — sidebar and overlay already have hard-coded dark backgrounds (`bg-slate-900`); new elements inherit or use explicit `text-white` / `text-slate-500` |

---

## Verification Steps

### TypeScript build

```bash
npx tsc --noEmit
```

Expected: zero errors. `authUser` and `isOwner` already exist on `AuthContextType` — no new types needed.

### Manual browser verification

1. **Owner session — desktop**
   - Log in as owner.
   - Check bottom of desktop sidebar: indigo avatar circle showing first letter of `displayName`, name text, label "Propietario".

2. **Owner session — mobile**
   - Open hamburger menu.
   - Same user block appears in the drawer footer above "Cerrar Sesión".

3. **Collaborator session — desktop + mobile**
   - Log in as a collaborator account.
   - Same locations show the collaborator's email and label "Colaborador".

4. **Long email**
   - Use an account with a 50+ character email.
   - Verify text truncates cleanly without overflowing the sidebar.

5. **Logout regression**
   - Click "Cerrar Sesión" in both desktop and mobile.
   - Verify redirect to `/login` with no console errors.

---

## Out of Scope

- Storing a display name for collaborators (would require a DB schema change to the `collaborators` table and an update UI — separate feature).
- Avatar image upload.
- Clicking the user block to go to a profile page.
