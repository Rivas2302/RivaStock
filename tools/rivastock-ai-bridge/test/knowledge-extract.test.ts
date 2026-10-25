import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { extractDocx, extractImage, extractMarkdown, extractPdf, extractPlain } from '../src/knowledge/extract.ts';
import { NonRetryableError } from '../src/knowledge/errors.ts';
import { normalizeText, removeRepeatedLines } from '../src/knowledge/normalize.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function makeDocx(body: string): Buffer {
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'),
    'word/numbering.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`),
  };
  return Buffer.from(zipSync(files));
}

test('normalizeText applies Unicode normalization, removes controls, and preserves paragraph breaks', () => {
  assert.equal(normalizeText('Cafe\u0301\t DVR\u0000\r\n\r\n\r\nRed'), 'Café DVR\n\nRed');
  assert.equal(normalizeText('confi-\nguración\npuerto\n\nHTTP  8080', { pdf: true }), 'configuración puerto\n\nHTTP 8080');
});

test('removeRepeatedLines removes repeated headers and page number lines from four-page input', () => {
  const pages = [1, 2, 3, 4].map((page) => `Manual RivaStock\nContenido de la página ${page}\nPágina ${page} de 4`);
  assert.deepEqual(removeRepeatedLines(pages), [
    'Contenido de la página 1',
    'Contenido de la página 2',
    'Contenido de la página 3',
    'Contenido de la página 4',
  ]);
  assert.deepEqual(removeRepeatedLines(['Página 1 de 2', 'Página 2 de 2']), ['Página 1 de 2', 'Página 2 de 2']);
});

test('extractMarkdown tracks nested headings and keeps images, tables, and code as text', () => {
  const result = extractMarkdown(`# Instalación\n\nInicio del procedimiento.\n\n## Red\n\nConectar ![cámara](private/camera.webp).\n\n### Puertos\n\n| Servicio | Puerto |\n| --- | --- |\n| HTTP | 8080 |\n\n\`\`\`sh\nopen-port 8080\n\`\`\``);
  assert.equal(result.extracted, false);
  assert.equal(result.pageCount, null);
  assert.deepEqual(result.blocks.map((item) => item.headingPath), [
    ['Instalación'],
    ['Instalación', 'Red'],
    ['Instalación', 'Red', 'Puertos'],
    ['Instalación', 'Red', 'Puertos'],
  ]);
  assert.match(result.blocks[1].text, /\[Imagen: cámara\]/);
  assert.match(result.blocks[2].text, /\| HTTP \| 8080 \|/);
  assert.match(result.blocks[3].text, /open-port 8080/);
});

test('extractPlain normalizes and separates paragraphs', () => {
  const result = extractPlain('  First line\r\nsecond line.\r\n\r\nThird paragraph.  ');
  assert.equal(result.fullText, 'First line\nsecond line.\n\nThird paragraph.');
  assert.equal(result.extracted, false);
  assert.deepEqual(result.blocks.map((item) => item.text), ['First line\nsecond line.', 'Third paragraph.']);
});

test('extractDocx reads headings, paragraphs, list items, and tables from a minimal DOCX', async () => {
  const docx = makeDocx(
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Conexión</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Conectá la cámara al DVR.</w:t></w:r></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Puerto</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>8080</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
  );
  const result = await extractDocx(docx);
  assert.equal(result.extracted, true);
  assert.equal(result.pageCount, null);
  assert.equal(result.blocks[0].headingPath[0], 'Conexión');
  assert.equal(result.blocks[0].text, 'Conectá la cámara al DVR.');
  assert.equal(result.blocks[1].text, 'Puerto | 8080');

  const list = await extractDocx(makeDocx(
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Conectar el cable.</w:t></w:r></w:p>',
  ));
  assert.match(list.fullText, /• Conectar el cable\./);
});

test('extractDocx rejects an empty Word document as non-retryable', async () => {
  await assert.rejects(extractDocx(makeDocx('')), NonRetryableError);
});

test('extractPdf preserves page numbers and extracts text from the two-page fixture', async () => {
  const fixture = await readFile(resolve(FIXTURES, 'sample.pdf'));
  const result = await extractPdf(fixture);
  assert.equal(result.pageCount, 2);
  assert.equal(result.extracted, true);
  assert.deepEqual(result.blocks.map((item) => item.page), [1, 2]);
  assert.match(result.fullText, /DVR network setup - page one/);
  assert.match(result.fullText, /Camera connection port 8080 - page two/);
});

test('extractImage returns null without OCR and fails closed while OCR is not installed', async () => {
  assert.equal(await extractImage(new Uint8Array(), false), null);
  await assert.rejects(extractImage(new Uint8Array(), true), NonRetryableError);
});
