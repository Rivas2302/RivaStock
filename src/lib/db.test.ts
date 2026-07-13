import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { fromDb, normalizeSalesReport } from './db';

describe('fromDb', () => {
  it('maps database timestamps to the camelCase application model', () => {
    const event = fromDb<{
      createdAt: string;
      updatedAt: string;
      email_contact: string;
    }>({
      created_at: '2026-07-13T20:00:00.000Z',
      updated_at: '2026-07-13T20:05:00.000Z',
      email_contact: 'contacto@rivastock.test',
    });

    expect(event).toEqual({
      createdAt: '2026-07-13T20:00:00.000Z',
      updatedAt: '2026-07-13T20:05:00.000Z',
      email_contact: 'contacto@rivastock.test',
    });
  });
});

describe('normalizeSalesReport', () => {
  it('normalizes the snake_case keys returned by the deployed RPC', () => {
    const report = normalizeSalesReport({
      kpis: { totalSales: '1200', transactionCount: 2, paidCount: 1, pendingCount: 1, averageTicket: 1200, pendingAmount: 300 },
      daily: [{ date: '2026-07-13', total: '1200', cnt: 1 }],
      byPayment: [{ payment_method: 'Transferencia', total: '1200', cnt: 1 }],
      topProducts: [{ product_id: 'product-1', product_name: 'Yerba', quantity: '3', revenue: '1200' }],
      sales: [{ id: 'sale-1', date: '2026-07-13', product_name: 'Yerba', quantity: 3, unit_price: 400, total: 1200, payment_method: 'Transferencia', status: 'Pagado' }],
      range: { from: '2026-07-13', to: '2026-07-13' },
    });

    expect(report.byPayment[0]).toMatchObject({ paymentMethod: 'Transferencia', count: 1 });
    expect(report.topProducts[0]).toMatchObject({ productId: 'product-1', productName: 'Yerba', quantity: 3 });
    expect(report.sales[0]).toMatchObject({ productName: 'Yerba', unitPrice: 400, paymentMethod: 'Transferencia' });
  });
});
