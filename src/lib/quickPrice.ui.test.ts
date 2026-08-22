import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const page = readSource('src/pages/QuickPrice.tsx');
const app = readSource('src/App.tsx');
const layout = readSource('src/components/Layout.tsx');
const dashboard = readSource('src/pages/Dashboard.tsx');

describe('quick price UI contract', () => {
  it('reuses the scanner in single-scan mode and exposes manual search', () => {
    expect(page).toContain('<BarcodeScannerOverlay');
    expect(page).toContain('onScan={handleScannedCode}');
    expect(page).not.toContain('continuous');
    expect(page).toContain('Buscar por nombre, código, SKU, variante o modelo');
    expect(page).toContain('Escanear otro');
  });

  it('shows the requested read-only product details', () => {
    expect(page).toContain('selectedProduct.name');
    expect(page).toContain('selectedProduct.salePrice');
    expect(page).toContain('Stock disponible');
    expect(page).toContain('Código de barras');
    expect(page).toContain('Variante / modelo');
    expect(page).toContain('getProductImage(selectedProduct)');
  });

  it('uses only read APIs and remains protected by stock read access', () => {
    expect(page).toContain("db.list<Product>('products', user.uid)");
    expect(page).not.toMatch(/db\.(create|update|delete)\s*(?:<|\()/);
    expect(page).not.toContain('callRpc');
    expect(app).toContain('path="consulta-rapida"');
    expect(app).toContain('module="stock" action="read"');
  });

  it('uses the allowed holdings catalog for scan/search and resolves selection by ID', () => {
    expect(page).toContain('getVisibleQuickPriceProducts({');
    expect(page).toContain('findProductByBarcode(visibleProducts, rawCode)');
    expect(page).toContain('searchProducts(visibleProducts, search)');
    expect(page).toContain('resolveSelectedProduct(visibleProducts, selectedProductId)');
    expect(page).toContain('El producto ya no está disponible');
    expect(page).not.toContain('useState<Product | null>');
  });

  it('provides clear entry points from navigation and the dashboard', () => {
    expect(layout).toContain("path: '/consulta-rapida'");
    expect(layout).toContain("name: 'Consulta rápida'");
    expect(dashboard).toContain("navigate('/consulta-rapida')");
    expect(dashboard).toContain('Consultar precio');
  });
});
