import { describe, expect, it } from 'vitest';
import { isPendingOrder, sortSupplierOrders, trackingUrl, validateOrderPdf, type SupplierOrder } from './supplierOrders';

const order = (id: string, status: SupplierOrder['status'], date = '2026-10-14') => ({ id, status, ordered_on: date, created_at: date } as SupplierOrder);
describe('supplier order workflow', () => {
  it('keeps ready orders first and oldest pending orders visible before newer ones', () => {
    const rows = [order('closed', 'received'), order('new', 'pending'), order('old', 'pending', '2026-01-01'), order('ready', 'ready'), order('transit', 'transit')];
    expect(sortSupplierOrders(rows.filter(isPendingOrder)).map(o => o.id)).toEqual(['ready', 'transit', 'old', 'new']);
    expect(isPendingOrder(order('cancelled', 'cancelled'))).toBe(false);
    expect(rows[0].id).toBe('closed');
  });
  it('preserves leading zeros in the official tracking link and rejects invalid guides', () => {
    expect(trackingUrl('001234567890')).toBe('https://formularios.viacargo.com.ar/seguimiento-envio/001234567890');
    for (const guide of ['', '123', '12345678901x', '../123456789']) expect(() => trackingUrl(guide)).toThrow();
  });
  it('checks PDF contents and size before uploading', async () => {
    await expect(validateOrderPdf(new File(['%PDF-1.7\n'], 'pedido.pdf'))).resolves.toBeUndefined();
    await expect(validateOrderPdf(new File(['<html>'], 'pedido.pdf'))).rejects.toThrow('PDF válido');
    await expect(validateOrderPdf(new File(['%PDF-'], 'pedido.html'))).rejects.toThrow('10 MB');
    await expect(validateOrderPdf(new File(['%PDF-', new Uint8Array(10485760)], 'pedido.pdf'))).rejects.toThrow('10 MB');
  });
});
