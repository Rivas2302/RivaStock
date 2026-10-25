import type { JSONContent } from '@tiptap/core';
import type jsPDF from 'jspdf';
import { CALLOUT_LABELS, type CalloutVariant } from '../../components/knowledge/editor/extensions/calloutLabels';
import { loadPdfRuntime } from '../pdfRuntime';

export interface KnowledgePdfImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface KnowledgePdfOptions {
  doc: JSONContent;
  title: string;
  businessName: string;
  versionNumber: number;
  publishedAt?: string | null;
  updatedAt?: string | null;
  loadImage(assetPath: string): Promise<KnowledgePdfImage | null>;
}

export interface KnowledgePdf {
  blob: Blob;
  fileName: string;
}

export interface PdfTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
}

export interface PdfLayoutLine {
  segments: PdfTextRun[];
}

export type PdfTextMeasure = (text: string, style: Omit<PdfTextRun, 'text'>) => number;

const PAGE_MARGIN = 18;
const BODY_SIZE = 10.5;
const BODY_LINE = BODY_SIZE * 0.3528 * 1.45;
const BRAND: [number, number, number] = [54, 95, 173];
const INK: [number, number, number] = [38, 48, 60];
const MUTED: [number, number, number] = [100, 116, 139];

function sameStyle(left: PdfTextRun, right: PdfTextRun): boolean {
  return Boolean(left.bold) === Boolean(right.bold)
    && Boolean(left.italic) === Boolean(right.italic)
    && Boolean(left.code) === Boolean(right.code)
    && left.href === right.href;
}

function pushSegment(line: PdfLayoutLine, run: PdfTextRun): void {
  if (!run.text) return;
  const previous = line.segments.at(-1);
  if (previous && sameStyle(previous, run)) previous.text += run.text;
  else line.segments.push({ ...run });
}

/** Wraps inline runs by words while retaining each segment's marks and link target. */
export function layoutRuns(runs: PdfTextRun[], maxWidth: number, measure: PdfTextMeasure): PdfLayoutLine[] {
  const lines: PdfLayoutLine[] = [{ segments: [] }];
  let lineWidth = 0;
  let pendingSpaces: PdfTextRun[] = [];
  const currentLine = () => lines[lines.length - 1];
  const nextLine = () => {
    lines.push({ segments: [] });
    lineWidth = 0;
  };
  const segmentWidth = (run: PdfTextRun) => measure(run.text, {
    bold: run.bold,
    italic: run.italic,
    code: run.code,
    href: run.href,
  });
  const addWord = (run: PdfTextRun) => {
    const spaceWidth = pendingSpaces.reduce((sum, space) => sum + segmentWidth(space), 0);
    const wordWidth = segmentWidth(run);
    if (lineWidth > 0 && lineWidth + spaceWidth + wordWidth > maxWidth) nextLine();
    if (lineWidth > 0) {
      for (const space of pendingSpaces) {
        pushSegment(currentLine(), space);
        lineWidth += segmentWidth(space);
      }
    }
    pendingSpaces = [];

    if (wordWidth <= maxWidth || lineWidth === 0 && wordWidth <= maxWidth) {
      pushSegment(currentLine(), run);
      lineWidth += wordWidth;
      return;
    }

    for (const character of Array.from(run.text)) {
      const characterRun = { ...run, text: character };
      const characterWidth = segmentWidth(characterRun);
      if (lineWidth > 0 && lineWidth + characterWidth > maxWidth) nextLine();
      pushSegment(currentLine(), characterRun);
      lineWidth += characterWidth;
    }
  };

  for (const run of runs) {
    const tokens = run.text.replace(/\r\n?/g, '\n').split(/(\n|[^\S\n]+|[^\s]+)/u).filter(Boolean);
    for (const token of tokens) {
      if (token === '\n') {
        pendingSpaces = [];
        nextLine();
      } else if (/^[^\S\n]+$/u.test(token)) {
        if (currentLine().segments.length) pendingSpaces.push({ ...run, text: token });
      } else {
        addWord({ ...run, text: token });
      }
    }
  }

  while (lines.length > 1 && lines.at(-1)?.segments.length === 0) lines.pop();
  return lines;
}

