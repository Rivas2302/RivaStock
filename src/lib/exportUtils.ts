import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDate, formatCurrency, roundPrice } from './utils';
import type { ReportSaleRow, ReportKpis } from '../types';

export interface ExcelColumn<T> {
  header: string;
  /** Extract a raw value; if omitted, we just return the field. */
  value: (row: T) => string | number | null | undefined;
  width?: number;
}

interface ExportToExcelOptions {
  /** Optional summary block rendered ABOVE the table on the same sheet. */
  summary?: Array<{ label: string; value: string }>;
}

/**
 * Export an array of rows to a single-sheet .xlsx file.
 * Columns are declared explicitly so we control headers + formatting.
 * Currency cells receive a proper number format using the provided symbol
 * so Excel displays them as money (not as a string).
 */
export function exportToExcel<T>(
  rows: T[],
  columns: ExcelColumn<T>[],
  fileName: string,
  sheetName = 'Reporte',
  options: ExportToExcelOptions = {},
): void {
  const headerRow = columns.map(c => c.header);

  const dataMatrix: (string | number | null)[][] = rows.map(row =>
    columns.map(c => {
      const v = c.value(row);
      if (v === null || v === undefined) return '';
      return v as string | number;
    })
  );

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataMatrix]);

  // Column widths (characters). Excel uses ~7px per char; default 14.
  ws['!cols'] = columns.map(c => ({ wch: c.width ?? 18 }));

  // Pretty number format for currency columns — `formatCurrency` shows
  // values like "$ 1.234"; we keep the underlying number and let Excel
  // format it, so users can still SUM/AVG in the spreadsheet.
  // We only apply this when the header looks like a money column to avoid
  // touching the wrong cells.
  const moneyHeaders = new Set(['Precio Unitario', 'Total', 'Ingresos', 'Monto']);
  for (let r = 1; r <= dataMatrix.length; r++) {
    for (let c = 0; c < columns.length; c++) {
      if (!moneyHeaders.has(columns[c].header)) continue;
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = ws[cellRef];
      if (cell && typeof cell.v === 'number') {
        cell.z = '#,##0.00';
      }
    }
  }

  // Optional summary block: shift the table down and add KPI rows on top.
  if (options.summary && options.summary.length > 0) {
    const summaryMatrix: string[][] = options.summary.map(s => [s.label, s.value]);
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ...summaryMatrix,
      [], // spacer
      headerRow,
      ...dataMatrix,
    ]);
    summarySheet['!cols'] = ws['!cols'];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, sheetName.slice(0, 31));
    XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
    return;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

// ─── PDF ────────────────────────────────────────────────────────────────────

export interface PdfReportContext {
  businessName: string;
  catalogSlug?: string;
  /** Public URL of the logo (catalog_config.logoUrl). Optional. */
  logoUrl?: string;
  /** Range displayed in the header, already formatted. */
  rangeLabel: string;
  currencySymbol: string;
  /** Optional KPI block rendered after the header. */
  kpis?: ReportKpis;
}

const INDIGO_RGB: [number, number, number] = [99, 102, 241];
const ZEBRA_RGB: [number, number, number] = [248, 250, 252];

/**
 * Fetch an image URL and return a dataURL + detected format.
 * Returns null on any failure (CORS, 404, timeout) so the caller can fall
 * back to text-only header without throwing.
 */
async function fetchLogoAsDataUrl(
  url: string,
  timeoutMs = 4000,
): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const format: 'PNG' | 'JPEG' =
      blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'JPEG' : 'PNG';

    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve({ dataUrl: reader.result, format });
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ExportToPdfOptions {
  /** Title displayed in the header. Defaults to "Reporte de Ventas". */
  title?: string;
  /** Column definitions for jspdf-autotable. */
  columns: Array<{ header: string; dataKey: string }>;
  /** Map row → cell values (one entry per column dataKey). */
  rows: Array<Record<string, string | number>>;
  fileName: string;
}

/**
 * Export a tabular PDF report with a branded header.
 *
 * Layout:
 *  - Header: businessName (bold) + catalogSlug (small) + range
 *  - Optional logo on the right (loaded best-effort; text-only fallback)
 *  - KPIs summary (4 cells) when provided
 *  - Main data table
 *  - Footer with generated-at + page numbers (via autoTable didDrawPage)
 */
