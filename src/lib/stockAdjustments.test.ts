import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callRpc, fromDb } = vi.hoisted(() => ({
  callRpc: vi.fn(),
  fromDb: vi.fn((row: Record<string, unknown>) => ({ id: row.id, delta: row.delta })),
}));

vi.mock('./db', () => ({ callRpc, fromDb }));

import { adjustProductStock } from './stockAdjustments';

describe('adjustProductStock', () => {
  beforeEach(() => {
    callRpc.mockReset();
    fromDb.mockClear();
  });

  it('envía los parámetros tipados al RPC y mapea el comando devuelto', async () => {
    callRpc.mockResolvedValue({ id: 'command-1', delta: 3 });

    await expect(adjustProductStock({
      productId: 'product-1',
      inventoryOwnerId: 'owner-1',
      mode: 'add',
      quantity: 3,
      reason: 'Ingresó mercadería',
      idempotencyKey: 'stock:attempt-1',
    })).resolves.toEqual({ id: 'command-1', delta: 3 });

    expect(callRpc).toHaveBeenCalledWith('adjust_product_stock', {
      p_product_id: 'product-1',
      p_inventory_owner_id: 'owner-1',
      p_mode: 'add',
      p_quantity: 3,
      p_reason: 'Ingresó mercadería',
      p_idempotency_key: 'stock:attempt-1',
    });
    expect(fromDb).toHaveBeenCalledWith({ id: 'command-1', delta: 3 });
  });

  it('devuelve null cuando el conteo no cambia el stock', async () => {
    callRpc.mockResolvedValue(null);

    await expect(adjustProductStock({
      productId: 'product-1',
      inventoryOwnerId: null,
      mode: 'count',
      quantity: 4,
      reason: 'Conteo',
      idempotencyKey: 'stock:attempt-2',
    })).resolves.toBeNull();
    expect(fromDb).not.toHaveBeenCalled();
  });
});
