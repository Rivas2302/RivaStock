import type { JSONContent } from '@tiptap/core';
import { toMarkdown } from './editorContent';

export interface KnowledgeImageMapEntry {
  assetPath: string | null;
  alt: string;
}

export type KnowledgeImageMap = Record<string, KnowledgeImageMapEntry>;
type OrganizeCalloutVariant = 'warning' | 'tip' | 'info' | 'danger';

export type OrganizeBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'steps'; items: Array<{ text: string; image_ids: string[] }> }
  | { type: 'bullets'; items: string[] }
  | { type: 'callout'; variant: OrganizeCalloutVariant; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'image'; image_id: string; caption: string };

export interface OrganizeProposal {
  title: string;
  summary: string;
  blocks: OrganizeBlock[];
  image_descriptions?: Record<string, string>;
  missing_information: string[];
}

export interface OrganizeDraftNotes {
  notes: string;
  imageMap: KnowledgeImageMap;
}

const IMAGE_ID_PATTERN = /^IMG\d{1,3}$/;
const CALLOUT_VARIANTS = new Set(['warning', 'tip', 'info', 'danger']);
const MAX_PROPOSAL_LENGTH = 20_000;

export function buildNotesFromDraft(doc: JSONContent): OrganizeDraftNotes {
  const imageMap: KnowledgeImageMap = {};
  let imageNumber = 0;
  const withMarkers = replaceImages(doc, (node) => {
    imageNumber += 1;
    const imageId = `IMG${imageNumber}`;
    const assetPath = typeof node.attrs?.assetPath === 'string' ? node.attrs.assetPath : null;
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
    imageMap[imageId] = { assetPath, alt };
    return { type: 'text', text: `RIVASTOCKIMAGE${imageNumber}END` };
  });
  const notes = toMarkdown(withMarkers).replace(/RIVASTOCKIMAGE(\d{1,3})END/g, (_marker, number: string) => `[[IMG${number}]]`);
  return { notes, imageMap };
}

export function validateProposal(value: unknown): OrganizeProposal {
  if (!isRecord(value)) return invalidProposal();
  const title = boundedString(value.title, 1, 160);
  const summary = boundedString(value.summary, 0, 600);
  const imageDescriptions = validateImageDescriptions(value.image_descriptions);
  if (!Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > 300
    || !Array.isArray(value.missing_information) || value.missing_information.length > 30) return invalidProposal();
  const proposal: OrganizeProposal = {
    title,
    summary,
    blocks: value.blocks.map(validateBlock),
    ...(imageDescriptions ? { image_descriptions: imageDescriptions } : {}),
    missing_information: value.missing_information.map((item) => boundedString(item, 1, 1000)),
  };
  if (JSON.stringify(proposal).length > MAX_PROPOSAL_LENGTH) return invalidProposal();
  return proposal;
}

export function proposalToTiptap(proposal: OrganizeProposal, imageMap: KnowledgeImageMap): { doc: JSONContent; warnings: string[] } {
  const warnings: string[] = [];
  const usedImages = new Set<string>();
  const blocks: JSONContent[] = [
    { type: 'heading', attrs: { level: 1 }, content: inlineText(proposal.title) },
  ];
  if (proposal.summary.trim()) blocks.push({ type: 'paragraph', content: inlineText(proposal.summary) });

  const imageNode = (imageId: string, caption = ''): JSONContent | null => {
    const image = imageMap[imageId];
    if (!image) {
      warnings.push(`Se omitió ${imageId}: la propuesta hizo referencia a una imagen desconocida.`);
      return null;
    }
    usedImages.add(imageId);
    const imageDescription = proposal.image_descriptions?.[imageId];
    const alt = imageDescription !== undefined ? imageDescription : (caption || image.alt || '');
    if (!image.assetPath) {
      warnings.push(`Se conservó el texto alternativo de ${imageId}, pero no se encontró su archivo.`);
      return { type: 'paragraph', content: inlineText(alt || `[Imagen ${imageId}]`) };
    }
    return { type: 'image', attrs: { assetPath: image.assetPath, alt, src: null } };
  };

  for (const block of proposal.blocks) {
    if (block.type === 'heading') {
      if (isMissingInformationHeading(block.text)) continue;
      blocks.push({ type: 'heading', attrs: { level: block.level }, content: inlineText(block.text) });
    } else if (block.type === 'paragraph') {
      blocks.push({ type: 'paragraph', content: inlineText(block.text) });
    } else if (block.type === 'steps') {
      blocks.push({
        type: 'orderedList',
        content: block.items.map((item) => ({
          type: 'listItem',
          content: [
            { type: 'paragraph', content: inlineText(item.text) },
            ...item.image_ids.map((imageId) => imageNode(imageId)).filter((node): node is JSONContent => node !== null),
          ],
        })),
      });
    } else if (block.type === 'bullets') {
      blocks.push({ type: 'bulletList', content: block.items.map((item) => ({ type: 'listItem', content: [{ type: 'paragraph', content: inlineText(item) }] })) });
    } else if (block.type === 'callout') {
      blocks.push({ type: 'callout', attrs: { variant: block.variant }, content: [{ type: 'paragraph', content: inlineText(block.text) }] });
    } else if (block.type === 'table') {
      const rows = [block.header, ...block.rows];
      blocks.push({
        type: 'table',
        content: rows.map((row, rowIndex) => ({
          type: 'tableRow',
          content: row.map((cell) => ({
            type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
            content: [{ type: 'paragraph', content: inlineText(cell) }],
          })),
        })),
      });
    } else if (block.type === 'image') {
      const image = imageNode(block.image_id, block.caption);
      if (image) blocks.push(image);
    }
  }

  const unusedImages = Object.keys(imageMap).filter((imageId) => !usedImages.has(imageId));
  if (unusedImages.length) {
    blocks.push({ type: 'heading', attrs: { level: 2 }, content: inlineText('Imágenes sin ubicar') });
    for (const imageId of unusedImages) {
      const image = imageNode(imageId);
      if (image) blocks.push(image);
    }
  }
  if (proposal.missing_information.length > 0) {
    blocks.push({ type: 'heading', attrs: { level: 2 }, content: inlineText('Información faltante') });
    blocks.push({
      type: 'bulletList',
      content: proposal.missing_information.map((item) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: inlineText(item) }],
      })),
    });
  }
  return { doc: { type: 'doc', content: blocks }, warnings };
}

