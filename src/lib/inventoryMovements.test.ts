import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  callRpc: vi.fn(),
}));

import { callRpc } from './db';
import {
  type InventoryMovement,
  listInventoryMovements,
  mapMovementRow,
  MOVEMENT_TYPE_BADGE_CLASS,
  MOVEMENT_TYPE_LABELS,
} from './inventoryMovements';

const mockCallRpc = vi.mocked(callRpc);

describe('inventory movements', () => {
  beforeEach(() => {
    mockCallRpc.mockReset();
  });

  it('maps every movement_type and clamps unknown values to adjustment', () => {
    const base = {
      id: 'mv-1',
      created_at: '2026-08-01T10:00:00Z',
      product_id: 'prod-1',
      product_name: 'Termo',
      inventory_owner_id: 'owner-1',
      inventory_owner_name: 'Kevin',
      reason: 'Ingreso de mercadería',
      transfer_reason: null,
      transfer_key: null,
      resulting_stock: 12,
      actor_uid: 'auth-1',
      total_count: '7',
    };
    const cases: Array<[string, InventoryMovement['movementType']]> = [
      ['intake', 'intake'],
      ['transfer_in', 'transfer_in'],
      ['transfer_out', 'transfer_out'],
      ['product_edit', 'product_edit'],
      ['adjustment', 'adjustment'],
      ['unknown-future-bucket', 'adjustment'],
    ];
    for (const [movementType, expected] of cases) {
      const row = { ...base, delta: 5, movement_type: movementType };
      const mapped = mapMovementRow(row);
      expect(mapped.movementType).toBe(expected);
      expect(mapped.delta).toBe(5);
      expect(mapped.totalCount).toBe(7);
      expect(mapped.resultingStock).toBe(12);
    }
  });

  it('parses string totals from postgres bigint and keeps negative deltas', () => {
    const row = {
      id: 'mv-2',
      created_at: '2026-08-02T10:00:00Z',
      product_id: 'prod-2',
      product_name: 'Mate',
      inventory_owner_id: 'owner-2',
      inventory_owner_name: 'Vicky',
      reason: 'Ajuste de stock',
      transfer_reason: null,
      transfer_key: null,
      resulting_stock: 0,
      actor_uid: 'auth-1',
      total_count: '0',
      delta: -3,
      movement_type: 'adjustment',
    };
    const mapped = mapMovementRow(row);
    expect(mapped.delta).toBe(-3);
    expect(mapped.totalCount).toBe(0);
    expect(mapped.resultingStock).toBe(0);
  });

  it('forwards every filter to the RPC with explicit null sentinels', async () => {
    mockCallRpc.mockResolvedValueOnce([]);
    await listInventoryMovements({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      productId: 'prod-1',
      inventoryOwnerId: 'owner-1',
      movementType: 'transfer_in',
      limit: 25,
      offset: 50,
    });
    expect(mockCallRpc).toHaveBeenCalledWith('list_inventory_movements', {
      p_date_from: '2026-08-01',
      p_date_to: '2026-08-31',
      p_product_id: 'prod-1',
      p_inventory_owner_id: 'owner-1',
      p_movement_type: 'transfer_in',
      p_limit: 25,
      p_offset: 50,
    });
  });

  it('uses null sentinels and default pagination when no filters are passed', async () => {
    mockCallRpc.mockResolvedValueOnce([]);
    await listInventoryMovements();
    expect(mockCallRpc).toHaveBeenCalledWith('list_inventory_movements', {
      p_date_from: null,
      p_date_to: null,
      p_product_id: null,
      p_inventory_owner_id: null,
      p_movement_type: null,
      p_limit: 50,
      p_offset: 0,
    });
  });

  it('returns an empty array when the RPC payload is not a list', async () => {
    mockCallRpc.mockResolvedValueOnce(null);
    await expect(listInventoryMovements()).resolves.toEqual([]);
  });

  it('exposes a label and badge for every movement type', () => {
    const types: Array<keyof typeof MOVEMENT_TYPE_LABELS> = [
      'intake', 'transfer_in', 'transfer_out', 'product_edit', 'adjustment',
    ];
    for (const type of types) {
      expect(MOVEMENT_TYPE_LABELS[type]).toBeTruthy();
      expect(MOVEMENT_TYPE_BADGE_CLASS[type]).toBeTruthy();
    }
  });
});
