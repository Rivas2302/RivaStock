import { describe, expect, it } from 'vitest';

import { resolveInventoryAccessState } from './inventoryAccess';

describe('inventory access state', () => {
  it('returns the verified membership scope when every query succeeds', () => {
    expect(resolveInventoryAccessState({
      memberships: [
        { inventoryOwnerId: 'leo', isDefault: true, canOperate: true },
        { inventoryOwnerId: 'mama', isDefault: false, canOperate: false },
      ],
      holdingsEnabled: true,
      inventoryOwnerIds: ['leo', 'mama'],
      queryErrors: [],
    })).toEqual({
      allowedInventoryOwnerIds: ['leo', 'mama'],
      operableInventoryOwnerIds: ['leo'],
      defaultInventoryOwnerId: 'leo',
      holdingsEnabled: true,
      inventoryAccessError: null,
    });
  });

  it('fails closed when any settings, membership or owner query fails', () => {
    for (const error of ['memberships unavailable', 'settings unavailable', 'owners unavailable']) {
      expect(resolveInventoryAccessState({
        memberships: [{ inventoryOwnerId: 'leo', isDefault: true, canOperate: true }],
        holdingsEnabled: true,
        inventoryOwnerIds: ['leo'],
        queryErrors: [error],
      })).toEqual({
        allowedInventoryOwnerIds: [],
        operableInventoryOwnerIds: [],
        defaultInventoryOwnerId: null,
        holdingsEnabled: false,
        inventoryAccessError: 'No se pudo verificar el acceso al stock. Recargá la página.',
      });
    }
  });

  it('fails closed when a membership references an owner outside the verified owner list', () => {
    expect(resolveInventoryAccessState({
      memberships: [{ inventoryOwnerId: 'unknown', isDefault: true, canOperate: true }],
      holdingsEnabled: false,
      inventoryOwnerIds: ['leo'],
      queryErrors: [],
    }).inventoryAccessError).toBe('No se pudo verificar el acceso al stock. Recargá la página.');
  });
});