function fontFor(run: PdfTextRun): { family: 'helvetica' | 'courier'; style: 'normal' | 'bold' | 'italic' | 'bolditalic' } {
  if (run.code) return { family: 'courier', style: 'normal' };
  if (run.bold && run.italic) return { family: 'helvetica', style: 'bolditalic' };
  if (run.bold) return { family: 'helvetica', style: 'bold' };
  if (run.italic) return { family: 'helvetica', style: 'italic' };
  return { family: 'helvetica', style: 'normal' };
}

function markMeasure(doc: jsPDF, fontSize: number): PdfTextMeasure {
  return (text, style) => {
    const font = fontFor({ text, ...style });
    doc.setFont(font.family, font.style);
    doc.setFontSize(fontSize);
    return doc.getTextWidth(text);
  };
}

function plainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(plainText).join(node.type === 'paragraph' || node.type === 'heading' ? '' : '\n');
}

function inlineRuns(node: JSONContent): PdfTextRun[] {
  if (node.type === 'text') {
    const marks = node.marks ?? [];
    const link = marks.find((mark) => mark.type === 'link')?.attrs?.href;
    const href = typeof link === 'string' && /^https?:\/\//i.test(link) ? link : undefined;
    return [{
      text: node.text ?? '',
      bold: marks.some((mark) => mark.type === 'bold'),
      italic: marks.some((mark) => mark.type === 'italic'),
      code: marks.some((mark) => mark.type === 'code'),
      href,
    }];
  }
  if (node.type === 'hardBreak') return [{ text: '\n' }];
  if (node.type === 'image') return [{ text: `[Imagen: ${String(node.attrs?.alt ?? '')}]`, italic: true }];
  return (node.content ?? []).flatMap(inlineRuns);
}

function blockRuns(node: JSONContent): PdfTextRun[] {
  const children = node.content ?? [];
  return children.flatMap((child, index) => [
    ...(index > 0 ? [{ text: '\n' }] : []),
    ...(child.type === 'paragraph' || child.type === 'heading' ? inlineRuns(child) : blockRuns(child)),
  ]);
}

