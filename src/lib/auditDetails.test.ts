import { describe, expect, it } from 'vitest';
import { formatAuditValue, getAuditDetailRows } from './auditDetails';

describe('audit detail formatting', () => {
  it('shows only modified fields in an update', () => {
    const rows = getAuditDetailRows({
      action: 'update',
      metadata: { before: { name: 'Joystick PS4', stock: 1 }, after: { name: 'Joystick PS4', stock: 4 } },
    } as never);

    expect(rows).toEqual([{ field: 'stock', label: 'Stock', before: 1, after: 4 }]);
  });

  it('summarizes image payloads instead of rendering base64 data', () => {
    expect(formatAuditValue(['data:image/webp;base64,a', 'data:image/webp;base64,b']))
      .toBe('2 imágenes adjuntas');
  });
});
