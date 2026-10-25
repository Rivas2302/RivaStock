import { describe, expect, it } from 'vitest';
import { diffLines } from './lineDiff';

describe('diffLines', () => {
  it('aligns unchanged lines and marks inserted lines', () => {
    expect(diffLines('first\nlast', 'first\nnew\nlast')).toEqual({
      approximate: false,
      rows: [
        { before: { text: 'first', kind: 'same' }, after: { text: 'first', kind: 'same' } },
        { before: null, after: { text: 'new', kind: 'added' } },
        { before: { text: 'last', kind: 'same' }, after: { text: 'last', kind: 'same' } },
      ],
    });
  });

  it('marks deleted and replaced lines', () => {
    expect(diffLines('first\nold\nlast', 'first\nnew\nlast').rows).toEqual([
      { before: { text: 'first', kind: 'same' }, after: { text: 'first', kind: 'same' } },
      { before: { text: 'old', kind: 'removed' }, after: null },
      { before: null, after: { text: 'new', kind: 'added' } },
      { before: { text: 'last', kind: 'same' }, after: { text: 'last', kind: 'same' } },
    ]);
  });

  it('marks a long comparison approximate instead of allocating an oversized LCS matrix', () => {
    const before = Array.from({ length: 1_415 }, (_, index) => `before ${index}`).join('\n');
    const after = Array.from({ length: 1_415 }, (_, index) => `after ${index}`).join('\n');
    expect(diffLines(before, after).approximate).toBe(true);
  });
});
