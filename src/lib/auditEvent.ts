import type { AuditEvent } from '../types';

type TimestampedAuditEvent = Pick<AuditEvent, 'createdAt'>;

/** Audit rows can outlive schema revisions, so their timestamps are untrusted input. */
export function getAuditEventDate(event: TimestampedAuditEvent): Date | null {
  if (typeof event.createdAt !== 'string' || !event.createdAt.trim()) return null;
  const date = new Date(event.createdAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAuditEventTimestamp(event: TimestampedAuditEvent): string {
  const date = getAuditEventDate(event);
  if (!date) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
