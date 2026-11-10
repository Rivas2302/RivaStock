// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ownerId: 'owner-qa-1',
  session: {
    user: {
      id: 'owner-qa-1',
      email: 'owner@example.test',
      user_metadata: { display_name: 'QA Owner', password_set: true },
    },
  },
  getOwnerProfile: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: vi.fn(),
    },
    rpc: (name: string) => {
      const data = name === 'get_owner_profile' ? mocks.getOwnerProfile() : Promise.resolve({ data: false, error: null });
      let result = data;
      const query = {
        abortSignal: () => query,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => result.then(resolve, reject),
      };
      return query;
    },
    from: (table: string) => {
      const response = table === 'profiles'
        ? { data: { display_name: 'QA Owner' }, error: null }
        : table === 'inventory_operation_settings'
          ? { data: { holdings_enabled: false }, error: null }
          : { data: null, error: null };
      let result = Promise.resolve(response);
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        abortSignal: () => query,
        maybeSingle: () => result,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => result.then(resolve, reject),
      };
      return query;
    },
  },
}));

vi.mock('./lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/db')>();
  return {
    ...actual,
    clearDbCache: vi.fn(),
    invalidateDbCache: vi.fn(),
    setDatabaseActor: vi.fn(),
    syncOfflineMutations: vi.fn().mockResolvedValue(undefined),
  };
});

import { AuthProvider, useAuth } from './AuthContext';
import RequirePermission from './components/RequirePermission';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

function AuthState({ children }: { children?: ReactNode }) {
  const { authUser, user, loading, authError, refreshAuthProfile } = useAuth();
  return createElement('div', null,
    createElement('output', { 'data-testid': 'auth-state' }, `${loading ? 'loading' : 'ready'}:${authUser?.forcePass ? 'needs-password' : 'ok'}:${authError ?? 'no-error'}`),
    user && !authUser?.forcePass ? createElement('output', { 'data-testid': 'mounted-route' }, 'product-form-mounted') : null,
    user && !authUser?.forcePass ? createElement(RequirePermission, {
      module: 'stock',
      children: createElement('output', { 'data-testid': 'permission-route' }, 'permission-route-mounted'),
    }) : null,
    createElement('button', { type: 'button', onClick: () => { void refreshAuthProfile(); } }, 'Refresh profile'),
    children,
  );
}

describe('AuthContext background revalidation', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.session.user.user_metadata = { display_name: 'QA Owner', password_set: true };
    mocks.getOwnerProfile.mockReset()
      .mockResolvedValue({ data: [{ id: mocks.ownerId, business_name: 'QA Business' }], error: null });
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: mocks.session }, error: null });
    mocks.onAuthStateChange.mockReset().mockImplementation(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.restoreAllMocks();
  });

  it('keeps the verified route and first-login state when a background profile refresh fails', async () => {
    await act(async () => { root.render(createElement(AuthProvider, null, createElement(AuthState))); });
    await vi.waitFor(() => expect(host.querySelector('[data-testid="mounted-route"]')?.textContent).toBe('product-form-mounted'));

    // A stale token payload must not briefly re-apply the first-login gate.
    mocks.session.user.user_metadata = {} as typeof mocks.session.user.user_metadata;
    mocks.getOwnerProfile.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); });

    expect(host.querySelector('[data-testid="auth-state"]')?.textContent).toBe('ready:ok:no-error');
    expect(host.querySelector('[data-testid="mounted-route"]')?.textContent).toBe('product-form-mounted');
    expect(host.querySelector('[data-testid="permission-route"]')?.textContent).toBe('permission-route-mounted');
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[Auth] Background profile refresh failed; keeping the last verified account.');
  });

  it('applies a newly confirmed first-login requirement after a successful profile refresh', async () => {
    await act(async () => { root.render(createElement(AuthProvider, null, createElement(AuthState))); });
    await vi.waitFor(() => expect(host.querySelector('[data-testid="mounted-route"]')?.textContent).toBe('product-form-mounted'));

    mocks.session.user.user_metadata = { display_name: 'QA Owner', password_set: false };
    await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); });

    expect(host.querySelector('[data-testid="auth-state"]')?.textContent).toBe('ready:needs-password:no-error');
    expect(host.querySelector('[data-testid="mounted-route"]')).toBeNull();
    expect(host.querySelector('[data-testid="permission-route"]')).toBeNull();
  });
});
