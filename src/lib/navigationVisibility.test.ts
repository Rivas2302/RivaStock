import { describe, expect, it } from 'vitest';
import { ALL_TRUE_PERMISSIONS } from '../types';
import { isNavigationItemVisible } from './navigationVisibility';

describe('isNavigationItemVisible', () => {
  it('applies owner and permission checks to a base module entry', () => {
    expect(isNavigationItemVisible(
      { module: 'ventas', ownerOnly: true },
      ALL_TRUE_PERMISSIONS,
      false,
      null,
    )).toBe(false);

    const noSalesRead = { ...ALL_TRUE_PERMISSIONS, ventas: { ...ALL_TRUE_PERMISSIONS.ventas, read: false } };
    expect(isNavigationItemVisible({ module: 'ventas' }, noSalesRead, true, null)).toBe(false);
  });

  it('requires the plan to include business modules', () => {
    expect(isNavigationItemVisible({ module: null, businessModule: 'ai' }, ALL_TRUE_PERMISSIONS, true, null)).toBe(false);
    expect(isNavigationItemVisible({ module: 'ventas', businessModule: 'sales' }, ALL_TRUE_PERMISSIONS, true, null)).toBe(false);
    expect(isNavigationItemVisible(
      { module: null, businessModule: 'ai' },
      ALL_TRUE_PERMISSIONS,
      true,
      { ai: true },
    )).toBe(true);
  });
});
