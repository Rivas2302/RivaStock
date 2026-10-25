import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkBlocks, CHUNK_MAX, CHUNK_OVERLAP, splitLongText } from '../src/knowledge/chunk.ts';
import { NonRetryableError } from '../src/knowledge/errors.ts';
import type { SourceBlock } from '../src/knowledge/extract.ts';

function block(text: string, headingPath: string[] = [], page: number | null = null): SourceBlock {
  return { text, headingPath, page };
}

test('chunkBlocks creates one deterministic passage for short text', () => {
  const chunks = chunkBlocks('DVR manual', [block('Connect the camera to the DVR.', ['Network'], 1)]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].content, 'Connect the camera to the DVR.');
  assert.equal(chunks[0].sectionPath, 'Network');
  assert.equal(chunks[0].pageFrom, 1);
  assert.equal(chunks[0].pageTo, 1);
  assert.equal(chunks[0].tokenEstimate, 8);
  assert.match(chunks[0].contentHash, /^[0-9a-f]{64}$/);
  assert.equal(chunks[0].embeddingInput, 'passage: DVR manual — Network\nConnect the camera to the DVR.');
});

test('long text is split under the maximum with shared context and no overlap-only chunks', () => {
  const chunks = chunkBlocks('Long manual', [block('palabra '.repeat(1250), ['Install'], 2)]);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.content.length <= CHUNK_MAX);
    assert.ok(chunk.content.length > CHUNK_OVERLAP);
  }
  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1].content;
    const current = chunks[index].content;
    let overlap = 0;
    for (let length = 1; length <= CHUNK_OVERLAP; length += 1) {
      if (previous.endsWith(current.slice(0, length))) overlap = length;
    }
    assert.ok(overlap >= 150);
  }
});

test('chunkBlocks keeps section paths separate and carries page ranges', () => {
  const chunks = chunkBlocks('Manual', [
    block('Conectar el DVR al router.', ['Network'], 1),
    block('Revisar el indicador de red.', ['Network'], 2),
    block('Cambiar el código maestro.', ['Security'], 3),
  ]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].sectionPath, 'Network');
  assert.deepEqual([chunks[0].pageFrom, chunks[0].pageTo], [1, 2]);
  assert.equal(chunks[0].content, 'Conectar el DVR al router.\n\nRevisar el indicador de red.');
  assert.equal(chunks[1].sectionPath, 'Security');
  assert.deepEqual([chunks[1].pageFrom, chunks[1].pageTo], [3, 3]);
  assert.match(chunks[1].content, /Cambiar el código maestro/);
});

test('splitLongText breaks a long sentence into pieces no longer than 1400 characters', () => {
  const text = 'x'.repeat(5000);
  const parts = splitLongText(text);
  assert.deepEqual(parts.map((part) => part.length), [1400, 1400, 1400, 800]);
  assert.equal(parts.join(''), text);
});

test('chunkBlocks rejects documents that exceed the chunk count limit', () => {
  const blocks = Array.from({ length: 2001 }, (_, index) => block('x', [`Section ${index}`]));
  assert.throws(() => chunkBlocks('Oversized', blocks), NonRetryableError);
});
