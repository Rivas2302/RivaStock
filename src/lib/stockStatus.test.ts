import { describe, expect, it } from 'vitest';
import { getStockStatus } from './stockStatus';

describe('getStockStatus', () => {
  it('treats exactly zero as out of stock', () => {
    expect(getStockStatus(0, 2)).toBe('out');
  });

  it('marks positive stock at or below the minimum as low', () => {
    expect(getStockStatus(1, 2)).toBe('low');
    expect(getStockStatus(2, 2)).toBe('low');
  });

  it('marks stock above the minimum as healthy', () => {
    expect(getStockStatus(3, 2)).toBe('ok');
  });

  it('does not report low stock when the minimum is zero', () => {
    expect(getStockStatus(1, 0)).toBe('ok');
  });
});