import { loadPdfRuntime } from './pdfRuntime';
import type jsPDF from 'jspdf';
import type { Category, InventoryOwner, PriceListAvailability, Product } from '../types';
import { roundPrice } from './utils';
import { getInventoryOwnerName } from './inventoryOwners';

interface PriceListPdfOptions {
  products: Product[];
  categories: Category[];
  businessName: string;
  currencySymbol?: string;
  inventoryOwners?: InventoryOwner[];
  title?: string;
  fileNamePrefix?: string;
  availabilityByProductId?: Record<string, PriceListAvailability>;
  commercialNotice?: string | null;
  includeInventoryOwner?: boolean;
  includeInternalNotes?: boolean;
  includeCode?: boolean;
  includePhotos?: boolean;
  productUrlByProductId?: Record<string, string>;
  groupByCategory?: boolean;
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

async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
        element.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(image.naturalWidth || 800, 800);
      canvas.height = Math.max(1, Math.round(canvas.width * (image.naturalHeight || 800) / Math.max(1, image.naturalWidth || 800)));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.86);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

const getProductDescription = (product: Product, includeInternalNotes: boolean): string => {
  const parts = includeInternalNotes ? [product.description, product.notes] : [product.description]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());

  return parts.join('\n') || '-';
};

const groupProductsByCategory = (products: Product[], categories: Category[]): CategoryGroup[] => {
  const buckets = new Map<string, Product[]>();

  for (const product of products) {
    const category = product.category?.trim() || 'Sin categoría';
    const items = buckets.get(category) ?? [];
    items.push(product);
    buckets.set(category, items);
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

export async function createPriceListPdf({
  products,
  categories,
  businessName,
  currencySymbol = '$',
  inventoryOwners = [],
  title = 'Lista de precios',
  fileNamePrefix = 'lista-precios',
  availabilityByProductId,
  commercialNotice,
  includeInventoryOwner = true,
  includeInternalNotes = true,
  includeCode = true,
  includePhotos = false,
  productUrlByProductId,
  groupByCategory = true,
}: PriceListPdfOptions): Promise<PriceListPdf> {
  const { jsPDF, autoTable } = await loadPdfRuntime();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = { top: commercialNotice ? 43 : 34, bottom: 18, left: 14, right: 14 };
  const contentWidth = pageWidth - margin.left - margin.right;
  const generatedAt = new Date();
  const generatedDate = generatedAt.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const fileName = `${fileNamePrefix}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
  const safeBusinessName = businessName.trim() || 'Mi Negocio';
  const groups = groupByCategory
    ? groupProductsByCategory(products, categories)
    : [{ name: 'Productos', items: [...products].sort((a, b) => a.name.localeCompare(b.name, 'es-AR')) }];
  const imageDataByProductId = new Map<string, string | null>();
  if (includePhotos) {
    const imageRows = await Promise.all(products.map(async product => {
      const imageUrl = product.images?.find(Boolean) ?? product.imageUrl;
      return [product.id, imageUrl ? await loadImageDataUrl(imageUrl) : null] as const;
    }));
    for (const [productId, imageData] of imageRows) imageDataByProductId.set(productId, imageData);
  }

  const drawPageHeader = (pageNumber: number) => {
    if (pageNumber === 1) {
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 28, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.setTextColor(255, 255, 255);
      doc.text(title.toUpperCase(), margin.left, 12);
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
    doc.text(title, pageWidth / 2, 12, { align: 'center' });
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

  if (commercialNotice) {
    doc.setFillColor(238, 242, 255);
    doc.roundedRect(margin.left, 31, contentWidth, 8, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(55, 65, 81);
    doc.text(commercialNotice, margin.left + 3, 36.2);
  }

  if (groups.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text('No hay productos cargados para mostrar.', pageWidth / 2, 62, { align: 'center' });
  }

  let cursorY = margin.top;
  for (const group of groups) {
    const categoryHeight = groupByCategory ? 9 : 0;
    if (cursorY + categoryHeight + 25 > pageHeight - margin.bottom) {
      doc.addPage();
      drawPageHeader(doc.getNumberOfPages());
      cursorY = 22;
    }

    if (groupByCategory) {
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
    }

    const showAvailability = Boolean(availabilityByProductId);
    autoTable(doc, {
      startY: cursorY,
      margin: { top: 22, bottom: margin.bottom, left: margin.left, right: margin.right },
      head: [includePhotos
        ? (showAvailability ? ['Foto', 'Producto', 'Descripción', 'Disponibilidad', 'Precio'] : ['Foto', 'Producto', 'Descripción', 'Precio'])
        : (showAvailability ? ['Producto', 'Descripción', 'Disponibilidad', 'Precio'] : ['Producto', 'Descripción', 'Precio'])],
      body: group.items.map((product) => {
        const code = includeCode ? getProductCode(product) : null;
        const ownerName = includeInventoryOwner ? getInventoryOwnerName(product, inventoryOwners) : '';
        const ownerLabel = ownerName ? ` — ${ownerName}` : '';
        const productLabel = `${product.name}${ownerLabel}`;
        const productCell = code ? `${productLabel}\nCódigo: ${code}` : productLabel;
        const productUrl = productUrlByProductId?.[product.id];
        const photoProductCell = productUrl ? `${productLabel}\nVer precio actualizado` : productCell;
        const cells = includePhotos
          ? ['', photoProductCell, getProductDescription(product, includeInternalNotes)]
          : [productCell, getProductDescription(product, includeInternalNotes)];
        if (showAvailability) {
          cells.push(
            availabilityByProductId?.[product.id] === 'on_order'
              ? 'Bajo pedido'
              : availabilityByProductId?.[product.id] === 'out_of_stock'
                ? 'Agotado'
                : 'Disponible',
          );
        }
        cells.push(formatPrice(product.salePrice, currencySymbol));
        return cells;
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
        ...(includePhotos ? { minCellHeight: 20 } : {}),
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [51, 65, 85],
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: includePhotos
        ? (showAvailability ? {
          0: { cellWidth: contentWidth * 0.11, minCellHeight: 20 },
          1: { cellWidth: contentWidth * 0.24, fontStyle: 'bold' },
          2: { cellWidth: contentWidth * 0.24 },
          3: { cellWidth: contentWidth * 0.19, fontStyle: 'bold' },
          4: { cellWidth: contentWidth * 0.22, halign: 'right', fontStyle: 'bold', textColor: [15, 23, 42] },
        } : {
          0: { cellWidth: contentWidth * 0.11, minCellHeight: 20 },
          1: { cellWidth: contentWidth * 0.28, fontStyle: 'bold' },
          2: { cellWidth: contentWidth * 0.35 },
          3: { cellWidth: contentWidth * 0.26, halign: 'right', fontStyle: 'bold', textColor: [15, 23, 42] },
        })
        : (showAvailability ? {
          0: { cellWidth: contentWidth * 0.34, fontStyle: 'bold' },
          1: { cellWidth: contentWidth * 0.30 },
          2: { cellWidth: contentWidth * 0.17, fontStyle: 'bold' },
          3: { cellWidth: contentWidth * 0.19, halign: 'right', fontStyle: 'bold', textColor: [15, 23, 42] },
        } : {
          0: { cellWidth: contentWidth * 0.42, fontStyle: 'bold' },
          1: { cellWidth: contentWidth * 0.38 },
          2: { cellWidth: contentWidth * 0.20, halign: 'right', fontStyle: 'bold', textColor: [15, 23, 42] },
        }),
      didDrawCell: (data) => {
        if (!includePhotos || data.section !== 'body') return;
        const product = group.items[data.row.index];
        if (data.column.index === 0) {
          const imageData = imageDataByProductId.get(product?.id);
          if (imageData) {
            const size = Math.max(1, Math.min(data.cell.width - 2, data.cell.height - 2));
            doc.addImage(imageData, 'JPEG', data.cell.x + (data.cell.width - size) / 2, data.cell.y + (data.cell.height - size) / 2, size, size);
          }
          return;
        }
        if (data.column.index === 1 && product?.id && productUrlByProductId?.[product.id]) {
          doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: productUrlByProductId[product.id] });
        }
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
