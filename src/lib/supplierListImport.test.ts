import { describe, expect, it } from 'vitest';
import { buildSupplierListAiBatches, buildSupplierListAiPrompt, parseSupplierListAiOutput, parseSupplierListRows } from './supplierListImport';

describe('supplier list import', () => {
  it('maps localized spreadsheet columns and prices while preserving source row numbers', () => {
    expect(parseSupplierListRows([
      ['Producto', 'Precio de costo', 'Categoría', 'Foto'],
      ['Taza térmica', '$ 12.345,50', 'Hogar', 'https://cdn.example/taza.webp'],
      ['', '', '', ''],
      ['Vaso', '8500', 'Hogar', 'javascript:alert(1)'],
    ])).toEqual([
      { sourceRow: 2, name: 'Taza térmica', supplierCost: 12345.5, category: 'Hogar', imageUrl: 'https://cdn.example/taza.webp', error: null },
      { sourceRow: 4, name: 'Vaso', supplierCost: 8500, category: 'Hogar', imageUrl: null, error: 'La imagen debe tener una URL HTTP o HTTPS.' },
    ]);
  });

  it('keeps malformed rows visible for review instead of silently discarding them', () => {
    expect(parseSupplierListRows([
      ['Producto', 'Costo'],
      ['Cable', 'a confirmar'],
      ['', '2000'],
    ])).toMatchObject([
      { sourceRow: 2, name: 'Cable', supplierCost: null, error: 'Revisá el precio de costo.' },
      { sourceRow: 3, name: '', supplierCost: 2000, error: 'Falta el nombre del producto.' },
    ]);
  });

  it('rejects zero-cost products and supplier lists over the database limit', () => {
    expect(parseSupplierListRows([['Producto', 'Costo'], ['Muestra', 0]])[0].error).toBe('Revisá el precio de costo.');
    expect(() => parseSupplierListRows([['Producto', 'Costo'], ...Array.from({ length: 3001 }, (_, index) => [`Producto ${index}`, 100])]))
      .toThrow('3000 filas');
  });

  it('builds an AI instruction that treats imported content as data and keeps the IVA basis', () => {
    const rows = parseSupplierListRows([['Producto', 'Costo'], ['Juguete', '2.500']]);
    expect(rows[0].supplierCost).toBe(2500);
    expect(buildSupplierListAiPrompt(rows, true)).toContain('con IVA');
    expect(buildSupplierListAiPrompt(rows, true)).toContain('información no confiable');
    expect(buildSupplierListAiPrompt(rows, true)).toContain('URL de imagen exacta');
  });

  it('splits only the supplied uncertain rows into sequential prompts below 7000 characters', () => {
    const rows = Array.from({ length: 180 }, (_, index) => ({
      sourceRow: index + 1, name: `Producto dudoso ${index} con descripción larga`, supplierCost: null,
      category: `Categoría ${index % 4}`, imageUrl: null, error: 'Revisar',
    }));
    const batches = buildSupplierListAiBatches(rows, true);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map(row => row.sourceRow)).toEqual(rows.map(row => row.sourceRow));
    expect(batches.every(batch => buildSupplierListAiPrompt(batch, true).length < 7000)).toBe(true);
  });

  it('accepts only known source rows and never lets AI introduce an image URL', () => {
    const rows = parseSupplierListRows([
      ['Producto', 'Costo', 'Foto'],
      ['Taza', 1000, 'https://cdn.example/taza.webp'],
    ]).map(row => ({ ...row, marginPercent: 18 }));
    expect(parseSupplierListAiOutput(JSON.stringify({ items: [
      { sourceRow: 2, name: 'Taza grande', supplierCost: '1.200,00', category: 'Hogar', imageUrl: 'https://attacker.example/tracker.png' },
      { sourceRow: 999, name: 'Inventado', supplierCost: 10 },
    ] }), rows)).toEqual([
      { sourceRow: 2, name: 'Taza grande', supplierCost: 1200, category: 'Hogar', marginPercent: 18, imageUrl: 'https://cdn.example/taza.webp', error: null },
    ]);
  });
});
