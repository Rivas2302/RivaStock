import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modal = readFileSync(
  resolve(process.cwd(), 'src/components/ResellerPriceListModal.tsx'),
  'utf8',
);

describe('reseller supplier lists UI', () => {
  it('lets the operator configure and toggle each active supplier list', () => {
    expect(modal).toContain('Listas por proveedor');
    expect(modal).toContain('Crear lista');
    expect(modal).toContain('Habilitar');
    expect(modal).toContain('Pausar');
    expect(modal).toContain('handleToggleSupplierList');
  });

  it('explains the bulk publishing behavior before activation', () => {
    expect(modal).toContain('todos se publican como “Por pedido”');
    expect(modal).toContain('se ocultan sin perder la selección');
  });
});
