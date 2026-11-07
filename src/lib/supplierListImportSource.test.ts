import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractSupplierListCatalog, extractSupplierListFileText, extractSupplierListPageText, parseSupplierListText } from './supplierListImportSource';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: invokeMock } } }));

describe('supplier list source extraction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    invokeMock.mockReset();
  });
  it('turns unstructured PDF or OCR text into rows for AI review', () => {
    expect(parseSupplierListText('Vaso térmico acero\nBotella deportiva 750 ml')).toMatchObject([
      { sourceRow: 1, name: 'Vaso térmico acero', supplierCost: null, error: 'La IA debe revisar el costo de esta fila.' },
      { sourceRow: 2, name: 'Botella deportiva 750 ml', supplierCost: null },
    ]);
  });

  it('parses localized prices, joins neighboring name and price lines, and removes navigation noise', () => {
    expect(parseSupplierListText([
      'Ir al contenido', 'Menú', 'LAMPARA SOLAR', 'USD 15,30',
      'Cable iPhone C — $ 12.345,67', 'Adaptador 12345.00', 'C91015 Cargador USB', 'Carrito', 'Todos los derechos reservados',
    ].join('\n'))).toMatchObject([
      { sourceRow: 1, name: 'LAMPARA SOLAR', supplierCost: 15.3, error: null },
      { sourceRow: 2, name: 'Cable iPhone C', supplierCost: 12345.67, error: null },
      { sourceRow: 3, name: 'Adaptador', supplierCost: 12345, error: null },
      { sourceRow: 4, name: 'C91015 Cargador USB', supplierCost: null, error: 'La IA debe revisar el costo de esta fila.' },
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

  it('reads selectable text from a 25 MB PDF and reports page progress', async () => {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF();
    pdf.text('Producto    Costo', 15, 20);
    pdf.text('Taza térmica    2500', 15, 30);
    const pdfBytes = new Uint8Array(pdf.output('arraybuffer'));
    const padding = new Uint8Array(25 * 1024 * 1024 - pdfBytes.byteLength).fill(32);
    const file = Object.assign(new Blob([pdfBytes, padding], { type: 'application/pdf' }), { name: 'lista-grande.pdf' }) as File;
    const progress = vi.fn();
    await expect(extractSupplierListFileText(file, progress)).resolves.toContain('Taza térmica');
    expect(progress).toHaveBeenCalledWith(1, 1, undefined);
  });

  it('rejects excessive source rows', () => {
    expect(() => parseSupplierListText(Array.from({ length: 3002 }, (_, index) => `Fila ${index}`).join('\n')))
      .toThrow('3000 filas');
    expect(parseSupplierListText(Array.from({ length: 3000 }, (_, index) => `Fila ${index}`).join('\n'))).toHaveLength(3000);
  });

  it.each(['http://supplier.example/list', 'https://user:pass@supplier.example/list', 'https://192.168.1.12/list', 'https://catalog.local/list', 'https://supplier.example:8443/list'])
    ('rejects unsafe supplier page URL %s before making a request', async url => {
      await expect(extractSupplierListPageText(url)).rejects.toThrow();
      expect(invokeMock).not.toHaveBeenCalled();
    });

  it('reads a public supplier page through the server proxy without forwarding page credentials', async () => {
    invokeMock.mockResolvedValue({ data: { text: 'Producto\tCosto\nTaza\t2500' }, error: null });
    await expect(extractSupplierListPageText('https://supplier.com/list')).resolves.toContain('Taza');
    expect(invokeMock).toHaveBeenCalledWith('fetch-url', { body: { url: 'https://supplier.com/list' } });
  });

  it('requests structured catalog mode and preserves source currency and product codes', async () => {
    invokeMock.mockResolvedValue({ data: {
      source: 'woocommerce', currency: 'USD',
      items: [{ code: 'SKU-1', name: 'Cable', price: 7.75, category: 'Accesorios', imageUrl: null, url: null }],
    }, error: null });
    await expect(extractSupplierListCatalog('https://supplier.com/catalog')).resolves.toMatchObject({
      source: 'woocommerce', currency: 'USD', items: [{ code: 'SKU-1', price: 7.75 }],
    });
    expect(invokeMock).toHaveBeenCalledWith('fetch-url', { body: { url: 'https://supplier.com/catalog', mode: 'catalog' } });
  });

  it('shows a Spanish fallback when the server cannot read a supplier page', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('Function returned 502') });
    await expect(extractSupplierListPageText('https://supplier.com/list')).rejects.toThrow('No pudimos leer ese sitio');
  });

});
