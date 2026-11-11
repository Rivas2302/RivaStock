import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import '../../extensions/shared/product-extract.js';

type ExtractedItem = {
  key: string; code: string | null; altCode: string | null; name: string; price: number | null;
  listPrice: number | null; currency: string; category: string | null; brand: string | null; imageUrl: string | null;
  images: string[]; url: string | null; packSize: number | null; notes: string[];
  needsPriceReview: boolean; raw: string | null; priceOptions?: Array<{ label: string; price: number }> | null;
};
type ExtractResult = { items: ExtractedItem[]; source: string[]; warnings: string[]; reportedTotal: number | null };
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

  it('parses anonymized Babaji cards, preserves model codes, annotates notes, and reads $ 37,125 as ARS 37,125', () => {
    const results = extract.readPage(page('php-cards-long-babaji.html', 'https://babaji.com.ar/catalogo2022x3.php'));
    expect(results.items).toHaveLength(10);
    const first = results.items.find(item => item.code === 'FIX-B-01');
    expect(first).toMatchObject({ name: 'Ventilador Demostracion', price: 37125, currency: 'ARS', category: 'Categoria De Prueba', notes: ['Sin Cambio'], packSize: 6 });
    expect(first?.altCode).toBeNull();
    expect(results.items.find(item => item.code === 'FIX-B-02')).toMatchObject({ altCode: 'ALT-02', name: 'Lampara Demostracion' });
    expect(results.items.find(item => item.code === 'FIX-B-03')?.altCode).toBeNull();
    expect(results.items.find(item => item.code === 'FIX-B-03')?.name).toContain('1002-L');
    expect(results.items.find(item => item.code === 'FIX-B-03')?.packSize).toBeNull();
    expect(results.items.find(item => item.code === 'FIX-B-10')?.needsPriceReview).toBe(true);
  });

  it('reads a generated Babaji catalog containing 924 distinct cards', () => {
    const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', {
      url: 'https://babaji.com.ar/catalogo2022x3.php?rub=99999',
    });
    Object.defineProperty(dom.window, 'getComputedStyle', { value: undefined });
    const main = dom.window.document.querySelector('main')!;
    for (let index = 1; index <= 924; index += 1) {
      const code = `FIX-B-${String(index).padStart(4, '0')}`;
      const card = dom.window.document.createElement('div');
      card.className = 'col-xs-12 col-md-4 caja_producto';
      card.innerHTML = `<div class="contenedor_producto"><div class="col-xs-12"><a><h1>ARTICULO DE PRUEBA ${index} ____</h1></a></div><div class="col-xs-12 foto"><div class="carousel slide"><div class="carousel-inner"><div class="item active"><a class="miniatura_imagen"><img data-codigo="${code}" src="https://images.example.test/${index}.webp" alt=""></a></div></div></div></div><div>Codigo: ${code}<br>Rubro: CATEGORIA DE PRUEBA<br>Ctdad. por bulto: 6<br></div><strong class="caja_precio_noimptk">$ 2,660</strong></div></div>`;
      main.append(card);
    }

    const results = extract.readPage(dom.window.document);
    expect(results.items).toHaveLength(924);
    expect(results.items[0]).toMatchObject({ code: 'FIX-B-0001', name: 'Articulo De Prueba 1', price: 2660 });
    expect(results.items.at(-1)?.code).toBe('FIX-B-0924');
  }, 30_000);

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

  it('reads WooCommerce Woodmart product cards and falls back to a product ID when SKU is blank', () => {
    const document = new JSDOM(`
      <div class="wd-shop-product">
        <div class="wd-product product-grid-item post-10047591">
          <a class="wd-product-img-link" href="https://inovaarg.com/producto/arbol-de-arce-calido/"><img src="https://inovaarg.com/arbol.webp"></a>
          <h3 class="wd-entities-title"><a href="https://inovaarg.com/producto/arbol-de-arce-calido/">Árbol de arce cálido</a></h3>
          <span class="price"><span class="woocommerce-Price-amount">$ 16.500</span></span>
        </div>
      </div>
    `, { url: 'https://inovaarg.com/tienda/page/4/' }).window.document;

    const result = extract.readPage(document);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      code: '10047591', name: 'Árbol de arce cálido', price: 16500,
      url: 'https://inovaarg.com/producto/arbol-de-arce-calido/',
      imageUrl: 'https://inovaarg.com/arbol.webp',
    });
  });

  it('reads Braja card SKUs while excluding its quantity and add controls', () => {
    const document = new JSDOM(`
      <article class="product-card">
        <a class="product-card-link" data-detalle-producto-id="3408" href="/tienda/centro/productos/3408"></a>
        <div class="product-card-media"><img src="https://images.example.test/alargue.webp"></div>
        <div class="product-card-body">
          <span class="product-card-categoria">ELECTRONICA Y ACCESORIOS</span>
          <h3 class="product-card-nombre">ALARGUE ZAPATILLA 9 ENCHUFES</h3>
          <span class="product-card-sku">SKU: PS-341</span>
          <p class="product-card-precio"><span class="product-card-precio-actual">$ 11.900,00</span></p>
          <form><input value="1"><button type="button">AGREGAR</button></form>
        </div>
      </article>
    `, { url: 'https://brajamayorista.com/tienda/centro/productos' }).window.document;

    const result = extract.readPage(document);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ code: 'PS-341', price: 11900, name: 'Alargue Zapatilla 9 Enchufes' });
    expect(result.items[0].url).toBe('https://brajamayorista.com/tienda/centro/productos/3408');
    expect(result.items[0].raw).not.toContain('AGREGAR');
  });

  it('reads all Braja WebP photos from the best srcset candidate on the image subdomain', () => {
    const result = extract.readPage(page('braja-cross-subdomain-webp.html', 'https://brajamayorista.com/tienda/centro/productos?categoria=31'));
    expect(result.items).toHaveLength(5);
    expect(result.items.every(item => item.imageUrl?.startsWith('https://api.brajamayorista.com/uploads/derivados/'))).toBe(true);
    expect(result.items[0].imageUrl).toBe('https://api.brajamayorista.com/uploads/derivados/qa-01/v1-card-320.webp');
    expect(result.items.every(item => item.imageUrl?.endsWith('.webp'))).toBe(true);
  });

  it('extracts mayori.store cards, unit prices inside purchase controls, category, brand, code, and safe pagination data', () => {
    const result = extract.readPage(page('mayori-store-electrobh.html', 'https://mayori.store/electrobh/index.php#productos_page-1'));
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      name: 'Ventilador de prueba', code: 'MELECH-114', brand: 'Marca Demo', category: 'Hogar',
      price: 4043.07, imageUrl: 'https://mayori.store/images/qa-01.webp',
    });
    expect(result.items[1]).toMatchObject({ name: 'SILLA plegable X 10U', code: '5702', altCode: 'BS', brand: 'Marca Ficticia', category: 'Muebles', price: 12500 });
    expect(result.items[1].packSize).toBeNull();
    expect(result.items.every(item => !item.raw?.includes('Texto fijo de demostración'))).toBe(true);
  });

  it('reads generic data-sku cards, prioritizes ARS unit prices, separates pack prices, and ignores small overlays', () => {
    const document = new JSDOM(`
      <main>
        <button type="button">Todos 450</button><button type="button">Hogar</button>
        <article class="prod" data-sku="12277">
          <span class="ceja">Iluminación</span><p class="nombre">Lámpara de demostración</p>
          <div class="meta">Cód. 12277 · Bulto x30</div>
          <div class="precio"><span class="usd">USD 7,90 c/u</span><span class="ars">ARG $ 12.443 c/u</span></div>
          <div class="bulto-precio">ARG $ 373.290 por bulto</div>
          <div class="foto"><img width="320" height="240" src="https://res.cloudinary.com/demo/image/upload/f_auto,w_640/lamp.webp"><img class="badge" width="22" height="22" src="https://res.cloudinary.com/demo/image/upload/mark.png"></div>
        </article>
      </main>
    `, { url: 'https://catalogue.example.test/products' }).window.document;

    const result = extract.readPage(document);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      code: '12277', name: 'Lámpara de demostración', price: 12443, currency: 'ARS',
      category: 'Iluminación', packSize: 30, packPrice: 373290, packCurrency: 'ARS',
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/f_auto,w_640/lamp.webp',
    });
    expect(result.reportedTotal).toBe(450);
    expect(result.items[0].images).toHaveLength(1);
    expect(result.items[0].imageUrl).not.toContain('mark.png');
  });

  it('prefers a rendered product photo over a larger natural-size hidden overlay', () => {
    const document = new JSDOM(`
      <article data-sku="PHOTO-1">
        <p class="nombre">Producto con foto</p>
        <div class="precio">ARG $ 1.200 c/u</div>
        <div class="foto">
          <img src="https://res.cloudinary.com/demo/product.webp">
          <img src="https://supplier.example.test/assets/brand-image.png">
        </div>
      </article>
    `, { url: 'https://supplier.example.test/products' }).window.document;
    const [productImage, overlayImage] = [...document.querySelectorAll('img')];
    Object.defineProperties(productImage, {
      naturalWidth: { value: 600 }, naturalHeight: { value: 450 },
      getBoundingClientRect: { value: () => ({ width: 233, height: 155 }) },
    });
    Object.defineProperties(overlayImage, {
      naturalWidth: { value: 625 }, naturalHeight: { value: 667 },
      getBoundingClientRect: { value: () => ({ width: 0, height: 0 }) },
    });

    const result = extract.readPage(document);
    expect(result.items[0].imageUrl).toBe('https://res.cloudinary.com/demo/product.webp');
    expect(result.items[0].images).toEqual(['https://res.cloudinary.com/demo/product.webp']);
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
