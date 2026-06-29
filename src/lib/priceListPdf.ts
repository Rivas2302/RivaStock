import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Category, Product } from '../types';
import { roundPrice } from './utils';

interface PriceListPdfOptions {
  products: Product[];
  categories: Category[];
  businessName: string;
  currencySymbol?: string;
}

interface CategoryGroup {
  name: string;
  items: Product[];
}

const formatPrice = (amount: number, symbol: string): string => {
  const value = roundPrice(amount);
  const formatted = value.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${symbol} ${formatted}`;
};

const getProductCode = (p: Product): string | null => {
  const cf = p.customFields;
  if (!cf) return null;
  const candidates = ['codigo', 'code', 'Código', 'Code', 'CODIGO', 'sku', 'SKU'];
  for (const key of candidates) {
    const raw = cf[key];
    if (raw === null || raw === undefined) continue;
    const str = String(raw).trim();
    if (str.length > 0) return str;
  }
  return null;
};

const getProductDescription = (p: Product): string => {
  const parts: string[] = [];
  if (p.description && p.description.trim().length > 0) {
    parts.push(p.description.trim());
  }
  if (p.notes && p.notes.trim().length > 0) {
    parts.push(p.notes.trim());
  }
  if (parts.length === 0) return '—';
  return parts.join('\n');
};

const groupProductsByCategory = (
  products: Product[],
  categories: Category[],
): CategoryGroup[] => {
  const buckets = new Map<string, Product[]>();
  for (const p of products) {
    const key = (p.category ?? '').trim() || 'Sin categoría';
    const arr = buckets.get(key);
    if (arr) arr.push(p);
    else buckets.set(key, [p]);
  }

  const ordered: CategoryGroup[] = [];
  for (const c of categories) {
    const items = buckets.get(c.name);
    if (items && items.length > 0) {
      ordered.push({ name: c.name, items });
      buckets.delete(c.name);
    }
  }

  const leftover = Array.from(buckets.entries())
    .filter(([, items]) => items.length > 0)
    .map(([name, items]) => ({ name, items }));
  leftover.sort((a, b) => a.name.localeCompare(b.name, 'es-AR'));
  ordered.push(...leftover);

  for (const group of ordered) {
    group.items.sort((a, b) => a.name.localeCompare(b.name, 'es-AR'));
  }

  return ordered;
};

export function generatePriceListPdf({
  products,
  categories,
  businessName,
  currencySymbol = '$',
}: PriceListPdfOptions): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = { top: 22, bottom: 18, left: 14, right: 14 };
  const contentWidth = pageWidth - margin.left - margin.right;

  const generatedAt = new Date();
  const generatedDateStr = generatedAt.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const fileStamp = generatedAt.toISOString().slice(0, 10);
  const safeBusiness = (businessName || '').trim() || 'Mi Negocio';

  const drawPageHeader = (isFirstPage: boolean) => {
    doc.setTextColor(15, 23, 42);
    if (isFirstPage) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text('Lista de Precios por Categoría', pageWidth / 2, 16, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105);
      doc.text(safeBusiness, pageWidth / 2, 22, { align: 'center' });
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generado el ${generatedDateStr}`, pageWidth / 2, 27, { align: 'center' });
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(safeBusiness, margin.left, 12);
      doc.text('Lista de Precios', pageWidth / 2, 12, { align: 'center' });
      doc.text(`Generado el ${generatedDateStr}`, pageWidth - margin.right, 12, { align: 'right' });
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(margin.left, 14, pageWidth - margin.right, 14);
    }
  };

  const drawPageFooter = (pageNumber: number, totalPages: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    const footerY = pageHeight - 8;
    doc.text(safeBusiness, margin.left, footerY);
    doc.text(`Página ${pageNumber} de ${totalPages}`, pageWidth / 2, footerY, { align: 'center' });
    doc.text(`Generado el ${generatedDateStr}`, pageWidth - margin.right, footerY, { align: 'right' });
  };

  const groups = groupProductsByCategory(products, categories);

  if (groups.length === 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text('Lista de Precios por Categoría', pageWidth / 2, 16, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(safeBusiness, pageWidth / 2, 22, { align: 'center' });
    doc.text(`Generado el ${generatedDateStr}`, pageWidth / 2, 27, { align: 'center' });
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text('No hay productos cargados para mostrar.', pageWidth / 2, 60, { align: 'center' });
    drawPageFooter(1, 1);
    doc.save(`lista-precios-${fileStamp}.pdf`);
    return;
  }

  let isFirstPage = true;
  let cursorY = margin.top + 6;
  const minRowsBeforeBreak = 3;
  const rowEstimate = 11;
  const categoryHeaderHeight = 12;

  const onPageDraw = (data: { pageNumber: number }) => {
    drawPageHeader(isFirstPage);
    if (isFirstPage) isFirstPage = false;
  };

  for (const group of groups) {
    if (cursorY + categoryHeaderHeight + minRowsBeforeBreak * rowEstimate > pageHeight - margin.bottom) {
      doc.addPage();
      cursorY = margin.top + 4;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    doc.text(group.name, margin.left, cursorY);
    cursorY += 2;
    doc.setDrawColor(99, 102, 241);
    doc.setLineWidth(0.6);
    doc.line(margin.left, cursorY, margin.left + contentWidth, cursorY);
    cursorY += 5;

    const body = group.items.map((p) => {
      const code = getProductCode(p);
      const nameCell = code ? `${p.name}\nCód: ${code}` : p.name;
      return [nameCell, getProductDescription(p), formatPrice(p.salePrice, currencySymbol)];
    });

    autoTable(doc, {
      startY: cursorY,
      margin: { top: margin.top, bottom: margin.bottom, left: margin.left, right: margin.right },
      head: [['Producto', 'Descripción', 'Precio Venta']],
      body,
      styles: {
        fontSize: 9,
        cellPadding: 2.2,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [99, 102, 241],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.30, fontStyle: 'bold', valign: 'top' },
        1: { cellWidth: contentWidth * 0.50, valign: 'top' },
        2: { cellWidth: contentWidth * 0.20, halign: 'right', fontStyle: 'bold', valign: 'top' },
      },
      didDrawPage: onPageDraw,
    });

    const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    cursorY = finalY + 6;
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawPageFooter(p, totalPages);
  }

  doc.save(`lista-precios-${fileStamp}.pdf`);
}
