import mammoth from 'mammoth';
import { HTMLElement, NodeType, parse, type Node } from 'node-html-parser';
import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';
import { NonRetryableError } from './errors.ts';
import { normalizeText, removeRepeatedLines } from './normalize.ts';
import { createLocalOcrWorker, defaultModelsDirectory, type OcrWorkerFactory } from './ocr.ts';

const MAX_OCR_PDF_PAGES = 30;
const MIN_OCR_TEXT_LENGTH = 10;
const PDF_OCR_SCALE = 2;
const PDF_MAX_IMAGE_PIXELS = 16_777_216;

export type SourceBlock = {
  text: string;
  headingPath: string[];
  page: number | null;
};

export type Extraction = {
  blocks: SourceBlock[];
  fullText: string;
  pageCount: number | null;
  extracted: boolean;
  ocr?: { pages: number; totalPages: number; partial: boolean };
};

export interface OcrOptions {
  modelsDirectory?: string;
  log?: (message: string) => void;
  createWorker?: OcrWorkerFactory;
  renderPdfPage?: (pdf: Awaited<ReturnType<typeof getDocumentProxy>>, pageNumber: number) => Promise<Uint8Array>;
}

function blocksFromText(text: string, headingPath: string[] = [], page: number | null = null): SourceBlock[] {
  return text.split(/\n{2,}/)
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .map((part) => ({ text: part, headingPath: [...headingPath], page }));
}

function fullTextFromBlocks(blocks: SourceBlock[]): string {
  return normalizeText(blocks.map((block) => block.text).join('\n\n'));
}

export function extractMarkdown(markdown: string): Extraction {
  const source = normalizeText(markdown);
  const blocks: SourceBlock[] = [];
  let headingPath: string[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    const text = normalizeText(paragraph.join('\n').replace(/!\[([^\]]*)\]\([^)]*\)/g, '[Imagen: $1]'));
    if (text) blocks.push({ text, headingPath: [...headingPath], page: null });
    paragraph = [];
  };

  for (const line of source.split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      headingPath = headingPath.slice(0, level - 1);
      headingPath[level - 1] = normalizeText(heading[2]);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();

  return { blocks, fullText: fullTextFromBlocks(blocks), pageCount: null, extracted: false };
}

export function extractPlain(text: string): Extraction {
  const fullText = normalizeText(text);
  const blocks = blocksFromText(fullText);
  return { blocks, fullText, pageCount: null, extracted: false };
}

export async function extractPdf(buffer: Uint8Array, ocrOptions: OcrOptions & { ocrEnabled?: boolean } = {}): Promise<Extraction> {
  const bytes = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(bytes, { maxImageSize: PDF_MAX_IMAGE_PIXELS });
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const normalizedPages = removeRepeatedLines(pages).map((page) => normalizeText(page, { pdf: true }));
    const fullText = normalizeText(normalizedPages.filter(Boolean).join('\n\n'));
    if (fullText.length >= 30) {
      const blocks = normalizedPages.flatMap((pageText, pageIndex) =>
        blocksFromText(pageText).map((block) => ({ ...block, page: pageIndex + 1 })));
      return { blocks, fullText, pageCount: totalPages, extracted: true };
    }
    if (!ocrOptions.ocrEnabled) throw new NonRetryableError('El PDF no tiene texto reconocible.');

    const createWorker = ocrOptions.createWorker ?? createLocalOcrWorker;
    const log = ocrOptions.log ?? (() => undefined);
    const worker = await createWorker(ocrOptions.modelsDirectory ?? defaultModelsDirectory(), log);
    try {
      const renderPage = ocrOptions.renderPdfPage ?? (async (document, pageNumber) => {
        const image = await renderPageAsImage(document, pageNumber, {
          canvasImport: () => import('@napi-rs/canvas'),
          scale: PDF_OCR_SCALE,
        });
        return new Uint8Array(image);
      });
      const pagesToOcr = Math.min(totalPages, MAX_OCR_PDF_PAGES);
      const ocrPages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pagesToOcr; pageNumber += 1) {
        const image = await renderPage(pdf, pageNumber);
        const recognized = normalizeText(await worker.recognize(image), { pdf: true });
        ocrPages.push(recognized);
      }
      const ocrFullText = normalizeText(ocrPages.filter(Boolean).join('\n\n'));
      if (usefulCharacterCount(ocrFullText) < MIN_OCR_TEXT_LENGTH) {
        throw new NonRetryableError('El PDF no tiene texto reconocible.');
      }
      const blocks = ocrPages.flatMap((pageText, pageIndex) =>
        blocksFromText(pageText).map((block) => ({ ...block, page: pageIndex + 1 })));
      return {
        blocks,
        fullText: ocrFullText,
        pageCount: totalPages,
        extracted: true,
        ocr: { pages: pagesToOcr, totalPages, partial: totalPages > MAX_OCR_PDF_PAGES },
      };
    } finally {
      await worker.terminate();
    }
  } finally {
    await pdf.cleanup();
  }
}

export async function extractDocx(buffer: Uint8Array): Promise<Extraction> {
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
  const root = parse(html);
  const blocks: SourceBlock[] = [];
  let headingPath: string[] = [];

  const addBlock = (text: string) => {
    const normalized = normalizeText(text);
    if (normalized) blocks.push({ text: normalized, headingPath: [...headingPath], page: null });
  };

  const visit = (node: Node) => {
    if (node.nodeType !== NodeType.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      const level = Number(heading[1]);
      headingPath = headingPath.slice(0, level - 1);
      headingPath[level - 1] = normalizeText(element.text);
      return;
    }
    if (tag === 'p') {
      addBlock(element.text);
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = element.children.filter((child) => child.tagName.toLowerCase() === 'li');
      items.forEach((item, index) => addBlock(`${tag === 'ul' ? '•' : `${index + 1}.`} ${item.text}`));
      return;
    }
    if (tag === 'table') {
      const rows = element.querySelectorAll('tr').map((row) => row.children
        .filter((cell) => ['td', 'th'].includes(cell.tagName.toLowerCase()))
        .map((cell) => normalizeText(cell.text))
        .join(' | '))
        .filter(Boolean);
      addBlock(rows.join('\n'));
      return;
    }
    for (const child of element.childNodes) visit(child);
  };

  for (const child of root.childNodes) visit(child);
  const fullText = fullTextFromBlocks(blocks);
  if (!fullText) throw new NonRetryableError('El documento Word no tiene texto.');
  return { blocks, fullText, pageCount: null, extracted: true };
}

export async function extractImage(buffer: Uint8Array, ocrEnabled: boolean, options: OcrOptions = {}): Promise<string | null> {
  if (!ocrEnabled) return null;
  const createWorker = options.createWorker ?? createLocalOcrWorker;
  const worker = await createWorker(options.modelsDirectory ?? defaultModelsDirectory(), options.log ?? (() => undefined));
  try {
    const text = normalizeText(await worker.recognize(buffer));
    return usefulCharacterCount(text) >= MIN_OCR_TEXT_LENGTH ? text : null;
  } finally {
    await worker.terminate();
  }
}

export function usefulCharacterCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}
