// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readLastShippingAmount, rememberLastShippingAmount } from './saleShippingStorage';

describe('last shipping amount storage', () => {
  afterEach(() => window.localStorage.clear());

  it('stores the last positive amount per owner on the current device', () => {
    rememberLastShippingAmount('owner-a', 1_234.567);
    rememberLastShippingAmount('owner-b', 75);
    expect(readLastShippingAmount('owner-a')).toBe(1_234.57);
    expect(readLastShippingAmount('owner-b')).toBe(75);
    rememberLastShippingAmount('owner-a', 0);
    expect(readLastShippingAmount('owner-a')).toBe(1_234.57);
  });
});