export async function exportToPDF(
  ctx: PdfReportContext,
  options: ExportToPdfOptions,
): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const title = options.title ?? 'Reporte de Ventas';

  // Try to embed the logo (best-effort, non-blocking failure)
  const logoData = ctx.logoUrl ? await fetchLogoAsDataUrl(ctx.logoUrl) : null;
  const headerHeight = 30;

  // Header band
  doc.setFillColor(...INDIGO_RGB);
  doc.rect(0, 0, pageWidth, 8, 'F');

  // Logo (top-right) if available
  if (logoData) {
    try {
      const logoSize = 18;
      doc.addImage(
        logoData.dataUrl,
        logoData.format,
        pageWidth - margin - logoSize,
        12,
        logoSize,
        logoSize,
      );
    } catch {
      // ignore — text header still renders
    }
  }

  // Business name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(ctx.businessName || 'Mi Negocio', margin, 16);

  // Slug + title
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  if (ctx.catalogSlug) {
    doc.text(`@${ctx.catalogSlug}`, margin, 21);
  }
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(title, margin, 27);

  // Range (right side)
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const rangeText = `Período: ${ctx.rangeLabel}`;
  const rangeWidth = doc.getTextWidth(rangeText);
  doc.text(rangeText, pageWidth - margin - rangeWidth - (logoData ? 22 : 0), 27);

  let cursorY = headerHeight + 4;

  // KPIs summary
  if (ctx.kpis) {
    const k = ctx.kpis;
    const cells: Array<[string, string]> = [
      ['Ventas Totales',   formatCurrency(roundPrice(k.totalSales))],
      ['Transacciones',    String(k.transactionCount)],
      ['Ticket Promedio',  formatCurrency(roundPrice(k.averageTicket))],
      ['Pendiente de cobro', formatCurrency(roundPrice(k.pendingAmount))],
    ];
    const colW = (pageWidth - margin * 2) / cells.length;
    cells.forEach(([label, value], i) => {
      const x = margin + i * colW;
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x + 1, cursorY, colW - 2, 16, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(label.toUpperCase(), x + 4, cursorY + 5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(value, x + 4, cursorY + 12);
    });
    cursorY += 22;
  }

  // Main table
  autoTable(doc, {
    startY: cursorY,
    head: [options.columns.map(c => c.header)],
    body: options.rows.map(r => options.columns.map(c => r[c.dataKey] ?? '')),
    styles: {
      fontSize: 8.5,
      cellPadding: 2.5,
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: INDIGO_RGB,
      textColor:  [255, 255, 255],
      fontStyle:  'bold',
      halign:     'left',
    },
    alternateRowStyles: { fillColor: ZEBRA_RGB },
    columnStyles: {
      // Numbers right-aligned by dataKey convention
      Total:          { halign: 'right', cellWidth: 22 },
      Cantidad:       { halign: 'right', cellWidth: 16 },
      'Precio Unit.': { halign: 'right', cellWidth: 22 },
    },
    didDrawPage: (data) => {
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Generado el ${new Date().toLocaleString('es-AR')}`,
        margin,
        pageH - 6,
      );
      const pageStr = `Página ${doc.getNumberOfPages()}`;
      const w = doc.getTextWidth(pageStr);
      doc.text(pageStr, pageWidth - margin - w, pageH - 6);
    },
    margin: { left: margin, right: margin, top: cursorY },
  });

  doc.save(options.fileName.endsWith('.pdf') ? options.fileName : `${options.fileName}.pdf`);
}

// ─── Sales-specific helpers ─────────────────────────────────────────────────

/**
 * Excel export tailored for the Sales report.
 * Keeps numbers as numbers (so Excel can aggregate) but uses currency
 * formatting for money columns. The currency symbol is derived from the
 * user-supplied prefix; we do NOT bake the symbol into the cell text.
 */
export function exportSalesReportToExcel(
  rows: ReportSaleRow[],
  kpis: ReportKpis,
  fileName: string,
  currencySymbol: string,
  rangeLabel: string,
): void {
  const columns: ExcelColumn<ReportSaleRow>[] = [
    { header: 'Fecha',            value: r => formatDate(r.date),                       width: 14 },
    { header: 'Producto',         value: r => r.productName,                            width: 32 },
    { header: 'Cantidad',         value: r => r.quantity,                               width: 10 },
    { header: 'Precio Unitario',  value: r => roundPrice(r.unitPrice),                  width: 16 },
    { header: 'Total',            value: r => roundPrice(r.total),                      width: 16 },
    { header: 'Método de Pago',   value: r => r.paymentMethod,                          width: 18 },
    { header: 'Estado',           value: r => r.status,                                 width: 14 },
    { header: 'Cliente',          value: r => r.client ?? '',                            width: 22 },
  ];

  const summary = [
    { label: 'Reporte',                  value: 'Ventas' },
    { label: 'Período',                  value: rangeLabel },
    { label: 'Moneda',                   value: currencySymbol },
    { label: 'Ventas totales (Pagado)',  value: formatCurrency(roundPrice(kpis.totalSales)) },
    { label: 'Transacciones',            value: String(kpis.transactionCount) },
    { label: 'Ticket promedio',          value: formatCurrency(roundPrice(kpis.averageTicket)) },
    { label: 'Pendiente de cobro',       value: formatCurrency(roundPrice(kpis.pendingAmount)) },
  ];

  exportToExcel(rows, columns, fileName, 'Ventas', { summary });
}

/**
 * PDF export tailored for the Sales report.
 * PDF focuses on a clean data table + KPI summary in text — no chart image
 * (per project decision: html2canvas screenshots look pixelated).
 */
export async function exportSalesReportToPDF(
  rows: ReportSaleRow[],
  kpis: ReportKpis,
  ctx: PdfReportContext,
): Promise<void> {
  await exportToPDF(ctx, {
    title: 'Reporte de Ventas',
    columns: [
      { header: 'Fecha',         dataKey: 'fecha' },
      { header: 'Producto',      dataKey: 'producto' },
      { header: 'Cantidad',      dataKey: 'cantidad' },
      { header: 'Precio Unit.',  dataKey: 'precio' },
      { header: 'Total',         dataKey: 'total' },
      { header: 'Método',        dataKey: 'metodo' },
      { header: 'Estado',        dataKey: 'estado' },
    ],
    rows: rows.map(r => ({
      fecha:    formatDate(r.date),
      producto: r.productName,
      cantidad: r.quantity,
      precio:   formatCurrency(roundPrice(r.unitPrice)),
      total:    formatCurrency(roundPrice(r.total)),
      metodo:   r.paymentMethod,
      estado:   r.status,
    })),
    fileName: `reporte-ventas-${new Date().toISOString().slice(0, 10)}.pdf`,
  });
}
