export type BeforeLineKind = 'same' | 'removed';
export type AfterLineKind = 'same' | 'added';

export interface LineDiffCell {
  text: string;
  kind: BeforeLineKind | AfterLineKind;
}

export interface LineDiffRow {
  before: LineDiffCell | null;
  after: LineDiffCell | null;
}

export interface LineDiffResult {
  rows: LineDiffRow[];
  approximate: boolean;
}

const MAX_LCS_CELLS = 2_000_000;

function sameLine(text: string): LineDiffRow {
  return { before: { text, kind: 'same' }, after: { text, kind: 'same' } };
}

function coarseDiff(before: string[], after: string[]): LineDiffResult {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) suffix += 1;

  const rows: LineDiffRow[] = before.slice(0, prefix).map(sameLine);
  for (const text of before.slice(prefix, before.length - suffix)) {
    rows.push({ before: { text, kind: 'removed' }, after: null });
  }
  for (const text of after.slice(prefix, after.length - suffix)) {
    rows.push({ before: null, after: { text, kind: 'added' } });
  }
  for (let index = suffix; index > 0; index -= 1) rows.push(sameLine(before[before.length - index]));
  return { rows, approximate: true };
}

/** Compares text line by line, aligning unchanged lines with a longest common subsequence. */
export function diffLines(beforeText: string, afterText: string): LineDiffResult {
  const before = beforeText.split('\n');
  const after = afterText.split('\n');
  const width = after.length + 1;
  const cells = (before.length + 1) * width;
  if (cells > MAX_LCS_CELLS) return coarseDiff(before, after);

  const lcs = new Uint32Array(cells);
  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      const index = beforeIndex * width + afterIndex;
      lcs[index] = before[beforeIndex] === after[afterIndex]
        ? lcs[(beforeIndex + 1) * width + afterIndex + 1] + 1
        : Math.max(lcs[(beforeIndex + 1) * width + afterIndex], lcs[beforeIndex * width + afterIndex + 1]);
    }
  }

  const rows: LineDiffRow[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length || afterIndex < after.length) {
    if (beforeIndex < before.length && afterIndex < after.length && before[beforeIndex] === after[afterIndex]) {
      rows.push(sameLine(before[beforeIndex]));
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    const canAdd = afterIndex < after.length;
    const canRemove = beforeIndex < before.length;
    if (canAdd && (!canRemove
      || lcs[beforeIndex * width + afterIndex + 1] > lcs[(beforeIndex + 1) * width + afterIndex])) {
      rows.push({ before: null, after: { text: after[afterIndex], kind: 'added' } });
      afterIndex += 1;
    } else if (canRemove) {
      rows.push({ before: { text: before[beforeIndex], kind: 'removed' }, after: null });
      beforeIndex += 1;
    }
  }
  return { rows, approximate: false };
}
