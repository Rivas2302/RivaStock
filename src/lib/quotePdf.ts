import type { Quote } from '../types';
import { loadPdfRuntime } from './pdfRuntime';

export async function buildQuotePdfBlob(
  quote: Quote,
  businessName: string,
  currencySymbol: string,
  logoUrl?: string,
): Promise<Blob> {
  const { jsPDF, autoTable } = await loadPdfRuntime();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 16;
  let logoData: string | null = null;

  if (logoUrl) {
    try {
      const response = await fetch(logoUrl, { mode: 'cors' });
      if (response.ok) {
        const blob = await response.blob();
        logoData = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      logoData = null;
    }
  }

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 34, 'F');
  if (logoData) {
    try { doc.addImage(logoData, 16, 10, 16, 16); } catch { /* brand text fallback below */ }
  } else {
    doc.setFillColor(52, 211, 153);
    doc.roundedRect(16, 10, 16, 16, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text((businessName.trim().charAt(0) || 'R').toUpperCase(), 21.5, 20.5);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(businessName || 'Mi negocio', 38, 17);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text('PRESUPUESTO ' + quote.number, 38, 24);
  doc.text('Emitido: ' + new Date(quote.createdAt).toLocaleDateString('es-AR'), pageWidth - margin, 16, { align: 'right' });
  doc.text('Válido hasta: ' + new Date(quote.expiresAt).toLocaleDateString('es-AR'), pageWidth - margin, 23, { align: 'right' });

  let y = 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('CLIENTE', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(doc.splitTextToSize(quote.clientName || 'Sin nombre', pageWidth - margin * 2), margin, y + 6);
  if (quote.clientPhone) {
    y += 11;
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(quote.clientPhone, margin, y);
  }
  y += quote.clientPhone ? 13 : 11;

  const rows = quote.items.map(item => [
    item.productName + '\n' + (item.availability === 'immediate'
      ? 'Entrega inmediata'
      : item.availability === 'on_order' ? 'Bajo pedido' : 'Disponibilidad a confirmar')
      + (item.leadTime ? ' · ' + item.leadTime : ''),
    String(item.quantity),
    currencySymbol + ' ' + Math.round(item.unitPrice).toLocaleString('es-AR'),
    currencySymbol + ' ' + Math.round(item.subtotal).toLocaleString('es-AR'),
  ]);
  autoTable(doc, {
    startY: y,
    head: [['Producto y disponibilidad', 'Cant.', 'Precio unitario', 'Subtotal']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3, textColor: [30, 41, 59], lineColor: [226, 232, 240] },
    columnStyles: { 1: { halign: 'center', cellWidth: 17 }, 2: { halign: 'right', cellWidth: 33 }, 3: { halign: 'right', cellWidth: 33 } },
    margin: { left: margin, right: margin },
  });

  const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
  let totalsY = lastY + 10;
  const productSubtotal = quote.items.reduce((sum, item) => sum + item.subtotal, 0);
  const discountAmount = productSubtotal * quote.discount / 100;
  const right = pageWidth - margin;
  const totalLine = (label: string, value: number, color: [number, number, number] = [71, 85, 105]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...color);
    doc.text(label, right - 72, totalsY);
    doc.text(currencySymbol + ' ' + Math.round(value).toLocaleString('es-AR'), right, totalsY, { align: 'right' });
    totalsY += 7;
  };
  totalLine('Subtotal productos', productSubtotal);
  if (discountAmount > 0) totalLine('Descuento (' + quote.discount + '%)', -discountAmount, [5, 150, 105]);
  if (Number(quote.shippingAmount) > 0) totalLine('Envío', Number(quote.shippingAmount));
  doc.setDrawColor(203, 213, 225);
  doc.line(right - 72, totalsY - 2, right, totalsY - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text('TOTAL CON ENVÍO', right - 72, totalsY + 5);
  doc.setTextColor(5, 120, 90);
  doc.text(currencySymbol + ' ' + Math.round(quote.total).toLocaleString('es-AR'), right, totalsY + 5, { align: 'right' });
  totalsY += 15;

  if (quote.notes?.trim()) {
    if (totalsY > 255) { doc.addPage(); totalsY = 22; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('CONDICIONES PARA EL CLIENTE', margin, totalsY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(doc.splitTextToSize(quote.notes, pageWidth - margin * 2), margin, totalsY + 6);
  }

  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('Generado con ' + businessName, margin, doc.internal.pageSize.getHeight() - 7);
    doc.text('Página ' + page + ' de ' + count, pageWidth - margin, doc.internal.pageSize.getHeight() - 7, { align: 'right' });
  }
  return doc.output('blob');
}
