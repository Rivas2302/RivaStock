import { describe, expect, it } from 'vitest';
import { buildRetailOrderWhatsAppMessage, formatRetailOrderCode } from './catalogOrder';

describe('retail catalog order details', () => {
  it('formats a short, readable per-business order code', () => {
    expect(formatRetailOrderCode(1)).toBe('P-0001');
    expect(formatRetailOrderCode(42)).toBe('P-0042');
    expect(formatRetailOrderCode(10_000)).toBe('P-10000');
    expect(() => formatRetailOrderCode(0)).toThrow();
  });

  it('builds the requested pickup WhatsApp summary and owner link', () => {
    expect(buildRetailOrderWhatsAppMessage({
      businessName: 'Bazar de prueba', orderCode: 'P-0042',
      items: [{ quantity: 2, name: 'Taza', price: 1200 }], total: 2400,
      customerName: 'Ana', deliveryMethod: 'pickup',
    })).toBe([
      'Hola Bazar de prueba! Te hice un pedido por el catálogo.',
      'Pedido P-0042',
      '2 × Taza · $ 1.200',
      'Total: $ 2.400',
      'Nombre: Ana',
      'Entrega: Retiro',
      'Ver pedido: https://rivastock.vercel.app/pedidos/P-0042',
    ].join('\n'));
  });

  it('includes a delivery address only for shipping', () => {
    const message = buildRetailOrderWhatsAppMessage({
      businessName: 'Negocio', orderCode: 'P-0001', items: [], total: 0,
      customerName: 'Ana', deliveryMethod: 'shipping', address: 'Calle 123',
    });
    expect(message).toContain('Entrega: Envío · Calle 123');
  });
});
