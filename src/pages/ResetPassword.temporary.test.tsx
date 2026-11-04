// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { auth: {
    getSession: mocks.getSession,
    onAuthStateChange: mocks.onAuthStateChange,
    updateUser: mocks.updateUser,
    signOut: mocks.signOut,
  } },
}));

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResetPassword from './ResetPassword';

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('temporary password reset flow', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: {} } });
    mocks.onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    mocks.updateUser.mockReset().mockResolvedValue({ error: null });
    mocks.signOut.mockReset().mockResolvedValue({ error: null });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('keeps the session and clears the forced-change flag after submitting a new password', async () => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/reset-password?type=temporary']}>
        <Routes><Route path="/reset-password" element={<ResetPassword/>}/></Routes>
      </MemoryRouter>);
      await Promise.resolve();
    });

    const password = host.querySelector<HTMLInputElement>('#new-password');
    const confirmation = host.querySelector<HTMLInputElement>('#confirm-password');
    expect(password).not.toBeNull();
    expect(confirmation).not.toBeNull();
    await act(async () => {
      if (!password || !confirmation) throw new Error('No se encontró el formulario de cambio de contraseña.');
      setInputValue(password, 'New-Password-123');
      setInputValue(confirmation, 'New-Password-123');
    });
    await act(async () => {
      const form = host.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'New-Password-123', data: { must_change_password: false } });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(host.textContent).toContain('La contraseña temporal quedó reemplazada.');
  });
});
