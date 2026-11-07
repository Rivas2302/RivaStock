import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractSupplierListFileText, extractSupplierListPageText, parseSupplierListText } from './supplierListImportSource';

describe('supplier list source extraction', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('turns unstructured PDF or OCR text into rows for AI review', () => {
    expect(parseSupplierListText('Vaso térmico acero\nBotella deportiva 750 ml')).toMatchObject([
      { sourceRow: 1, name: 'Vaso térmico acero', supplierCost: null, error: 'La IA debe revisar el costo de esta fila.' },
      { sourceRow: 2, name: 'Botella deportiva 750 ml', supplierCost: null },
    ]);
  });

  it('maps tabular PDF or page text to known columns', () => {
    expect(parseSupplierListText('Producto\tCosto\tCategoría\nTaza\t2.500\tHogar')).toMatchObject([
      { sourceRow: 2, name: 'Taza', supplierCost: 2500, category: 'Hogar', error: null },
    ]);
  });

  it('extracts selectable text from a generated PDF before sending it to the AI reviewer', async () => {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF();
    pdf.text('Producto    Costo', 15, 20);
    pdf.text('Taza térmica    2500', 15, 30);
    const file = Object.assign(new Blob([new Uint8Array(pdf.output('arraybuffer'))], { type: 'application/pdf' }), { name: 'lista.pdf' }) as File;
    await expect(extractSupplierListFileText(file)).resolves.toContain('Taza térmica');
  });

  it('rejects excessive source rows', () => {
    expect(() => parseSupplierListText(Array.from({ length: 502 }, (_, index) => `Fila ${index}`).join('\n')))
      .toThrow('500 filas');
  });

  it.each(['http://supplier.example/list', 'https://user:pass@supplier.example/list', 'https://192.168.1.12/list', 'https://catalog.local/list'])
    ('rejects unsafe supplier page URL %s before making a request', async url => {
      await expect(extractSupplierListPageText(url)).rejects.toThrow();
    });

  it('reads public text pages without sending cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Producto\tCosto\nTaza\t2500', {
      headers: { 'content-type': 'text/plain' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(extractSupplierListPageText('https://supplier.example/list')).resolves.toContain('Taza');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer' });
  });

  it('rejects supplier pages above the two megabyte read limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1), {
      headers: { 'content-type': 'text/plain' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(extractSupplierListPageText('https://supplier.example/list')).rejects.toThrow('2 MB');
  });
});
