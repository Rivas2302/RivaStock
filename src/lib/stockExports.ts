import { loadPdfRuntime } from './pdfRuntime';
import type { Category, Product } from '../types';
import { getCatalogShareUrl } from './catalogShare';

export interface StockInventoryExportRow {
  product: Product;
  ownerName: string;
  stock: number;
  purchaseCost: number | null;
  marginPercent: number | null;
}

export interface CatalogPhotoPdfOptions {
  products: Product[];
  categories: Category[];
  businessName: string;
  currencySymbol?: string;
  catalogSlug?: string | null;
  origin: string;
  stockByProductId: Map<string, number>;
}

function money(value: number, symbol: string): string {
  return symbol + ' ' + Math.round(value).toLocaleString('es-AR');
}

function publicDescription(product: Product): string {
  return product.description?.trim() || '';
}

function isOnOrder(product: Product): boolean {
  const fields = product.customFields ?? {};
  const value = String(fields.availability ?? fields.availabilityStatus ?? fields.disponibilidad ?? '').toLowerCase();
  return fields.onOrder === true || value.includes('pedido') || value.includes('order');
}

async function imageAsJpeg(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = objectUrl;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || 1;
      canvas.height = image.naturalHeight || 1;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.86);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

export async function createCatalogPhotoPdf({
  products,
  categories,
  businessName,
  currencySymbol = '$',
  catalogSlug,
  origin,
  stockByProductId,
}: CatalogPhotoPdfOptions): Promise<{ blob: Blob; fileName: string }> {
  const { jsPDF } = await loadPdfRuntime();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const gap = 6;
  const cardWidth = (pageWidth - margin * 2 - gap) / 2;
  const cardHeight = 57;
  const startY = 34;
  const cardsPerPage = 8;
  const generated = new Date();
  const dateText = generated.toLocaleDateString('es-AR');
  const categoryOrder = new Map(categories.map((category, index) => [category.name, index]));
  const ordered = [...products].sort((a, b) => {
    const categoryDelta = (categoryOrder.get(a.category) ?? 999) - (categoryOrder.get(b.category) ?? 999);
    return categoryDelta || a.name.localeCompare(b.name, 'es-AR');
  });

  for (let index = 0; index < ordered.length; index += 1) {
    const pagePosition = index % cardsPerPage;
    if (index > 0 && pagePosition === 0) doc.addPage();
    if (pagePosition === 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(businessName || 'Catálogo', margin, 13);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Catálogo de productos · Generado el ' + dateText, margin, 19);
      doc.setDrawColor(220, 226, 235);
      doc.line(margin, 23, pageWidth - margin, 23);
    }

    const product = ordered[index];
    const column = pagePosition % 2;
    const row = Math.floor(pagePosition / 2);
    const x = margin + column * (cardWidth + gap);
    const y = startY + row * (cardHeight + 5);
    doc.setDrawColor(220, 226, 235);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cardWidth, cardHeight, 2.5, 2.5, 'FD');

    const imageUrl = product.imageUrl || product.images?.[0];
    const image = imageUrl ? await imageAsJpeg(imageUrl) : null;
    if (image) {
      doc.addImage(image, 'JPEG', x + 4, y + 5, 30, 36, undefined, 'FAST');
    } else {
      doc.setFillColor(243, 246, 250);
      doc.roundedRect(x + 4, y + 5, 30, 36, 2, 2, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(110, 120, 135);
      doc.text('Sin foto', x + 19, y + 24, { align: 'center' });
    }

    const textX = x + 38;
    const textWidth = cardWidth - 42;
    doc.setTextColor(25, 35, 50);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const nameLines = doc.splitTextToSize(product.name, textWidth).slice(0, 2);
    doc.text(nameLines, textX, y + 9);
    const nameHeight = nameLines.length * 4.2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(90, 103, 120);
    doc.text(product.category || 'Sin categoría', textX, y + 12 + nameHeight);
    const description = publicDescription(product);
    if (description) {
      const descriptionLines = doc.splitTextToSize(description, textWidth).slice(0, 2);
      doc.text(descriptionLines, textX, y + 17 + nameHeight);
    }

    const stock = stockByProductId.get(product.id) ?? product.stock;
    const availability = stock > 0 ? 'Disponible' : isOnOrder(product) ? 'Bajo pedido' : 'Agotado';
    doc.setTextColor(stock > 0 || isOnOrder(product) ? 5 : 170, stock > 0 || isOnOrder(product) ? 125 : 35, stock > 0 || isOnOrder(product) ? 90 : 55);
    doc.setFontSize(7.5);
    doc.text(availability, textX, y + 42);
    doc.setTextColor(40, 80, 150);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(money(product.salePrice, currencySymbol), x + 4, y + 51);

    if (catalogSlug) {
      const url = getCatalogShareUrl(origin, catalogSlug, product.id);
      doc.setTextColor(45, 96, 185);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text('Ver producto en el catálogo', textX, y + 51);
      doc.link(textX, y + 47, textWidth, 6, { url });
    }
  }

  const stamp = generated.toISOString().slice(0, 10);
  return { blob: doc.output('blob'), fileName: 'catalogo-fotos-' + stamp + '.pdf' };
}

