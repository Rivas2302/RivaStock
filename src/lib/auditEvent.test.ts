import { describe, expect, it } from 'vitest';
import { formatAuditEventTimestamp, getAuditEventDate } from './auditEvent';

describe('audit event timestamps', () => {
  it('accepts a valid timestamp returned by Supabase', () => {
    const event = { createdAt: '2026-07-13T20:00:00.000Z' };
    expect(getAuditEventDate(event)).toBeInstanceOf(Date);
    expect(formatAuditEventTimestamp(event)).not.toBe('Fecha no disponible');
  });

  it.each([undefined, '', 'not-a-date'])('does not crash on legacy timestamp %p', (createdAt) => {
    expect(formatAuditEventTimestamp({ createdAt } as never)).toBe('Fecha no disponible');
  });
});
