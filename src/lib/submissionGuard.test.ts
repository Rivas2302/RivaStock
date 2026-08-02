import { describe, expect, it } from 'vitest';

import { beginSubmission, endSubmission } from './submissionGuard';

describe('submission guard', () => {
  it('allows the first submission and blocks a second synchronous attempt', () => {
    const guard = { current: false };
    expect(beginSubmission(guard)).toBe(true);
    expect(beginSubmission(guard)).toBe(false);
    expect(guard.current).toBe(true);
  });

  it('allows a retry after the active attempt finishes', () => {
    const guard = { current: false };
    expect(beginSubmission(guard)).toBe(true);
    endSubmission(guard);
    expect(beginSubmission(guard)).toBe(true);
  });
});
