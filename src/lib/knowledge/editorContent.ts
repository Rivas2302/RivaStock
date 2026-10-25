import type { JSONContent } from '@tiptap/core';
import { CALLOUT_LABELS, type CalloutVariant } from '../../components/knowledge/editor/extensions/Callout';
import { sha256Hex } from './hash';

export const EMPTY_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

type JsonObject = Record<string, unknown>;

function children(node: JSONContent): JSONContent[] {
  return node.content ?? [];
}

function stringAttr(node: JSONContent, key: string): string | null {
  const value = node.attrs?.[key];
  return typeof value === 'string' ? value : null;
}

function calloutLabel(node: JSONContent): string {
  const variant = stringAttr(node, 'variant');
  return variant && Object.hasOwn(CALLOUT_LABELS, variant)
    ? CALLOUT_LABELS[variant as CalloutVariant]
    : CALLOUT_LABELS.info;
}

function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneDeep(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneDeep(item)])) as T;
  }
  return value;
}

function visitImages(node: JSONContent, transform: (image: JSONContent) => void): void {
  if (node.type === 'image' && stringAttr(node, 'assetPath')) transform(node);
  node.content?.forEach((child) => visitImages(child, transform));
}

export function collectAssetPaths(doc: JSONContent): string[] {
  const paths = new Set<string>();
  visitImages(doc, (image) => {
    const assetPath = stringAttr(image, 'assetPath');
    if (assetPath) paths.add(assetPath);
  });
  return [...paths];
}

export function stripImageSources(doc: JSONContent): JSONContent {
  const copy = cloneDeep(doc);
  visitImages(copy, (image) => {
    image.attrs = { ...image.attrs, src: null };
  });
  return copy;
}

export function applyImageSources(doc: JSONContent, urlByPath: Record<string, string>): JSONContent {
  const copy = cloneDeep(doc);
  visitImages(copy, (image) => {
    const assetPath = stringAttr(image, 'assetPath');
    if (assetPath) image.attrs = { ...image.attrs, src: urlByPath[assetPath] ?? null };
  });
  return copy;
}

function inlinePlainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'image') return `[Imagen: ${stringAttr(node, 'alt') ?? ''}]`;
  return children(node).map(inlinePlainText).join('');
}

function plainList(node: JSONContent, depth: number): string {
  const ordered = node.type === 'orderedList';
  const start = Number.isInteger(node.attrs?.start) ? Number(node.attrs?.start) : 1;
  return children(node).map((item, index) => {
    const marker = ordered ? `${start + index}.` : '-';
    const indent = '  '.repeat(depth);
    const continuation = '  '.repeat(depth + 1);
    const lines: string[] = [];
    let hasText = false;
    for (const child of children(item)) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        if (!hasText) {
          lines.push(`${indent}${marker}`);
          hasText = true;
        }
        lines.push(plainList(child, depth + 1));
      } else {
        const block = plainTextNode(child);
        if (!block) continue;
        const blockLines = block.split('\n');
        if (!hasText) {
          lines.push(`${indent}${marker} ${blockLines[0]}`);
          lines.push(...blockLines.slice(1).map((line) => `${continuation}${line}`));
          hasText = true;
        } else {
          lines.push(...blockLines.map((line) => `${continuation}${line}`));
        }
      }
    }
    if (!hasText) lines.push(`${indent}${marker}`);
    return lines.join('\n');
  }).join('\n');
}

function plainTable(node: JSONContent): string {
  return children(node).map((row) => children(row).map(inlinePlainText).join(' | ')).join('\n');
}

function plainTextNode(node: JSONContent): string {
  switch (node.type) {
    case 'doc': return children(node).map(plainTextNode).filter(Boolean).join('\n');
    case 'paragraph':
    case 'heading': return inlinePlainText(node);
    case 'bulletList':
    case 'orderedList': return plainList(node, 0);
    case 'table': return plainTable(node);
    case 'image': return `[Imagen: ${stringAttr(node, 'alt') ?? ''}]`;
    case 'callout': return `${calloutLabel(node)}: ${children(node).map(plainTextNode).filter(Boolean).join('\n')}`;
    case 'blockquote': return children(node).map(plainTextNode).filter(Boolean).join('\n');
    case 'codeBlock': return children(node).map((child) => child.text ?? '').join('');
    case 'horizontalRule': return '';
    default: return inlinePlainText(node);
  }
}

export function toPlainText(doc: JSONContent): string {
  return plainTextNode(doc);
}