function dateLabel(value?: string | null): string {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function slugTitle(title: string): string {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'documento';
}

export async function createKnowledgePdf({
  doc: content,
  title,
  businessName,
  versionNumber,
  publishedAt,
  updatedAt,
  loadImage,
}: KnowledgePdfOptions): Promise<KnowledgePdf> {
  const { jsPDF, autoTable } = await loadPdfRuntime();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const safeTitle = title.trim() || 'Documento';
  const safeBusinessName = businessName.trim() || 'Mi Negocio';
  const versionLabel = `v${Math.max(1, versionNumber)}`;
  const marginTop = 48;
  const footerLineY = pageHeight - 16;
  const bottomY = footerLineY - 5;
  let cursorY = marginTop;

  const drawPageHeader = (pageNumber: number) => {
    if (pageNumber === 1) {
      pdf.setFillColor(...BRAND);
      pdf.rect(0, 0, pageWidth, 39, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.setTextColor(255, 255, 255);
      const titleLines = pdf.splitTextToSize(safeTitle, contentWidth) as string[];
      pdf.text(titleLines.slice(0, 2), PAGE_MARGIN, 17);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9.5);
      pdf.setTextColor(235, 241, 252);
      pdf.text(safeBusinessName, PAGE_MARGIN, 32);
      pdf.text(`Versión ${Math.max(1, versionNumber)} · ${dateLabel(publishedAt ?? updatedAt)}`, pageWidth - PAGE_MARGIN, 32, { align: 'right' });
      return;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(...BRAND);
    pdf.text(safeTitle, PAGE_MARGIN, 11);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...MUTED);
    pdf.text(`${safeBusinessName} · ${versionLabel}`, pageWidth - PAGE_MARGIN, 11, { align: 'right' });
    pdf.setDrawColor(220, 226, 235);
    pdf.line(PAGE_MARGIN, 14, pageWidth - PAGE_MARGIN, 14);
  };

  const drawFooter = (pageNumber: number, totalPages: number) => {
    pdf.setDrawColor(220, 226, 235);
    pdf.line(PAGE_MARGIN, footerLineY, pageWidth - PAGE_MARGIN, footerLineY);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...MUTED);
    pdf.text(`${safeTitle} · ${versionLabel}`, PAGE_MARGIN, pageHeight - 9);
    pdf.text(`Página ${pageNumber} de ${totalPages}`, pageWidth - PAGE_MARGIN, pageHeight - 9, { align: 'right' });
  };

  const addPage = () => {
    pdf.addPage();
    drawPageHeader(pdf.getNumberOfPages());
    cursorY = 22;
  };

  const ensureSpace = (height: number) => {
    if (cursorY + height > bottomY) addPage();
  };

  const drawLine = (line: PdfLayoutLine, x: number, y: number, fontSize: number, defaultColor: [number, number, number] = INK) => {
    let cursorX = x;
    for (const segment of line.segments) {
      const font = fontFor(segment);
      pdf.setFont(font.family, font.style);
      pdf.setFontSize(fontSize);
      pdf.setTextColor(...(segment.href ? BRAND : defaultColor));
      pdf.text(segment.text, cursorX, y);
      const width = pdf.getTextWidth(segment.text);
      if (segment.href) {
        pdf.setDrawColor(...BRAND);
        pdf.setLineWidth(0.15);
        pdf.line(cursorX, y + 0.6, cursorX + width, y + 0.6);
        pdf.link(cursorX, y - fontSize * 0.28, width, BODY_LINE, { url: segment.href });
      }
      cursorX += width;
    }
  };

  const drawRichLines = (runs: PdfTextRun[], x: number, width: number, fontSize = BODY_SIZE, lineHeight = BODY_LINE, after = 0) => {
    const lines = layoutRuns(runs, width, markMeasure(pdf, fontSize));
    for (const line of lines) {
      ensureSpace(lineHeight);
      drawLine(line, x, cursorY + lineHeight * 0.78, fontSize);
      cursorY += lineHeight;
    }
    if (lines.length) cursorY += after;
  };

  const drawDecoratedLines = (
    lines: PdfLayoutLine[],
    x: number,
    width: number,
    options: { fill: [number, number, number]; bar: [number, number, number]; fontSize?: number; lineHeight?: number; leftPad?: number },
  ) => {
    const fontSize = options.fontSize ?? BODY_SIZE;
    const lineHeight = options.lineHeight ?? BODY_LINE;
    const leftPad = options.leftPad ?? 6;
    let index = 0;
    while (index < lines.length) {
      if (cursorY + lineHeight + 5 > bottomY) addPage();
      const maxLines = Math.max(1, Math.floor((bottomY - cursorY - 5) / lineHeight));
      const pageLines = lines.slice(index, index + maxLines);
      const blockHeight = pageLines.length * lineHeight + 5;
      pdf.setFillColor(...options.fill);
      pdf.roundedRect(x, cursorY, width, blockHeight, 1.5, 1.5, 'F');
      pdf.setFillColor(...options.bar);
      pdf.roundedRect(x, cursorY, 1.5, blockHeight, 0.7, 0.7, 'F');
      pageLines.forEach((line, lineIndex) => drawLine(line, x + leftPad, cursorY + 3 + lineIndex * lineHeight + lineHeight * 0.78, fontSize));
      cursorY += blockHeight + 3;
      index += pageLines.length;
      if (index < lines.length) addPage();
    }
  };

  const drawBlock = async (node: JSONContent, x = PAGE_MARGIN, width = contentWidth): Promise<void> => {
    switch (node.type) {
      case 'paragraph':
        drawRichLines(inlineRuns(node), x, width, BODY_SIZE, BODY_LINE, BODY_LINE * 0.38);
        return;
      case 'heading': {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1));
        const size = level === 1 ? 18 : level === 2 ? 14 : 12;
        const height = size * 0.3528 * 1.35;
        ensureSpace(height + BODY_LINE * 2);
        const lines = layoutRuns(inlineRuns(node), width, markMeasure(pdf, size));
        for (const line of lines) {
          ensureSpace(height);
          pdf.setTextColor(...BRAND);
          drawLine(line, x, cursorY + height * 0.78, size, BRAND);
          cursorY += height;
        }
        cursorY += BODY_LINE * 0.4;
        return;
      }
      case 'bulletList':
      case 'orderedList': {
        const ordered = node.type === 'orderedList';
        const start = Number.isInteger(node.attrs?.start) ? Number(node.attrs?.start) : 1;
        const items = node.content ?? [];
        for (const [index, item] of items.entries()) {
          const itemX = x;
          const markerX = itemX;
          const itemWidth = width - 6;
          const marker = ordered ? `${start + index}.` : '•';
          const children = item.content ?? [];
          const firstBlock = children.find((child) => child.type !== 'bulletList' && child.type !== 'orderedList');
          const firstBlockHeight = firstBlock?.type === 'heading'
            ? (Number(firstBlock.attrs?.level) === 1 ? 18 : Number(firstBlock.attrs?.level) === 2 ? 14 : 12) * 0.3528 * 1.35 + BODY_LINE * 2
            : BODY_LINE * 2;
          ensureSpace(firstBlockHeight);
          if (firstBlock) {
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(BODY_SIZE);
            pdf.setTextColor(...INK);
            pdf.text(marker, markerX, cursorY + BODY_LINE * 0.78);
          }
          let markerUsed = false;
          for (const child of children) {
            if (child === firstBlock && !markerUsed) {
              if (child.type === 'paragraph') drawRichLines(inlineRuns(child), itemX + 6, itemWidth, BODY_SIZE, BODY_LINE, BODY_LINE * 0.15);
              else await drawBlock(child, itemX + 6, itemWidth);
              markerUsed = true;
            } else {
              await drawBlock(child, itemX + 6, itemWidth);
            }
          }
          if (!firstBlock) cursorY += BODY_LINE;
        }
        cursorY += BODY_LINE * 0.25;
        return;
      }
      case 'table': {
        const rows = (node.content ?? []).map((row) => (row.content ?? []).map(plainText));
        if (!rows.length) return;
        ensureSpace(BODY_LINE * 2);
        autoTable(pdf, {
          startY: cursorY,
          margin: { top: 22, bottom: 20, left: PAGE_MARGIN, right: PAGE_MARGIN },
          head: [rows[0]],
          body: rows.slice(1),
          styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, textColor: INK, lineColor: [220, 226, 235], lineWidth: 0.15, overflow: 'linebreak', valign: 'middle' },
          headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [245, 248, 252] },
          didDrawPage: (data) => { if (data.pageNumber > 1) drawPageHeader(data.pageNumber); },
        });
        cursorY = ((pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY) + BODY_LINE * 0.6;
        return;
      }
      case 'callout': {
        const requestedVariant = String(node.attrs?.variant ?? 'info');
        const variant: CalloutVariant = Object.hasOwn(CALLOUT_LABELS, requestedVariant) ? requestedVariant as CalloutVariant : 'info';
        const label = CALLOUT_LABELS[variant];
        const runs: PdfTextRun[] = [{ text: `${label}: `, bold: true }, ...blockRuns(node)];
        const lines = layoutRuns(runs, width - 12, markMeasure(pdf, BODY_SIZE));
        const colors: Record<CalloutVariant, { fill: [number, number, number]; bar: [number, number, number] }> = {
          warning: { fill: [255, 247, 220], bar: [217, 119, 6] },
          tip: { fill: [230, 246, 235], bar: [22, 130, 75] },
          info: { fill: [232, 241, 255], bar: BRAND },
          danger: { fill: [255, 235, 235], bar: [185, 28, 28] },
        };
        drawDecoratedLines(lines, x, width, { ...colors[variant], leftPad: 6 });
        return;
      }
      case 'blockquote': {
        const lines = layoutRuns(blockRuns(node), width - 8, markMeasure(pdf, BODY_SIZE));
        drawDecoratedLines(lines, x, width, { fill: [248, 249, 251], bar: [148, 163, 184], leftPad: 6 });
        return;
      }
      case 'codeBlock': {
        const source = (node.content ?? []).map((child) => child.text ?? '').join('');
        const lines = layoutRuns([{ text: source, code: true }], width - 8, markMeasure(pdf, 9));
        let index = 0;
        const lineHeight = 9 * 0.3528 * 1.35;
        while (index < lines.length) {
          if (cursorY + lineHeight + 4 > bottomY) addPage();
          const available = Math.max(1, Math.floor((bottomY - cursorY - 4) / lineHeight));
          const chunk = lines.slice(index, index + available);
          pdf.setFillColor(245, 246, 248);
          pdf.roundedRect(x, cursorY, width, chunk.length * lineHeight + 4, 1.2, 1.2, 'F');
          chunk.forEach((line, lineIndex) => drawLine(line, x + 4, cursorY + 2 + lineIndex * lineHeight + lineHeight * 0.78, 9));
          cursorY += chunk.length * lineHeight + 7;
          index += chunk.length;
          if (index < lines.length) addPage();
        }
        return;
      }
      case 'image': {
        const assetPath = typeof node.attrs?.assetPath === 'string' ? node.attrs.assetPath : '';
        const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
        const image = assetPath ? await loadImage(assetPath).catch(() => null) : null;
        if (!image || image.width <= 0 || image.height <= 0) {
          const placeholderHeight = 24;
          ensureSpace(placeholderHeight + 5);
          pdf.setDrawColor(190, 198, 209);
          pdf.setFillColor(248, 249, 251);
          pdf.roundedRect(x + width * 0.12, cursorY, width * 0.76, placeholderHeight, 1.5, 1.5, 'FD');
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(9);
          pdf.setTextColor(...MUTED);
          pdf.text('Imagen no disponible', pageWidth / 2, cursorY + 13, { align: 'center' });
          cursorY += placeholderHeight + 4;
        } else {
          let imageWidth = Math.min(width, 110 * image.width / image.height);
          let imageHeight = image.height / image.width * imageWidth;
          if (imageHeight > 110) {
            imageHeight = 110;
            imageWidth = image.width / image.height * imageHeight;
          }
          const captionHeight = alt ? 7 : 0;
          ensureSpace(imageHeight + captionHeight + 5);
          pdf.addImage(image.dataUrl, 'JPEG', x + (width - imageWidth) / 2, cursorY, imageWidth, imageHeight, undefined, 'FAST');
          cursorY += imageHeight;
          if (alt) {
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(8.5);
            pdf.setTextColor(...MUTED);
            const caption = pdf.splitTextToSize(alt, width) as string[];
            pdf.text(caption, pageWidth / 2, cursorY + 4, { align: 'center' });
            cursorY += caption.length * 4 + 2;
          }
          cursorY += 3;
        }
        return;
      }
      case 'horizontalRule':
        ensureSpace(7);
        pdf.setDrawColor(203, 213, 225);
        pdf.line(x, cursorY + 2, x + width, cursorY + 2);
        cursorY += 7;
        return;
      case 'doc':
        for (let index = 0; index < (node.content ?? []).length; index += 1) {
          const child = node.content?.[index];
          if (!child) continue;
          if (child.type === 'heading') {
            const next = node.content?.[index + 1];
            const nextRuns = next ? inlineRuns(next.type === 'paragraph' ? next : next) : [];
            const nextLines = nextRuns.length ? layoutRuns(nextRuns, width, markMeasure(pdf, BODY_SIZE)).length : 2;
            const nextHeight = Math.max(2, nextLines) * BODY_LINE;
            const headingSize = child.attrs?.level === 1 ? 18 : child.attrs?.level === 2 ? 14 : 12;
            ensureSpace(headingSize * 0.3528 * 1.35 + nextHeight);
          }
          await drawBlock(child, x, width);
        }
        return;
      default:
        if (node.text) drawRichLines([{ text: node.text }], x, width);
        else for (const child of node.content ?? []) await drawBlock(child, x, width);
    }
  };

  drawPageHeader(1);
  await drawBlock(content);
  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    pdf.setPage(page);
    drawFooter(page, totalPages);
  }

  return {
    blob: pdf.output('blob') as Blob,
    fileName: `${slugTitle(safeTitle)}-${versionLabel}.pdf`,
  };
}
