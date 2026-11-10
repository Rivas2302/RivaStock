import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: {
    auth: { updateUser: mocks.updateUser },
    from: vi.fn(() => ({ update: vi.fn(() => ({ eq: mocks.updateProfile })) })),
  },
}));

import { normalizeDisplayName, saveAccountProfile, validateDisplayName } from './accountProfile';

describe('account profile', () => {
  afterEach(() => vi.clearAllMocks());

  it('normalizes names and never accepts an email as a display name', () => {
    expect(normalizeDisplayName('  María   López  ')).toBe('María López');
    expect(normalizeDisplayName('maria@example.test')).toBe('');
    expect(validateDisplayName('A')).toContain('entre 2 y 80');
    expect(validateDisplayName('María')).toBeNull();
  });

  it('sets the password marker and saves the name on the authenticated profile', async () => {
    mocks.updateUser.mockResolvedValue({
      data: { user: { id: 'fixture-user' } },
      error: null,
    });
    mocks.updateProfile.mockResolvedValue({ error: null });

    await saveAccountProfile('  María López ', 'New-password-123');

    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: 'New-password-123',
      data: {
        display_name: 'María López',
        full_name: 'María López',
        password_set: true,
        must_change_password: false,
      },
    });
    expect(mocks.updateProfile).toHaveBeenCalledWith('id', 'fixture-user');
  });

  it('rejects an email in the required display-name field before writing', async () => {
    await expect(saveAccountProfile('maria@example.test', 'New-password-123')).rejects.toThrow('Escribí tu nombre');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
