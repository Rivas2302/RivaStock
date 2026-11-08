import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import '../../extensions/shared/product-extract.js';

type ExtractedItem = {
  key: string; code: string | null; altCode: string | null; name: string; price: number | null;
  listPrice: number | null; currency: string; category: string | null; imageUrl: string | null;
  images: string[]; url: string | null; packSize: number | null; notes: string[];
  needsPriceReview: boolean; raw: string | null; priceOptions?: Array<{ label: string; price: number }> | null;
};
type ExtractResult = { items: ExtractedItem[]; source: string[]; warnings: string[] };
type ProductExtractApi = {
  collectDomEvidence: (document: Document) => Array<Record<string, unknown>>;
  extractSupplierProducts: (evidence: Record<string, unknown>) => ExtractResult;
  parsePrice: (value: unknown, options?: Record<string, unknown>) => { price: number | null; currency: string; needsReview: boolean };
  readPage: (document: Document, jsonResponses?: unknown[]) => ExtractResult;
};
const extract = (globalThis as unknown as { RivaStockProductExtract: ProductExtractApi }).RivaStockProductExtract;
const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'e2e/fixtures/stores', name), 'utf8');
const page = (name: string, url = 'https://fixtures.example.test/catalogo') => new JSDOM(fixture(name), { url }).window.document;