export async function createStockInventoryWorkbook(
  rows: StockInventoryExportRow[],
  businessName: string,
  currencySymbol = '$',
  filtersLabel = 'Sin filtros adicionales',
): Promise<{ blob: Blob; fileName: string }> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const generated = new Date();
  const excelCurrency = '"' + currencySymbol.replace(/"/g, '""') + '" #,##0;[Red]-"' + currencySymbol.replace(/"/g, '""') + '" #,##0';
  const totalUnits = rows.reduce((sum, row) => sum + row.stock, 0);
  const productCount = new Set(rows.map((row) => row.product.id)).size;
  const costedRows = rows.filter((row) => row.purchaseCost !== null && Number.isFinite(row.purchaseCost));
  const costedUnits = costedRows.reduce((sum, row) => sum + row.stock, 0);
  const missingCostUnits = totalUnits - costedUnits;
  const investment = costedRows.reduce((sum, row) => sum + (row.purchaseCost ?? 0) * row.stock, 0);
  const saleValue = rows.reduce((sum, row) => sum + row.product.salePrice * row.stock, 0);
  const costedSaleValue = costedRows.reduce((sum, row) => sum + row.product.salePrice * row.stock, 0);
  const grossProfit = costedSaleValue - investment;
  const grossMargin = costedSaleValue > 0 ? grossProfit / costedSaleValue : 0;
  const costCoverage = totalUnits > 0 ? costedUnits / totalUnits : 0;
  const holders = [...new Set(rows.map((row) => row.ownerName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es-AR'));
  const holdersLabel = holders.length > 0 ? holders.join(', ') : 'Sin titular asignado';
  const business = businessName || 'RivaStock';

  const summary = [
    [business, '', '', ''],
    ['Generado el', generated, '', ''],
    ['', '', '', ''],
    ['RESUMEN DEL INVENTARIO', '', '', ''],
    ['Productos únicos', productCount, 'Filas por titular', rows.length],
    ['Unidades disponibles', totalUnits, 'Inversión estimada', investment],
    ['Valor potencial a precio de venta', saleValue, 'Ganancia bruta potencial estimada', grossProfit],
    ['Unidades con costo registrado', costedUnits, 'Unidades sin costo registrado', missingCostUnits],
    ['Margen bruto potencial', grossMargin, 'Cobertura de costo', costCoverage],
    ['', '', '', ''],
    ['ALCANCE Y CRITERIOS', '', '', ''],
    ['Filtros aplicados', filtersLabel, '', ''],
    ['Titulares incluidos', holdersLabel, '', ''],
    ['Cálculo de ganancia', 'Venta potencial de las unidades con costo registrado menos la inversión estimada de esas mismas unidades.', '', ''],
    ['Lectura del resultado', 'Es una estimación bruta del stock actual si se vendiera al precio registrado. Las unidades sin costo se excluyen de la ganancia.', '', ''],
    ['No es ganancia neta', 'No descuenta gastos, impuestos, comisiones, envíos ni otros costos operativos.', '', ''],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  summarySheet['!cols'] = [{ wch: 34 }, { wch: 23 }, { wch: 34 }, { wch: 23 }];
  summarySheet['!rows'] = [
    { hpt: 30 },
    { hpt: 22 },
    { hpt: 9 },
    { hpt: 24 },
    { hpt: 24 },
    { hpt: 24 },
    { hpt: 30 },
    { hpt: 24 },
    { hpt: 24 },
    { hpt: 9 },
    { hpt: 24 },
    { hpt: 30 },
    { hpt: 30 },
    { hpt: 38 },
    { hpt: 38 },
    { hpt: 30 },
  ];
  summarySheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 3 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 3 } },
    { s: { r: 10, c: 0 }, e: { r: 10, c: 3 } },
    { s: { r: 11, c: 1 }, e: { r: 11, c: 3 } },
    { s: { r: 12, c: 1 }, e: { r: 12, c: 3 } },
    { s: { r: 13, c: 1 }, e: { r: 13, c: 3 } },
    { s: { r: 14, c: 1 }, e: { r: 14, c: 3 } },
    { s: { r: 15, c: 1 }, e: { r: 15, c: 3 } },
  ];
  if (summarySheet['B2']) summarySheet['B2'].z = 'dd/mm/yyyy hh:mm';
  for (const cell of ['B5', 'D5', 'B6', 'B8', 'D8']) {
    if (summarySheet[cell]) summarySheet[cell].z = '#,##0';
  }
  for (const cell of ['D6', 'B7', 'D7']) {
    if (summarySheet[cell]) summarySheet[cell].z = excelCurrency;
  }
  for (const cell of ['B9', 'D9']) {
    if (summarySheet[cell]) summarySheet[cell].z = '0.0%';
  }
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumen');

  const inventory = [
    [business, '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Generado el', generated, '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Filtros aplicados: ' + filtersLabel, '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Código', 'Titular', 'Categoría', 'Producto', 'Costo unitario', 'Precio de venta', 'Ganancia unitaria', 'Margen bruto', 'Unidades', 'Inversión total', 'Venta potencial', 'Ganancia bruta potencial', 'Disponibilidad', 'Visible en catálogo'],
    ...rows.map((row) => {
      const fields = row.product.customFields ?? {};
      const codeField = Object.entries(fields).find(([key, value]) => /sku|c[oó]digo|code/i.test(key) && value !== null && value !== undefined && String(value).trim());
      const code = row.product.barcode || (codeField ? String(codeField[1]) : '');
      const onOrder = isOnOrder(row.product);
      const hasCost = row.purchaseCost !== null && Number.isFinite(row.purchaseCost);
      const unitCost = hasCost ? row.purchaseCost as number : null;
      const unitProfit = unitCost === null ? '' : row.product.salePrice - unitCost;
      const margin = unitCost === null || row.product.salePrice <= 0 ? '' : (row.product.salePrice - unitCost) / row.product.salePrice;
      return [
        code,
        row.ownerName,
        row.product.category || 'Sin categoría',
        row.product.name,
        unitCost ?? '',
        row.product.salePrice,
        unitProfit,
        margin,
        row.stock,
        unitCost === null ? '' : unitCost * row.stock,
        row.product.salePrice * row.stock,
        unitCost === null ? '' : (row.product.salePrice - unitCost) * row.stock,
        row.stock > 0 ? 'Disponible' : onOrder ? 'Bajo pedido' : 'Agotado',
        row.product.showInCatalog ? 'Sí' : 'No',
      ];
    }),
  ];
  const inventorySheet = XLSX.utils.aoa_to_sheet(inventory);
  inventorySheet['!cols'] = [
    { wch: 18 },
    { wch: 20 },
    { wch: 24 },
    { wch: 42 },
    { wch: 17 },
    { wch: 17 },
    { wch: 19 },
    { wch: 15 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 23 },
    { wch: 18 },
    { wch: 20 },
  ];
  inventorySheet['!rows'] = [{ hpt: 30 }, { hpt: 22 }, { hpt: 24 }, { hpt: 30 }];
  inventorySheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 13 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 13 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 13 } },
  ];
  const lastRow = rows.length + 4;
  inventorySheet['!autofilter'] = { ref: 'A4:N' + lastRow };
  inventorySheet['!freeze'] = { xSplit: 0, ySplit: 4, topLeftCell: 'A5', activePane: 'bottomLeft', state: 'frozen' };
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const excelRow = rowIndex + 5;
    for (const column of ['E', 'F', 'G', 'J', 'K', 'L']) {
      const cell = inventorySheet[column + excelRow];
      if (cell) cell.z = excelCurrency;
    }
    const marginCell = inventorySheet['H' + excelRow];
    if (marginCell) marginCell.z = '0.0%';
    const unitsCell = inventorySheet['I' + excelRow];
    if (unitsCell) unitsCell.z = '#,##0';
  }
  XLSX.utils.book_append_sheet(workbook, inventorySheet, 'Inventario');

  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return {
    blob: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: 'inventario-' + generated.toISOString().slice(0, 10) + '.xlsx',
  };
}
