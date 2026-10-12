import { describe, expect, it } from 'vitest';
import { pageBounds } from './pagination';

describe('display pagination', () => {
  it('bounds large lists without changing the underlying data', () => {
    expect(pageBounds(10_000, 0)).toEqual({ page: 0, pages: 200, start: 0, end: 50 });
    expect(pageBounds(10_001, 200)).toEqual({ page: 200, pages: 201, start: 10_000, end: 10_001 });
  });
  it('clamps removed or empty pages', () => {
    expect(pageBounds(0, 50)).toEqual({ page: 0, pages: 1, start: 0, end: 0 });
    expect(pageBounds(2, 20).page).toBe(0);
    expect(pageBounds(100, -1).page).toBe(0);
  });
});