describe('universal supplier product extraction', () => {
  it('reads paginated product JSON, respects WooCommerce minor_unit 0, and deduplicates by code', () => {
    const catalog = JSON.parse(fixture('spa-json.json')) as { responses: unknown[] };
    const results = extract.extractSupplierProducts({ url: 'https://brajamayorista.com/tienda/centro/productos', jsonResponses: catalog.responses });
    expect(results.items).toHaveLength(44);
    expect(results.items[0]).toMatchObject({ code: 'BRAJA-1', price: 119900, currency: 'ARS', imageUrl: 'https://images.example.test/fixture-BRAJA-1.webp' });
    expect(results.source).toContain('network-json');
    expect(results.items.filter(item => item.name && item.price && item.imageUrl)).toHaveLength(44);
    const duplicate = extract.extractSupplierProducts({
      url: 'https://brajamayorista.com/catalogo',
      jsonResponses: [{ products: [{ id: 5, sku: 'NAV009', name: 'Producto repetido', price: '3600', currency: 'ARS', image: '/a.webp' }] },
        { products: [{ id: 6, sku: 'NAV009', name: 'Producto repetido', price: '3600', currency: 'ARS', image: '/a.webp' }] }],
    });
    expect(duplicate.items).toHaveLength(1);
    expect(duplicate.items[0].imageUrl).toBe('https://brajamayorista.com/a.webp');
  });

  it('extracts JSON captured from POST responses without requiring request headers or cookies', () => {
    const capture = JSON.parse(fixture('spa-post-json.json')) as { responses: unknown[] };
    const results = extract.extractSupplierProducts({ url: 'https://mayoristaomega.com/#catalogo', jsonResponses: capture.responses });
    expect(results.items).toHaveLength(11);
    expect(results.source).toContain('network-json');
    expect(results.items.every(item => item.price !== null && item.code && item.imageUrl)).toBe(true);
  });

  it('uses a WooCommerce id when sku is blank and preserves a zero price as review-required', () => {
    const products = JSON.parse(fixture('woocommerce-sku-vacio.json')) as { products: unknown[] };
    const results = extract.extractSupplierProducts({ url: 'https://inovaarg.com/tienda/page/4', jsonResponses: [products] });
    expect(results.items).toHaveLength(6);
    expect(results.items.slice(0, 5).every(item => item.code?.startsWith('inova-'))).toBe(true);
    const missing = results.items.find(item => item.code === 'inova-no-price');
    expect(missing).toMatchObject({ price: null, needsPriceReview: true });
    expect(results.warnings.join(' ')).toContain('sin precio');
  });

  it('extracts the ten anonymized Oestech cards without video art, form text, or carousel controls', () => {
    const results = extract.readPage(page('php-cards-long.html', 'https://oestech.com.ar/catalogo2024.php'));
    expect(results.items).toHaveLength(10);
    expect(results.source).toContain('dom-cards');
    const first = results.items.find(item => item.code === 'FIX-O-01');
    expect(first).toMatchObject({ altCode: 'ALT-01', name: 'Producto Demostracion 01', price: 950, packSize: 12, category: 'Categoria De Prueba' });
    expect(first?.images).toHaveLength(2);
    expect(first?.imageUrl).not.toContain('boton_video_falso');
    expect(first?.raw).not.toContain('Agregar');
    expect(first?.raw).not.toContain('Ver pedido');
    expect(results.items.find(item => item.code === 'FIX-O-02')?.packSize).toBeNull();
    expect(results.items.every(item => item.imageUrl?.startsWith('https://'))).toBe(true);
  });

  it('parses Babaji free text, preserves model codes, annotates non-code notes, and reads $ 37,125 as 37.125', () => {
    const results = extract.readPage(page('php-cards-long-babaji.html', 'https://babaji.com.ar/catalogo2022x3.php'));
    expect(results.items).toHaveLength(10);
    const first = results.items.find(item => item.code === 'FIX-B-01');
    expect(first).toMatchObject({ name: 'Ventilador Demostracion', price: 37125, currency: 'ARS', category: 'Tecno & Hogar', notes: ['Sin Cambio'], packSize: 6 });
    expect(first?.altCode).toBeNull();
    expect(results.items.find(item => item.code === 'FIX-B-02')).toMatchObject({ altCode: 'ALT-02', name: 'Lampara Demostracion' });
    expect(results.items.find(item => item.code === 'FIX-B-03')?.altCode).toBeNull();
    expect(results.items.find(item => item.code === 'FIX-B-03')?.name).toContain('1002-L');
    expect(results.items.find(item => item.code === 'FIX-B-03')?.packSize).toBeNull();
    expect(results.items.find(item => item.code === 'FIX-B-10')?.needsPriceReview).toBe(true);
  });

  it('normalizes Argentine and international prices, currencies, and suspicious amounts', () => {
    expect(extract.parsePrice('$ 15.700,00')).toMatchObject({ price: 15700, currency: 'ARS' });
    expect(extract.parsePrice('$11.900')).toMatchObject({ price: 11900, currency: 'ARS' });
    expect(extract.parsePrice('USD 6,25')).toMatchObject({ price: 6.25, currency: 'USD' });
    expect(extract.parsePrice('U$S 1.234,50')).toMatchObject({ price: 1234.5, currency: 'USD' });
    expect(extract.parsePrice('$ 37,125')).toMatchObject({ price: 37125, currency: 'ARS' });
    expect(extract.parsePrice(0)).toMatchObject({ price: null, needsReview: true });
    expect(extract.parsePrice('$ 99,999,999')).toMatchObject({ price: 99999999, needsReview: true });
    expect(extract.parsePrice('Consultar')).toMatchObject({ price: null, needsReview: true });
  });

  it('reads WooCommerce and Tiendanube DOM cards, JSON-LD and Next state fixtures', () => {
    expect(extract.readPage(page('woocommerce-dom.html')).items).toHaveLength(3);
    expect(extract.readPage(page('tiendanube-dom.html')).items).toHaveLength(2);
    expect(extract.readPage(page('jsonld-itemlist.html')).items).toHaveLength(3);
    expect(extract.readPage(page('next-data.html')).items).toHaveLength(4);
  });

  it('keeps sale and labeled wholesale/retail prices with a review warning', () => {
    const sale = extract.readPage(page('precio-tachado.html'));
    expect(sale.items[0]).toMatchObject({ price: 15700, listPrice: 19900 });
    const labeled = extract.readPage(page('mayorista-minorista.html'));
    expect(labeled.items[0]).toMatchObject({ price: 9500, listPrice: 12000 });
    expect(labeled.items[0].priceOptions).toEqual([{ label: 'mayorista', price: 9500 }, { label: 'minorista', price: 12000 }]);
    expect(labeled.warnings.join(' ')).toContain('mayoristas y minoristas');
  });

  it('does not invent products for empty pages and enforces the 5,000 item cap', () => {
    const empty = extract.readPage(page('sin-productos.html'));
    expect(empty.items).toHaveLength(0);
    expect(empty.warnings[0]).toContain('No encontramos productos');
    const products = Array.from({ length: 5100 }, (_, index) => ({ id: `CAP-${index}`, name: `Producto ${index}`, price: 100, image: 'https://img.example.test/p.webp' }));
    expect(extract.extractSupplierProducts({ url: 'https://fixture.example.test', jsonResponses: [{ products }] }).items).toHaveLength(5000);
  });
});
