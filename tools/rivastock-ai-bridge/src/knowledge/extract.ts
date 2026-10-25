import mammoth from 'mammoth';
import { HTMLElement, NodeType, parse, type Node } from 'node-html-parser';
import { extractText, getDocumentProxy } from 'unpdf';
import { NonRetryableError } from './errors.ts';
import { normalizeText, removeRepeatedLines } from './normalize.ts';

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
};

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

export async function extractPdf(buffer: Uint8Array): Promise<Extraction> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const normalizedPages = removeRepeatedLines(pages).map((page) => normalizeText(page, { pdf: true }));
  const fullText = normalizeText(normalizedPages.filter(Boolean).join('\n\n'));
  if (fullText.length < 30) {
    throw new NonRetryableError('El PDF no tiene texto seleccionable (posible escaneo). Subí una versión con texto o activá el OCR.');
  }

  const blocks = normalizedPages.flatMap((pageText, pageIndex) =>
    blocksFromText(pageText).map((block) => ({ ...block, page: pageIndex + 1 })));
  return { blocks, fullText, pageCount: totalPages, extracted: true };
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

export async function extractImage(_buffer: Uint8Array, ocrEnabled: boolean): Promise<string | null> {
  if (!ocrEnabled) return null;
  throw new NonRetryableError('El OCR de imágenes no está disponible en esta versión del Bridge.');
}
