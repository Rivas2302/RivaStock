import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modal = readFileSync(
  resolve(process.cwd(), 'src/components/ResellerPriceListModal.tsx'),
  'utf8',
);

describe('reseller product economics UI', () => {
  it('shows the applied cost next to the retail price', () => {
    expect(modal).toContain("Minorista: {formatCurrency(product.salePrice)} · Costo:");
  });

  it('replaces the ambiguous estimate with a unit profit based on the applied cost', () => {
    expect(modal).toContain('Ganancia por unidad');
    expect(modal).toContain('Ganancia mínima por unidad');
    expect(modal).toContain('Cálculo conservador con el costo más alto');
    expect(modal).not.toContain('Ganancia estimada');
  });

  it('does not promise profit when the purchase cost is missing', () => {
    expect(modal).toContain('Ganancia no disponible: falta cargar el costo.');
  });
});
