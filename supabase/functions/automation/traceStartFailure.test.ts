import { describe, expect, it } from 'vitest';
import { isInactiveRehearsalTraceStart } from './traceStartFailure';

describe('isInactiveRehearsalTraceStart', () => {
  it('recognizes a trace retry for an already terminal rehearsal', () => {
    expect(isInactiveRehearsalTraceStart({ message: 'Rehearsal is not active' })).toBe(true);
  });

  it('does not classify other database errors as terminal rehearsal retries', () => {
    expect(isInactiveRehearsalTraceStart({ message: 'Rehearsal does not belong to this active device' })).toBe(false);
    expect(isInactiveRehearsalTraceStart({ message: 'connection failed' })).toBe(false);
    expect(isInactiveRehearsalTraceStart(null)).toBe(false);
  });
});
