import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, KNOWLEDGE_INDEX_STATUS_LABELS, KNOWLEDGE_STATUS_LABELS } from './format';

describe('knowledge format helpers', () => {
  it('provides Spanish status labels', () => {
    expect(KNOWLEDGE_STATUS_LABELS).toMatchObject({
      draft: 'Borrador', in_review: 'Pendiente de revisión', published: 'Publicado', archived: 'Archivado', deleting: 'Eliminando',
    });
    expect(KNOWLEDGE_INDEX_STATUS_LABELS).toMatchObject({
      not_indexed: 'Sin indexar', queued: 'En cola', processing: 'Procesando', ready: 'Disponible para la IA', error: 'Error', excluded: 'Excluido de la IA',
    });
  });

  it('formats byte counts with es-AR separators and handles invalid values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(1_048_576)).toBe('1 MB');
    expect(formatBytes(1_073_741_824)).toBe('1 GB');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });

  it('formats valid dates and returns empty text for invalid dates', () => {
    expect(formatDate('2026-01-01T12:00:00.000Z')).toContain('2026');
    expect(formatDate('not-a-date')).toBe('');
    expect(formatDate(null)).toBe('');
  });
});
