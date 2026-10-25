import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { createKnowledgePdf, layoutRuns } from './pdfExport';

const loadImage = async () => null;

function pageCount(blob: Blob): Promise<number> {
  return blob.arrayBuffer().then((buffer) => {
    const content = new TextDecoder('latin1').decode(buffer);
    return (content.match(/\/Type \/Page\b/g) ?? []).length;
  });
}

describe('knowledge PDF export', () => {
  it('wraps words to the available width and preserves inline styles', () => {
    const lines = layoutRuns(
      [{ text: 'Guía', bold: true }, { text: ' de prueba' }],
      8,
      (text) => text.length,
    );

    expect(lines.map((line) => line.segments.map((segment) => segment.text).join(''))).toEqual(['Guía de', 'prueba']);
    expect(lines[0].segments[0]).toMatchObject({ text: 'Guía', bold: true });
    expect(lines[0].segments[1]).toMatchObject({ text: ' de' });
  });

  it('generates a PDF for all editor block types and uses a missing-image placeholder', async () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Guía profesional' }] },
        { type: 'paragraph', content: [
          { type: 'text', text: 'Texto en negrita', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' y cursiva', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' con código', marks: [{ type: 'code' }] },
          { type: 'text', text: ' y enlace', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        ] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Viñeta' }] }] }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Paso' }] }] }] },
        { type: 'table', content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Campo' }] }] }, { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Valor' }] }] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Uno' }] }] }] },
        ] },
        { type: 'callout', attrs: { variant: 'warning' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Aviso importante' }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cita destacada' }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const answer = 42;' }] },
        { type: 'image', attrs: { assetPath: 'owner/doc/image.webp', alt: 'Captura' } },
        { type: 'horizontalRule' },
      ],
    };

    const pdf = await createKnowledgePdf({
      doc,
      title: 'Guía de atención',
      businessName: 'RivaStock',
      versionNumber: 2,
      updatedAt: '2026-10-25T12:00:00.000Z',
      loadImage,
    });

    expect(pdf.blob.type).toBe('application/pdf');
    expect(pdf.blob.size).toBeGreaterThan(1_000);
    expect(await pageCount(pdf.blob)).toBeGreaterThanOrEqual(1);
    expect(pdf.fileName).toBe('guia-de-atencion-v2.pdf');
  });

  it('paginates long documents and includes page totals in the output', async () => {
    const doc: JSONContent = {
      type: 'doc',
      content: Array.from({ length: 200 }, (_, index) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `Párrafo ${index + 1}: contenido de prueba para comprobar la paginación automática del documento.` }],
      })),
    };

    const pdf = await createKnowledgePdf({
      doc,
      title: 'Documento largo',
      businessName: 'Mi Negocio',
      versionNumber: 1,
      updatedAt: '2026-10-25T12:00:00.000Z',
      loadImage,
    });

    expect(await pageCount(pdf.blob)).toBeGreaterThan(1);
    expect(pdf.blob.size).toBeGreaterThan(1_000);
  });
});
