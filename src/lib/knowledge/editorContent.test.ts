import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { applyImageSources, collectAssetPaths, contentHash, EMPTY_DOC, stripImageSources, toMarkdown, toPlainText } from './editorContent';

const sampleDocument: JSONContent = {
  type: 'doc',
  attrs: { z: 2, a: 1 },
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Guía' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Texto ' },
      { type: 'text', text: 'fuerte', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' inclinado', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' código', marks: [{ type: 'code' }] },
      { type: 'text', text: ' tachado', marks: [{ type: 'strike' }] },
      { type: 'text', text: ' vínculo', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      { type: 'text', text: ' subrayado', marks: [{ type: 'underline' }] },
    ] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Primer punto' }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Paso anidado' }] }] },
        ] },
      ] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Segundo punto' }] }] },
    ] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cita' }] }] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const answer = 42;' }] },
    { type: 'horizontalRule' },
    { type: 'table', content: [
      { type: 'tableRow', content: [
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nombre' }] }] },
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Detalle' }] }] },
      ] },
      { type: 'tableRow', content: [
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dato | valor' }] }] },
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Listo' }] }] },
      ] },
    ] },
    { type: 'image', attrs: { src: 'https://signed.example/image?token=secret', assetPath: 'owner/doc/image.png', alt: 'Captura' } },
    { type: 'callout', attrs: { variant: 'warning' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Revisá antes de publicar.' }] }] },
  ],
};

describe('knowledge editor content helpers', () => {
  it('serializes all supported blocks and marks to Markdown', () => {
    expect(toMarkdown(sampleDocument)).toMatchInlineSnapshot(`
      "## Guía

      Texto **fuerte**_ inclinado_\` código\`~~ tachado~~[ vínculo](https://example.com) subrayado

      - Primer punto
        3. Paso anidado
      - Segundo punto

      > Cita

      \`\`\`ts
      const answer = 42;
      \`\`\`

      ---

      | Nombre | Detalle |
      | --- | --- |
      | Dato \\| valor | Listo |

      ![Captura](kb-asset:owner/doc/image.png)

      > **Advertencia:** Revisá antes de publicar\\."
    `);
  });

  it('serializes document text with paragraphs, lists, tables, images and callout labels', () => {
    expect(toPlainText(sampleDocument)).toMatchInlineSnapshot(`
      "Guía
      Texto fuerte inclinado código tachado vínculo subrayado
      - Primer punto
        3. Paso anidado
      - Segundo punto
      Cita
      const answer = 42;
      Nombre | Detalle
      Dato | valor | Listo
      [Imagen: Captura]
      Advertencia: Revisá antes de publicar."
    `);
  });

  it('escapes Markdown punctuation in unmarked text', () => {
    expect(toMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'literal ~ # > -' }] }] }))
      .toBe('literal \\~ \\# \\> \\-');
  });

  it('serializes hard breaks as Markdown line breaks and plain text newlines', () => {
    const document: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'primera' },
        { type: 'hardBreak' },
        { type: 'text', text: 'segunda' },
      ] }],
    };

    expect(toMarkdown(document)).toBe('primera  \nsegunda');
    expect(toPlainText(document)).toBe('primera\nsegunda');
  });

  it('collects unique asset paths and applies signed URLs without mutating stored JSON', () => {
    const document: JSONContent = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'old-url', assetPath: 'private/a.png', alt: 'A' } },
        { type: 'image', attrs: { src: 'old-url', assetPath: 'private/a.png', alt: 'A copy' } },
        { type: 'image', attrs: { src: 'external-url', alt: 'External' } },
      ],
    };

    expect(collectAssetPaths(document)).toEqual(['private/a.png']);
    const displayDocument = applyImageSources(document, { 'private/a.png': 'https://signed.example/a' });
    expect(displayDocument.content?.[0].attrs?.src).toBe('https://signed.example/a');
    expect(displayDocument.content?.[2].attrs?.src).toBe('external-url');
    expect(document.content?.[0].attrs?.src).toBe('old-url');
  });

  it('strips signed URLs from a deep copy of image nodes with private asset paths', () => {
    const stripped = stripImageSources(sampleDocument);
    const image = stripped.content?.find((node) => node.type === 'image');

    expect(image?.attrs?.src).toBeNull();
    expect(image?.attrs?.assetPath).toBe('owner/doc/image.png');
    expect(sampleDocument.content?.find((node) => node.type === 'image')?.attrs?.src).toContain('token=secret');
  });

  it('produces the same content hash when object keys arrive in a different order', async () => {
    const reordered: JSONContent = {
      content: sampleDocument.content?.map((node) => ({
        content: node.content,
        attrs: node.attrs ? Object.fromEntries(Object.entries(node.attrs).reverse()) : undefined,
        type: node.type,
      })),
      attrs: { a: 1, z: 2 },
      type: 'doc',
    };

    const refreshedSignedUrl = structuredClone(sampleDocument);
    const image = refreshedSignedUrl.content?.find((node) => node.type === 'image');
    if (image?.attrs) image.attrs.src = 'https://signed.example/image?token=refreshed';

    expect(await contentHash(sampleDocument)).toBe(await contentHash(reordered));
    expect(await contentHash(sampleDocument)).toBe(await contentHash(refreshedSignedUrl));
  });

  it('provides a minimal empty document', () => {
    expect(EMPTY_DOC).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});
