import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const catalog = readFileSync(resolve(process.cwd(), 'src/pages/PublicCatalog.tsx'), 'utf8');

describe('public reseller catalog on-order disclosure', () => {
  it('explains that on-order products have no immediate stock and an additional delay', () => {
    expect(catalog).toContain('¿Qué significa “Por pedido”?');
    expect(catalog).toContain('no tienen stock inmediato');
    expect(catalog).toContain('la demora estimada');
  });

  it('repeats the warning on product cards and in the cart', () => {
    expect(catalog).toContain('Por pedido · sin stock inmediato');
    expect(catalog).toContain('Sin entrega inmediata');
    expect(catalog).toContain('Tu carrito incluye productos por pedido');
  });

  it('requires acknowledgement before submitting an order containing on-order products', () => {
    expect(catalog).toContain('cartHasOnOrderProducts');
    expect(catalog).toContain('Entiendo las condiciones de los productos por pedido');
    expect(catalog).toContain('<input required type="checkbox"');
  });

  it('keeps the reseller grid and notices compact on mobile', () => {
    expect(catalog).toContain('px-4 py-12 sm:px-6 sm:py-24');
    expect(catalog).toContain('grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-10');
  });

  it('offers explicit stock and on-order filters to reseller buyers', () => {
    expect(catalog).toContain('Filtrar por disponibilidad');
    expect(catalog).toContain('En stock (');
    expect(catalog).toContain('Por pedido (');
    expect(catalog).toContain('matchesResellerAvailabilityFilter');
  });
});
