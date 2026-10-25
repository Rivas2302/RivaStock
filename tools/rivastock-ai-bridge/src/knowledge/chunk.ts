import { createHash } from 'node:crypto';
import { NonRetryableError } from './errors.ts';
import type { SourceBlock } from './extract.ts';

export const CHUNK_TARGET = 1000;
export const CHUNK_MAX = 1400;
export const CHUNK_OVERLAP = 180;
export const MAX_CHUNKS = 2000;

export interface ChunkDraft {
  chunkIndex: number;
  content: string;
  sectionPath: string;
  pageFrom: number | null;
  pageTo: number | null;
  tokenEstimate: number;
  embeddingInput: string;
  contentHash: string;
}

interface Piece {
  text: string;
  page: number | null;
}

export function splitLongText(text: string, max = CHUNK_MAX): string[] {
  if (!Number.isInteger(max) || max < 1) throw new RangeError('El tamaño máximo debe ser un entero positivo.');
  if (text.length <= max) return [text];

  const sentences = text.split(/(?<=[.!?…:;])\s+/u);
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current) {
        out.push(current);
        current = '';
      }
      for (let index = 0; index < sentence.length; index += max) out.push(sentence.slice(index, index + max).trim());
      continue;
    }
    if ((current ? current.length + 1 : 0) + sentence.length > max) {
      out.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) out.push(current);
  return out.filter(Boolean);
}

function overlapTail(pieces: Piece[]): Piece[] {
  const last = pieces.at(-1);
  if (!last) return [];
  if (last.text.length <= CHUNK_OVERLAP) return [last];
  const tail = last.text.slice(-CHUNK_OVERLAP);
  const firstSpace = tail.indexOf(' ');
  return [{ text: firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail, page: last.page }];
}

export function chunkBlocks(title: string, blocks: SourceBlock[], passagePrefix = 'passage: '): ChunkDraft[] {
  const sections: Array<{ path: string[]; pieces: Piece[] }> = [];
  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;
    const last = sections.at(-1);
    const pieces = splitLongText(text, CHUNK_MAX - CHUNK_OVERLAP - 4)
      .map((part) => ({ text: part, page: block.page }));
    if (last && last.path.join('\u0000') === block.headingPath.join('\u0000')) last.pieces.push(...pieces);
    else sections.push({ path: [...block.headingPath], pieces });
  }

  const drafts: Array<{ path: string[]; pieces: Piece[] }> = [];
  for (const section of sections) {
    let buffer: Piece[] = [];
    let length = 0;
    let fresh = 0;
    const flush = () => {
      if (fresh === 0) return;
      drafts.push({ path: section.path, pieces: buffer });
      buffer = overlapTail(buffer);
      length = buffer.reduce((sum, piece) => sum + piece.text.length + 2, 0);
      fresh = 0;
    };

    for (const piece of section.pieces) {
      if (fresh > 0 && length + piece.text.length + 2 > CHUNK_MAX) flush();
      if (length + piece.text.length + 2 > CHUNK_MAX) {
        buffer = [];
        length = 0;
      }
      buffer.push(piece);
      length += piece.text.length + 2;
      fresh += 1;
      if (length >= CHUNK_TARGET) flush();
    }
    flush();
  }

  if (drafts.length > MAX_CHUNKS) {
    throw new NonRetryableError(`El documento genera más de ${MAX_CHUNKS} fragmentos. Dividilo en documentos más chicos.`);
  }

  return drafts.map((draft, index) => {
    const content = draft.pieces.map((piece) => piece.text).join('\n\n').slice(0, CHUNK_MAX);
    const pages = draft.pieces.map((piece) => piece.page).filter((page): page is number => typeof page === 'number');
    const sectionPath = draft.path.join(' > ').slice(0, 300);
    const embeddingInput = `${passagePrefix}${title}${sectionPath ? ` — ${sectionPath}` : ''}\n${content}`;
    return {
      chunkIndex: index,
      content,
      sectionPath,
      pageFrom: pages.length ? Math.min(...pages) : null,
      pageTo: pages.length ? Math.max(...pages) : null,
      tokenEstimate: Math.ceil(content.length / 4),
      embeddingInput,
      contentHash: createHash('sha256').update(embeddingInput).digest('hex'),
    };
  });
}
