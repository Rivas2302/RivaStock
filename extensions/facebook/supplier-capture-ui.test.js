import { describe, expect, it } from 'vitest';
import { supplierCaptureStatus } from './supplier-capture-ui.js';

describe('supplier capture popup status', () => {
  it('does not show an early empty-page warning after products arrive', () => {
    const status = supplierCaptureStatus({
      status: 'complete',
      items: [{ name: 'Product' }],
      warnings: ['No encontramos productos en esta página. Si requiere clave o JavaScript, iniciá sesión en el proveedor y volvé a leer desde su página.'],
    });

    expect(status).toBe('');
  });

  it('keeps the login hint when the completed capture is empty', () => {
    expect(supplierCaptureStatus({ status: 'complete', items: [], warnings: [] }))
      .toContain('Ingresá primero con tu clave');
  });

  it('keeps relevant warnings and category guidance', () => {
    expect(supplierCaptureStatus({ status: 'complete', items: [{ name: 'Product' }], warnings: ['Hay productos sin precio; quedaron marcados para revisar y no se importan como costo cero.'] }))
      .toContain('Hay productos sin precio');
    expect(supplierCaptureStatus({ status: 'categories-available', items: [], warnings: [] }))
      .toContain('recorrerlas sin usar flechas de carrusel');
  });
});
