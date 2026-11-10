import { describe, expect, it } from 'vitest';
import { buildCatalogOrderWhatsAppMessage, buildRetailOrderWhatsAppMessage, formatRetailOrderCode } from './catalogOrder';

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

describe('catalog order WhatsApp confirmation', () => {
  it('includes the reseller identity, reseller prices, on-order labels, total, and order link', () => {
    expect(buildCatalogOrderWhatsAppMessage({
      businessName: 'Tienda de prueba', orderCode: 'P-0042', channel: 'reseller',
      customerName: 'Ana', total: 11800,
      items: [
        { quantity: 1, name: 'Cable USB-C', price: 6800 },
        { quantity: 2, name: 'Auriculares', price: 2500, onOrder: true },
      ],
    })).toBe([
      'Hola Tienda de prueba! Soy Ana, revendedor. Te hice un pedido por el catálogo.',
      'Pedido P-0042',
      '1 × Cable USB-C · $ 6.800',
      '2 × Auriculares (por pedido) · $ 2.500',
      'Total: $ 11.800',
      'Ver pedido: https://rivastock.vercel.app/pedidos/P-0042',
    ].join('\n'));
  });

  it('uses the same receipt format for retail orders without labeling the customer a reseller', () => {
    const message = buildCatalogOrderWhatsAppMessage({
      businessName: 'Tienda de prueba', orderCode: 'P-0001', channel: 'retail',
      customerName: 'Leo', total: 500, items: [{ quantity: 1, name: 'Cable', price: 500 }],
    });
    expect(message).toContain('Hola Tienda de prueba! Soy Leo. Te hice un pedido por el catálogo.');
    expect(message).not.toContain('revendedor');
    expect(message).toContain('Pedido P-0001');
  });
});
