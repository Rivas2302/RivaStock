// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  saveAccountProfile: vi.fn(),
  refreshAuthProfile: vi.fn(),
  authUser: { email: 'test@example.test', displayName: '', needsProfileSetup: true, signupKind: 'business_owner' },
  businessName: 'Bazar de prueba',
}));

vi.mock('../lib/supabase', () => ({ supabase: { auth: {
  getSession: mocks.getSession,
  onAuthStateChange: mocks.onAuthStateChange,
  signOut: mocks.signOut,
} } }));
vi.mock('../lib/accountProfile', () => ({
  normalizeDisplayName: (value: unknown) => typeof value === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().replace(/\s+/g, ' ') : '',
  validateDisplayName: (value: string) => value.trim().length >= 2 && value.trim().length <= 80 ? null : 'Escribí tu nombre (entre 2 y 80 caracteres).',
  saveAccountProfile: mocks.saveAccountProfile,
}));
vi.mock('../AuthContext', () => ({ useAuth: () => ({
  user: { businessName: mocks.businessName },
  authUser: mocks.authUser,
  refreshAuthProfile: mocks.refreshAuthProfile,
}) }));

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResetPassword from './ResetPassword';

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('first-entry and password recovery flows', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: {
      user: { email: 'test@example.test', user_metadata: { business_name: mocks.businessName, password_set: false } },
    } } });
    mocks.onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    mocks.signOut.mockReset().mockResolvedValue({ error: null });
    mocks.saveAccountProfile.mockReset().mockResolvedValue(undefined);
    mocks.refreshAuthProfile.mockReset().mockResolvedValue(undefined);
    mocks.authUser.displayName = '';
    mocks.authUser.needsProfileSetup = true;
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  const renderAt = async (path: string) => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/reset-password" element={<ResetPassword/>}/></Routes>
      </MemoryRouter>);
      await Promise.resolve();
    });
  };

  it('requires a display name and password for an invitation before entering', async () => {
    await renderAt('/reset-password?type=invite');
    expect(host.textContent).toContain('Bienvenida, Bazar de prueba');
    expect(host.querySelector<HTMLInputElement>('#invite-email')?.value).toBe('test@example.test');
    expect(host.querySelector<HTMLInputElement>('#invite-email')?.readOnly).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#display-name')?.required).toBe(true);
    expect(host.textContent).toContain('8 caracteres o más');

    const name = host.querySelector<HTMLInputElement>('#display-name');
    const password = host.querySelector<HTMLInputElement>('#new-password');
    const confirmation = host.querySelector<HTMLInputElement>('#confirm-password');
    await act(async () => {
      if (!name || !password || !confirmation) throw new Error('No se encontró el formulario de primer ingreso.');
      setInputValue(name, 'María López');
      setInputValue(password, 'New-Password-123');
      setInputValue(confirmation, 'New-Password-123');
    });
    await act(async () => {
      host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(mocks.saveAccountProfile).toHaveBeenCalledWith('María López', 'New-Password-123');
    expect(mocks.refreshAuthProfile).toHaveBeenCalledOnce();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Tu nombre y contraseña quedaron guardados.');
  });

  it('shows password recovery as a new-password form and ends the recovery session', async () => {
    mocks.authUser.displayName = 'María López';
    mocks.authUser.needsProfileSetup = false;
    mocks.getSession.mockResolvedValue({ data: { session: {
      user: { email: 'test@example.test', user_metadata: { display_name: 'María López', password_set: true } },
    } } });
    await renderAt('/reset-password?type=recovery');
    expect(host.querySelector('#password-heading')?.textContent).toBe('Elegí tu contraseña nueva');
    expect(host.querySelector('#display-name')).toBeNull();

    const password = host.querySelector<HTMLInputElement>('#new-password');
    const confirmation = host.querySelector<HTMLInputElement>('#confirm-password');
    await act(async () => {
      if (!password || !confirmation) throw new Error('No se encontró el formulario de recuperación.');
      setInputValue(password, 'Recovered-123');
      setInputValue(confirmation, 'Recovered-123');
    });
    await act(async () => {
      host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(mocks.saveAccountProfile).toHaveBeenCalledWith('María López', 'Recovered-123');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(host.textContent).toContain('Contraseña actualizada.');
  });
});
