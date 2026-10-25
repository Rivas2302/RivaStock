export function normalizeText(text: string, options: { pdf?: boolean } = {}): string {
  let normalized = text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cc}]/gu, (character) => character === '\n' || character === '\t' ? character : '')
    .replace(/\t/g, ' ');

  if (options.pdf) {
    normalized = normalized
      .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
      .replace(/([^\n])\n(?!\n)/g, '$1 ');
  }

  return normalized
    .split('\n')
    .map((line) => line.replace(/ +/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function removeRepeatedLines(pages: string[]): string[] {
  if (pages.length < 4) return pages;

  const pageNumbers = /^\s*(p[aá]g(ina)?\.?\s*)?\d+(\s*(de|\/)\s*\d+)?\s*$/i;
  const lineCounts = new Map<string, number>();
  for (const page of pages) {
    const uniqueLines = new Set(page.split(/\r?\n/).map((line) => line.trim()));
    for (const line of uniqueLines) {
      if (line.length >= 3 && line.length <= 80) lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
    }
  }

  const repeated = new Set(
    [...lineCounts.entries()]
      .filter(([, count]) => count / pages.length >= 0.6)
      .map(([line]) => line),
  );
  return pages.map((page) => page.split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !pageNumbers.test(trimmed) && !repeated.has(trimmed);
    })
    .join('\n'));
}
