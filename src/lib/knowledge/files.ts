import type { KnowledgeFormat } from './types';

export const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp'] as const;
export const MAX_FILE_BYTES = 52_428_800;
export const MAX_INLINE_TEXT_BYTES = 2_097_152;

const EXTENSION_FORMATS: Record<string, KnowledgeFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.txt': 'txt',
  '.md': 'md',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
};

const MIME_FORMATS: Record<string, KnowledgeFormat> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
};

export function detectFormat(file: Pick<File, 'name' | 'type'>): KnowledgeFormat | null {
  const extension = file.name.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase();
  if (extension) return EXTENSION_FORMATS[extension] ?? null;
  return MIME_FORMATS[file.type.trim().toLowerCase()] ?? null;
}

/** Produce one safe storage path segment while retaining the file extension. */
export function safeStorageName(name: string): string {
  const extensionMatch = name.match(/\.[^.\\/]+$/);
  const rawExtension = extensionMatch?.[0] ?? '';
  const rawBase = extensionMatch ? name.slice(0, -rawExtension.length) : name;
  const extension = rawExtension.slice(0, 20);
  const base = rawBase
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '') || 'archivo';
  const baseLength = Math.max(1, 120 - extension.length);
  return `${base.slice(0, baseLength)}${extension}`;
}

export async function readTextIfPlain(file: Pick<File, 'name' | 'type' | 'size' | 'text'>): Promise<string | null> {
  const format = detectFormat(file);
  if ((format !== 'txt' && format !== 'md') || file.size > MAX_INLINE_TEXT_BYTES) return null;
  return file.text();
}
