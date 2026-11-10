import { describe, expect, it } from 'vitest';
import { isAccountPermissionAllowed } from './permissionPolicy';

describe('account write permissions', () => {
  it('keeps read access on suspended accounts while denying writes and deletes', () => {
    const suspended = { status: 'suspended' } as const;
    expect(isAccountPermissionAllowed(true, 'read', suspended, false, null)).toBe(true);
    expect(isAccountPermissionAllowed(true, 'write', suspended, false, null)).toBe(false);
    expect(isAccountPermissionAllowed(true, 'delete', suspended, false, null)).toBe(false);
  });

  it('allows configured mutations on trial and active plans', () => {
    expect(isAccountPermissionAllowed(true, 'write', { status: 'trial' }, false, null)).toBe(true);
    expect(isAccountPermissionAllowed(true, 'delete', { status: 'active' }, false, null)).toBe(true);
  });

  it('keeps allowed mutations available from the last verified plan during refresh', () => {
    expect(isAccountPermissionAllowed(true, 'write', { status: 'active' }, true, null)).toBe(true);
    expect(isAccountPermissionAllowed(true, 'delete', { status: 'trial' }, true, new Error('network'))).toBe(true);
  });

  it('fails closed for mutations until the plan can be verified', () => {
    expect(isAccountPermissionAllowed(true, 'write', null, true, null)).toBe(false);
    expect(isAccountPermissionAllowed(true, 'delete', null, false, new Error('network'))).toBe(false);
    expect(isAccountPermissionAllowed(false, 'write', { status: 'active' }, false, null)).toBe(false);
  });
});
