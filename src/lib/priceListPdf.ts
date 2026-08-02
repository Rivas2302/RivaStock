import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Category, InventoryOwner, Product } from '../types';
import { roundPrice } from './utils';
import { getInventoryOwnerName } from './inventoryOwners';

interface PriceListPdfOptions {
  products: Product[];
  categories: Category[];
  businessName: string;
  currencySymbol?: string;
  inventoryOwners?: InventoryOwner[];
}

interface CategoryGroup {
  name: string;
  items: Product[];
}

export interface PriceListPdf {
  blob: Blob;
  fileName: string;
}

const formatPrice = (amount: number, symbol: string): string => {
  const value = roundPrice(amount);
  const formatted = value.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${symbol} ${formatted}`;
};

const getProductCode = (product: Product): string | null => {
  const fields = product.customFields;
  if (!fields) return null;

  for (const key of ['codigo', 'código', 'code', 'CODIGO', 'CÓDIGO', 'sku', 'SKU']) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    const code = String(value).trim();
    if (code) return code;
  }

  return null;
};

const getProductDescription = (product: Product): string => {
  const parts = [product.description, product.notes]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());

  return parts.join('\n') || '-';
};

const groupProductsByCategory = (products: Product[], categories: Category[]): CategoryGroup[] => {
  const buckets = new Map<string, Product[]>();

  for (const product of products) {
    const category = product.category?.trim() || 'Sin categoría';
    buckets.set(category, [...(buckets.get(category) ?? []), product]);
  }

  const ordered = categories.flatMap((category) => {
    const items = buckets.get(category.name);
    buckets.delete(category.name);
    return items?.length ? [{ name: category.name, items }] : [];
  });

  const remaining = Array.from(buckets, ([name, items]) => ({ name, items }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es-AR'));

  return [...ordered, ...remaining].map((group) => ({
    ...group,
    items: group.items.sort((a, b) => a.name.localeCompare(b.name, 'es-AR')),
  }));
};

export function createPriceListPdf({
  products,
  categories,
  businessName,
  currencySymbol = '$',
  inventoryOwners = [],
}: PriceListPdfOptions): PriceListPdf {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = { top: 34, bottom: 18, left: 14, right: 14 };
  const contentWidth = pageWidth - margin.left - margin.right;
  const generatedAt = new Date();
  const generatedDate = generatedAt.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const fileName = `lista-precios-${generatedAt.toISOString().slice(0, 10)}.pdf`;
  const safeBusinessName = businessName.trim() || 'Mi Negocio';
  const groups = groupProductsByCategory(products, categories);

  const drawPageHeader = (pageNumber: number) => {
    if (pageNumber === 1) {
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 28, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.setTextColor(255, 255, 255);
      doc.text('LISTA DE PRECIOS', margin.left, 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(203, 213, 225);
      doc.text(safeBusinessName, margin.left, 19);
      doc.text(`Actualizada el ${generatedDate}`, pageWidth - margin.right, 19, { align: 'right' });
      return;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(safeBusinessName, margin.left, 12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Lista de precios', pageWidth / 2, 12, { align: 'center' });
    doc.text(`Actualizada el ${generatedDate}`, pageWidth - margin.right, 12, { align: 'right' });
    doc.setDrawColor(203, 213, 225);
    doc.line(margin.left, 15, pageWidth - margin.right, 15);
  };

  const drawPageFooter = (pageNumber: number, totalPages: number) => {
    const y = pageHeight - 8;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin.left, y - 4, pageWidth - margin.right, y - 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(safeBusinessName, margin.left, y);
    doc.text(`Página ${pageNumber} de ${totalPages}`, pageWidth - margin.right, y, { align: 'right' });
  };

  drawPageHeader(1);

  if (groups.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text('No hay productos cargados para mostrar.', pageWidth / 2, 62, { align: 'center' });
  }

  let cursorY = margin.top;
  for (const group of groups) {
    const categoryHeight = 9;
    if (cursorY + categoryHeight + 25 > pageHeight - margin.bottom) {
      doc.addPage();
      drawPageHeader(doc.getNumberOfPages());
      cursorY = 22;
    }

    doc.setFillColor(30, 41, 59);
    doc.roundedRect(margin.left, cursorY, contentWidth, categoryHeight, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(group.name.toUpperCase(), margin.left + 3, cursorY + 5.9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    doc.text(`${group.items.length} producto${group.items.length === 1 ? '' : 's'}`, pageWidth - margin.right - 3, cursorY + 5.9, { align: 'right' });
    cursorY += categoryHeight + 2;

    autoTable(doc, {
      startY: cursorY,
      margin: { top: 22, bottom: margin.bottom, left: margin.left, right: margin.right },
      head: [['Producto', 'Descripción', 'Precio']],
      body: group.items.map((product) => {
        const code = getProductCode(product);
        const ownerName = getInventoryOwnerName(product, inventoryOwners);
        const ownerLabel = ownerName ? ` — ${ownerName}` : '';
        const productLabel = `${product.name}${ownerLabel}`;
        return [code ? `${productLabel}\nCódigo: ${code}` : productLabel, getProductDescription(product), formatPrice(product.salePrice, currencySymbol)];
      }),
      styles: {
        font: 'helvetica',
        fontSize: 8.7,
        cellPadding: { top: 2.4, right: 2.5, bottom: 2.4, left: 2.5 },
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        overflow: 'linebreak',
        valign: 'middle',
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [51, 65, 85],
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.42, fontStyle: 'bold' },
        1: { cellWidth: contentWidth * 0.38 },
        2: { cellWidth: contentWidth * 0.20, halign: 'right', fontStyle: 'bold', textColor: [15, 23, 42] },
      },
      didDrawPage: (data) => {
        if (data.pageNumber > 1) drawPageHeader(data.pageNumber);
      },
    });

    cursorY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    drawPageFooter(page, totalPages);
  }

  return { blob: doc.output('blob') as Blob, fileName };
}
