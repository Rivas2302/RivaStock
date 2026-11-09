import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractSupplierListCatalog, extractSupplierListFileText, extractSupplierListPageText, fetchSupplierCatalogImage, parseSupplierListText } from './supplierListImportSource';

const invokeMock = vi.hoisted(() => vi.fn());
const rivaCatalogSourceMock = vi.hoisted(() => vi.fn());
const rivaCatalogImageMock = vi.hoisted(() => vi.fn());
const tesseractWorkerMock = vi.hoisted(() => ({
  recognize: vi.fn(),
  terminate: vi.fn(),
}));
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: invokeMock } } }));
vi.mock('./rivaCatalogSupplierImport', () => ({
  loadRivaCatalogSupplierSource: rivaCatalogSourceMock,
  fetchRivaCatalogImage: rivaCatalogImageMock,
}));
vi.mock('tesseract.js', () => ({ createWorker: vi.fn(async () => tesseractWorkerMock) }));

describe('supplier list source extraction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    invokeMock.mockReset();
    rivaCatalogSourceMock.mockReset();
    rivaCatalogImageMock.mockReset();
    tesseractWorkerMock.recognize.mockReset();
    tesseractWorkerMock.terminate.mockReset();
    vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs');
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
  }, 15_000);

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

  it('renders an image-only PDF page and extracts its text through OCR', async () => {
    const pdfDocumentMock = {
      numPages: 1,
      getPage: vi.fn(),
      destroy: vi.fn(),
    };
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: vi.fn(() => ({ promise: Promise.resolve(pdfDocumentMock), destroy: vi.fn() })),
    }));
    vi.resetModules();
    const { extractSupplierListFileText: extractScannedPdf } = await import('./supplierListImportSource');
    const page = {
      getTextContent: vi.fn(async () => ({ items: [] })),
      getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 200 * scale, height: 100 * scale })),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
    };
    pdfDocumentMock.getPage.mockResolvedValue(page);
    tesseractWorkerMock.recognize.mockResolvedValue({ data: { text: 'Lámpara solar USD 7,75' } });
    tesseractWorkerMock.terminate.mockResolvedValue(undefined);
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({})),
    };
    vi.stubGlobal('window', { document: { createElement: vi.fn(() => canvas) } });
    const file = Object.assign(new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }), { name: 'escaneado.pdf' }) as File;

    await expect(extractScannedPdf(file)).resolves.toContain('Lámpara solar USD 7,75');
    expect(page.render).toHaveBeenCalledOnce();
    expect(tesseractWorkerMock.recognize).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(tesseractWorkerMock.terminate).toHaveBeenCalledOnce();
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

  it('reads a RivaStock catalog directly and preserves its stable product ID without using fetch-url', async () => {
    rivaCatalogSourceMock.mockResolvedValue({
      slug: 'cuenta-b', businessName: 'Cuenta B', showPrices: true,
      items: [{ id: '10000000-0000-4000-8000-000000000001', name: 'Cable', price: 12500, category: 'Accesorios', imageUrl: 'https://project.supabase.co/photo.webp', imageUrls: ['https://project.supabase.co/photo.webp'] }],
    });
    await expect(extractSupplierListCatalog('https://rivastock.vercel.app/catalogo/cuenta-b')).resolves.toMatchObject({
      source: 'rivastock', originName: 'Cuenta B', sourceSlug: 'cuenta-b', currency: 'ARS',
      items: [{ code: '10000000-0000-4000-8000-000000000001', price: 12500, imageUrls: ['https://project.supabase.co/photo.webp'] }],
    });
    expect(rivaCatalogSourceMock).toHaveBeenCalledWith('https://rivastock.vercel.app/catalogo/cuenta-b');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('downloads a supplier-domain image through the protected proxy and rejects unrelated hosts', async () => {
    invokeMock.mockResolvedValue({ data: { mimeType: 'image/jpeg', base64: 'AQID' }, error: null });
    const image = await fetchSupplierCatalogImage('https://api.supplier.com/images/one.jpg', 'https://supplier.com/catalog');
    expect(image.type).toBe('image/jpeg');
    expect(image.size).toBe(3);
    expect(invokeMock).toHaveBeenCalledWith('fetch-url', { body: {
      url: 'https://api.supplier.com/images/one.jpg', sourceOrigin: 'https://supplier.com', mode: 'image',
    } });
    await expect(fetchSupplierCatalogImage('https://other-store.com/image.jpg', 'https://supplier.com/catalog'))
      .rejects.toThrow('mismo sitio');
  });

  it('rejects image responses with formats outside the photo allowlist', async () => {
    invokeMock.mockResolvedValue({ data: { mimeType: 'image/svg+xml', base64: 'PHN2Zy8+' }, error: null });
    await expect(fetchSupplierCatalogImage('https://supplier.com/images/icon.svg', 'https://supplier.com/catalog'))
      .rejects.toThrow('foto que no podemos usar');
  });

  it('shows a Spanish fallback when the server cannot read a supplier page', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('Function returned 502') });
    await expect(extractSupplierListPageText('https://supplier.com/list')).rejects.toThrow('No pudimos leer ese sitio');
  });

});