function escapeMarkdownText(text: string): string {
  return text.replace(/([\\`*_{}\[\]()#+\-.!>~])/g, '\\$1');
}

function inlineMarkdown(node: JSONContent): string {
  if (node.type === 'hardBreak') return '  \n';
  if (node.type === 'image') {
    const alt = (stringAttr(node, 'alt') ?? '').replace(/\]/g, '\\]');
    return `![${alt}](kb-asset:${stringAttr(node, 'assetPath') ?? ''})`;
  }
  if (node.type !== 'text') return children(node).map(inlineMarkdown).join('');

  let result = escapeMarkdownText(node.text ?? '');
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold': result = `**${result}**`; break;
      case 'italic': result = `_${result}_`; break;
      case 'code': result = `\`${result.replace(/`/g, '\\`')}\``; break;
      case 'strike': result = `~~${result}~~`; break;
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href.replace(/[\\)]/g, '\\$&') : '';
        result = `[${result}](${href})`;
        break;
      }
      case 'underline': break;
      default: break;
    }
  }
  return result;
}

function inlineContent(node: JSONContent): string {
  return children(node).map(inlineMarkdown).join('');
}

function markdownList(node: JSONContent, depth: number): string {
  const ordered = node.type === 'orderedList';
  const start = Number.isInteger(node.attrs?.start) ? Number(node.attrs?.start) : 1;
  return children(node).map((item, index) => {
    const indent = '  '.repeat(depth);
    const continuation = '  '.repeat(depth + 1);
    const marker = ordered ? `${start + index}.` : '-';
    const lines: string[] = [];
    let hasContent = false;
    for (const child of children(item)) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        if (!hasContent) {
          lines.push(`${indent}${marker}`);
          hasContent = true;
        }
        lines.push(markdownList(child, depth + 1));
      } else {
        const blockLines = markdownBlock(child).split('\n');
        if (!blockLines.some(Boolean)) continue;
        if (!hasContent) {
          lines.push(`${indent}${marker} ${blockLines[0]}`);
          lines.push(...blockLines.slice(1).map((line) => `${continuation}${line}`));
          hasContent = true;
        } else {
          lines.push(...blockLines.map((line) => `${continuation}${line}`));
        }
      }
    }
    if (!hasContent) lines.push(`${indent}${marker}`);
    return lines.join('\n');
  }).join('\n');
}

function markdownTable(node: JSONContent): string {
  const rows = children(node).map((row) => children(row).map((cell) => inlineContent(cell).replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
  if (!rows.length) return '';
  const renderRow = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const header = rows[0];
  const separator = header.map(() => '---');
  return [renderRow(header), renderRow(separator), ...rows.slice(1).map(renderRow)].join('\n');
}

function markdownCallout(node: JSONContent): string {
  const label = calloutLabel(node);
  const body = children(node).map(markdownBlock).filter(Boolean).join('\n\n');
  const lines = [`**${label}:**${body ? ` ${body}` : ''}`];
  return lines.join('\n').split('\n').map((line) => `> ${line}`).join('\n');
}

function markdownBlock(node: JSONContent): string {
  switch (node.type) {
    case 'doc': return children(node).map(markdownBlock).filter(Boolean).join('\n\n');
    case 'paragraph': return inlineContent(node);
    case 'heading': {
      const rawLevel = Number(node.attrs?.level);
      const level = Number.isInteger(rawLevel) ? Math.min(3, Math.max(1, rawLevel)) : 1;
      return `${'#'.repeat(level)} ${inlineContent(node)}`;
    }
    case 'bulletList':
    case 'orderedList': return markdownList(node, 0);
    case 'blockquote': return children(node).map(markdownBlock).filter(Boolean).join('\n\n').split('\n').map((line) => `> ${line}`).join('\n');
    case 'codeBlock': {
      const language = stringAttr(node, 'language') ?? '';
      const code = children(node).map((child) => child.text ?? '').join('');
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case 'horizontalRule': return '---';
    case 'table': return markdownTable(node);
    case 'image': return inlineMarkdown(node);
    case 'callout': return markdownCallout(node);
    default: return inlineMarkdown(node);
  }
}

export function toMarkdown(doc: JSONContent): string {
  return markdownBlock(doc);
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === 'object') {
    const object = value as JsonObject;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, sortObjectKeys(object[key])]));
  }
  return value;
}

export async function contentHash(doc: JSONContent): Promise<string> {
  const canonical = JSON.stringify(sortObjectKeys(stripImageSources(doc)));
  return sha256Hex(canonical);
}
