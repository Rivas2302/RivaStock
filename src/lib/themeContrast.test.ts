import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function declarations(block: string) {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map((match) => [match[1], match[2]]),
  );
}

function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)?.map((channel) => parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Invalid hex color: ${hex}`);

  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('mobile text theme contrast', () => {
  const themes = [...css.matchAll(/:root(\.dark)?\s*\{([^}]*)\}/g)].map((match) => ({
    name: match[1] ? 'dark' : 'light',
    colors: declarations(match[2]),
  }));

  it.each(themes)('keeps ink-subtle at WCAG AA on every $name surface', ({ colors }) => {
    for (const surface of ['canvas', 'surface', 'surface-raised', 'surface-muted']) {
      expect(contrastRatio(colors['ink-subtle'], colors[surface]), `${surface} contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
