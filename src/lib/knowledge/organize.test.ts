import { describe, expect, it } from 'vitest';
import { buildNotesFromDraft, proposalToTiptap, validateProposal, type OrganizeProposal } from './organize';

const proposal: OrganizeProposal = {
  title: 'Recepción de mercadería',
  summary: 'Control **inicial**.',
  blocks: [
    { type: 'heading', level: 2, text: 'Procedimiento' },
    { type: 'steps', items: [{ text: 'Comparar **el remito** con la orden.', image_ids: ['IMG1'] }] },
    { type: 'callout', variant: 'warning', text: 'Separar productos dañados.' },
    { type: 'table', header: ['Producto', 'Recibido'], rows: [['Tornillos', '20']] },
  ],
  missing_information: ['Indicar cómo registrar diferencias.'],
};

describe('Knowledge organization proposal', () => {
  it('replaces draft images with markers and returns their asset map', () => {
    const result = buildNotesFromDraft({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Revisar el remito.' },
          { type: 'image', attrs: { assetPath: 'owner/doc/assets/1.png', alt: 'Remito' } },
        ],
      }],
    });

    expect(result.notes).toContain('[[IMG1]]');
    expect(result.imageMap).toEqual({ IMG1: { assetPath: 'owner/doc/assets/1.png', alt: 'Remito' } });
  });

  it('converts headings, ordered steps, bold text, warnings and tables to TipTap nodes', () => {
    const result = proposalToTiptap(proposal, { IMG1: { assetPath: 'owner/doc/assets/1.png', alt: 'Remito' } });
    expect(result.warnings).toEqual([]);
    expect(result.doc.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(result.doc.content?.[1]?.content?.[1]).toMatchObject({ type: 'text', text: 'inicial', marks: [{ type: 'bold' }] });
    expect(result.doc.content?.[3]?.type).toBe('orderedList');
    expect(result.doc.content?.[3]?.content?.[0]?.content?.[0]?.content?.[1]).toMatchObject({
      type: 'text', text: 'el remito', marks: [{ type: 'bold' }],
    });
    expect(result.doc.content?.[3]?.content?.[0]?.content?.[1]).toMatchObject({
      type: 'image', attrs: { assetPath: 'owner/doc/assets/1.png', alt: 'Remito' },
    });
    expect(result.doc.content?.[4]).toMatchObject({ type: 'callout', attrs: { variant: 'warning' } });
    expect(result.doc.content?.[5]?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
    expect(result.doc.content?.[5]?.content?.[1]?.content?.[0]?.type).toBe('tableCell');
  });

  it('uses literal image descriptions as alt text ahead of captions', () => {
    const result = proposalToTiptap({
      ...proposal,
      image_descriptions: { IMG1: 'Pantalla de recepción; el botón Guardar está abajo a la derecha.' },
      blocks: [{ type: 'image', image_id: 'IMG1', caption: 'Captura del proceso' }],
    }, { IMG1: { assetPath: 'owner/doc/assets/1.png', alt: 'Nombre original' } });

    expect(result.doc.content?.[2]).toMatchObject({
      type: 'image',
      attrs: { alt: 'Pantalla de recepción; el botón Guardar está abajo a la derecha.' },
    });
  });

  it('ignores unknown image ids and appends mapped images without a step', () => {
    const result = proposalToTiptap({
      ...proposal,
      blocks: [{ type: 'steps', items: [{ text: 'Revisar el equipo.', image_ids: ['IMG9'] }] }],
    }, {
      IMG1: { assetPath: 'owner/doc/assets/1.png', alt: 'Captura' },
    });

    expect(result.warnings).toContain('Se omitió IMG9: la propuesta hizo referencia a una imagen desconocida.');
    expect(result.doc.content?.[3]).toMatchObject({ type: 'heading', content: [{ type: 'text', text: 'Imágenes sin ubicar' }] });
    expect(result.doc.content?.[4]).toMatchObject({ type: 'image', attrs: { assetPath: 'owner/doc/assets/1.png' } });
  });

  it('applies missing information as a populated section without an empty duplicate heading', () => {
    const result = proposalToTiptap({
      ...proposal,
      blocks: [
        { type: 'heading', level: 2, text: 'Información faltante' },
        ...proposal.blocks,
      ],
      missing_information: ['Proveedor', 'Fecha'],
    }, {});
    const missingHeadings = result.doc.content?.filter((node) => node.type === 'heading'
      && node.content?.some((item) => item.text === 'Información faltante')) ?? [];
    const missingHeadingIndex = result.doc.content?.findIndex((node) => node.type === 'heading'
      && node.content?.some((item) => item.text === 'Información faltante')) ?? -1;

    expect(missingHeadings).toHaveLength(1);
    expect(result.doc.content?.[missingHeadingIndex + 1]).toMatchObject({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Proveedor' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fecha' }] }] },
      ],
    });
  });

  it('rejects malformed proposals and image identifiers', () => {
    expect(() => validateProposal({ ...proposal, blocks: [{ type: 'steps', items: [{ text: 'Paso', image_ids: ['IMAGE1'] }] }] }))
      .toThrow('La IA devolvió una propuesta inválida');
    expect(() => validateProposal({ ...proposal, blocks: [] }))
      .toThrow('La IA devolvió una propuesta inválida');
    expect(() => validateProposal({ ...proposal, image_descriptions: { IMAGE1: 'Descripción' } }))
      .toThrow('La IA devolvió una propuesta inválida');
    expect(() => validateProposal({ ...proposal, image_descriptions: { IMG1: 'x'.repeat(301) } }))
      .toThrow('La IA devolvió una propuesta inválida');
  });
});
