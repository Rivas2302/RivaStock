import { describe, expect, it, vi } from 'vitest';

import { resolveIdempotencyIntent } from './idempotencyIntent';

describe('idempotency intent keys', () => {
  it('reuses one key for retries of the same semantic payload', () => {
    const generate = vi.fn(() => 'first');
    const initial = resolveIdempotencyIntent('intake', {
      productId: 'mate', quantity: 2, ownerId: 'leo',
    }, null, generate);
    const retry = resolveIdempotencyIntent('intake', {
      ownerId: 'leo', quantity: 2, productId: 'mate',
    }, initial, generate);

    expect(initial.key).toBe('intake:first');
    expect(retry).toEqual(initial);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('creates a new key when the user changes the intended operation', () => {
    const keys = ['first', 'second'];
    const generate = vi.fn(() => keys.shift() ?? 'unexpected');
    const initial = resolveIdempotencyIntent('transfer', { quantity: 1 }, null, generate);
    const changed = resolveIdempotencyIntent('transfer', { quantity: 2 }, initial, generate);

    expect(changed.key).toBe('transfer:second');
    expect(changed.fingerprint).not.toBe(initial.fingerprint);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