function isMissingInformationHeading(value: string): boolean {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'informacion faltante';
}

function validateBlock(value: unknown): OrganizeBlock {
  if (!isRecord(value) || typeof value.type !== 'string') return invalidProposal();
  switch (value.type) {
    case 'heading':
      if (!Number.isInteger(value.level) || Number(value.level) < 1 || Number(value.level) > 3) return invalidProposal();
      return { type: 'heading', level: Number(value.level) as 1 | 2 | 3, text: boundedString(value.text, 1, 4000) };
    case 'paragraph':
      return { type: 'paragraph', text: boundedString(value.text, 0, 4000) };
    case 'steps':
      if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 100) return invalidProposal();
      return { type: 'steps', items: value.items.map((item) => {
        if (!isRecord(item) || !Array.isArray(item.image_ids) || item.image_ids.length > 20) return invalidProposal();
        return { text: boundedString(item.text, 1, 4000), image_ids: item.image_ids.map(validateImageId) };
      }) };
    case 'bullets':
      if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 100) return invalidProposal();
      return { type: 'bullets', items: value.items.map((item) => boundedString(item, 1, 4000)) };
    case 'callout':
      if (typeof value.variant !== 'string' || !CALLOUT_VARIANTS.has(value.variant)) return invalidProposal();
      return { type: 'callout', variant: value.variant as OrganizeCalloutVariant, text: boundedString(value.text, 1, 4000) };
    case 'table': {
      const headerValue = value.header;
      const rowsValue = value.rows;
      if (!Array.isArray(headerValue) || headerValue.length < 1 || headerValue.length > 10
        || !Array.isArray(rowsValue) || rowsValue.length > 100) return invalidProposal();
      const header = headerValue.map((cell) => boundedString(cell, 0, 1000));
      return {
        type: 'table',
        header,
        rows: rowsValue.map((row) => {
          if (!Array.isArray(row) || row.length !== header.length) return invalidProposal();
          return row.map((cell) => boundedString(cell, 0, 1000));
        }),
      };
    }
    case 'image':
      return { type: 'image', image_id: validateImageId(value.image_id), caption: boundedString(value.caption, 0, 4000) };
    default:
      return invalidProposal();
  }
}

function validateImageId(value: unknown): string {
  if (typeof value !== 'string' || !IMAGE_ID_PATTERN.test(value)) return invalidProposal();
  return value;
}

function validateImageDescriptions(value: unknown): Record<string, string> | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return invalidProposal();
  const entries = Object.entries(value);
  if (entries.length > 12) return invalidProposal();
  const descriptions: Record<string, string> = {};
  for (const [id, description] of entries) {
    if (!IMAGE_ID_PATTERN.test(id)) return invalidProposal();
    descriptions[id] = boundedString(description, 0, 300);
  }
  return descriptions;
}

function boundedString(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum) return invalidProposal();
  return value;
}

function replaceImages(node: JSONContent, replace: (node: JSONContent) => JSONContent): JSONContent {
  if (node.type === 'image') return replace(node);
  return node.content
    ? { ...node, content: node.content.map((child) => replaceImages(child, replace)) }
    : { ...node };
}

function inlineText(text: string): JSONContent[] {
  const segments: Array<{ text: string; bold: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const opening = text.indexOf('**', cursor);
    if (opening < 0) {
      segments.push({ text: text.slice(cursor), bold: false });
      break;
    }
    if (opening > cursor) segments.push({ text: text.slice(cursor, opening), bold: false });
    const closing = text.indexOf('**', opening + 2);
    if (closing < 0) {
      segments.push({ text: text.slice(opening), bold: false });
      break;
    }
    const boldText = text.slice(opening + 2, closing);
    if (boldText) segments.push({ text: boldText, bold: true });
    cursor = closing + 2;
  }

  const content: JSONContent[] = [];
  for (const segment of segments) {
    const lines = segment.text.split('\n');
    lines.forEach((line, index) => {
      if (line) content.push({ type: 'text', text: line, ...(segment.bold ? { marks: [{ type: 'bold' }] } : {}) });
      if (index < lines.length - 1) content.push({ type: 'hardBreak' });
    });
  }
  return content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidProposal(): never {
  throw new Error('La IA devolvió una propuesta inválida. Probá de nuevo o con otro modelo.');
}
