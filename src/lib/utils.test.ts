import { describe, expect, it } from 'vitest';
import { formatDate, todayString } from './utils';

describe('formatDate', () => {
  it('parses a YYYY-MM-DD string without timezone drift', () => {
    const formatted = formatDate('2026-08-04');
    expect(formatted).toMatch(/04\/08\/2026/);
  });

  it('parses a full ISO timestamp', () => {
    const formatted = formatDate('2026-08-04T22:30:00.123Z');
    expect(formatted).toMatch(/0[34]\/08\/2026/);
  });

  it('returns an empty string for empty or invalid input', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('not-a-date')).toBe('');
    expect(formatDate('2026-13-99')).toBe('');
  });
});

describe('todayString', () => {
  it('returns a YYYY-MM-DD string in the local timezone', () => {
    expect(todayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
