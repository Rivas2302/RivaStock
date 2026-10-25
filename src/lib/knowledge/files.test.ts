import { describe, expect, it } from 'vitest';
import { ALLOWED_EXTENSIONS, detectFormat, MAX_FILE_BYTES, readTextIfPlain, safeStorageName } from './files';

function fileLike(name: string, type = '', content = ''): Pick<File, 'name' | 'type' | 'size' | 'text'> {
  return { name, type, size: new TextEncoder().encode(content).byteLength, text: async () => content };
}

describe('knowledge file helpers', () => {
  it('detects all supported formats by extension and falls back to MIME type', () => {
    expect(ALLOWED_EXTENSIONS).toEqual(['.pdf', '.docx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp']);
    expect(detectFormat(fileLike('manual.PDF'))).toBe('pdf');
    expect(detectFormat(fileLike('manual.docx'))).toBe('docx');
    expect(detectFormat(fileLike('manual.md'))).toBe('md');
    expect(detectFormat(fileLike('without-extension', 'text/markdown'))).toBe('md');
    expect(detectFormat(fileLike('unsupported.csv', 'text/plain'))).toBeNull();
    expect(MAX_FILE_BYTES).toBe(52_428_800);
  });

  it('sanitizes storage names, preserves extensions and caps the length', () => {
    expect(safeStorageName('../../Guía de ventas.pdf')).toBe('Gu-a-de-ventas.pdf');
    expect(safeStorageName('manual')).toBe('manual');
    expect(safeStorageName('///')).toBe('archivo');
    expect(safeStorageName(`${'a'.repeat(140)}.docx`)).toHaveLength(120);
    expect(safeStorageName(`${'a'.repeat(140)}.docx`)).toMatch(/\.docx$/);
  });

  it('reads only small plain text and Markdown files', async () => {
    expect(await readTextIfPlain(fileLike('guide.md', '', '# Guía'))).toBe('# Guía');
    expect(await readTextIfPlain(fileLike('notes.txt', 'text/plain', 'Notas'))).toBe('Notas');
    const largeText = { ...fileLike('large.txt', 'text/plain', 'a'), size: MAX_FILE_BYTES };
    expect(await readTextIfPlain(largeText)).toBeNull();
    expect(await readTextIfPlain(fileLike('manual.pdf', 'application/pdf', 'PDF'))).toBeNull();
  });
});
