import { describe, expect, it } from 'vitest';
import { formatAuditFieldLabel, formatAuditValue, getAuditDetailRows } from './auditDetails';

describe('audit detail formatting', () => {
  it('shows only modified fields in an update', () => {
    const rows = getAuditDetailRows({
      action: 'update',
      metadata: { before: { name: 'Joystick PS4', stock: 1 }, after: { name: 'Joystick PS4', stock: 4 } },
    } as never);

    expect(rows).toEqual([{ field: 'stock', label: 'Stock', before: 1, after: 4 }]);
  });

  it('preserves an explicit cleared value in an update', () => {
    const rows = getAuditDetailRows({
      action: 'update',
      metadata: { before: { notes: 'Entrega urgente' }, after: { notes: null } },
    } as never);

    expect(rows[0]).toMatchObject({ field: 'notes', before: 'Entrega urgente', after: null });
    expect(formatAuditValue(rows[0].after, rows[0].field)).toBe('Sin valor');
  });

  it('summarizes image payloads instead of rendering base64 data', () => {
    expect(formatAuditValue(['data:image/webp;base64,a', 'data:image/webp;base64,b']))
      .toBe('2 imágenes adjuntas');
  });

  it('localizes operational fields, dates and monetary values', () => {
    expect(formatAuditFieldLabel('sale_id')).toBe('ID de venta relacionada');
    expect(formatAuditFieldLabel('source')).toBe('Origen');
    expect(formatAuditValue('2026-07-14', 'date')).toBe('14/07/2026');
    expect(formatAuditValue(10000, 'amount', '$')).toBe('$ 10.000');
  });

  it('describes sale items instead of returning only their count', () => {
    expect(formatAuditValue([
      { product_name: 'Cabezal iPhone x1', quantity: 2, unit_price: 10000 },
    ], 'items', '$')).toBe('Cabezal iPhone x1 · × 2 · $ 10.000');
  });
});
