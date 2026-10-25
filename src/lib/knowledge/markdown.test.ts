// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdownSafe } from './markdown';

describe('renderMarkdownSafe', () => {
  it('removes script elements and event-handler attributes', async () => {
    const html = await renderMarkdownSafe('<script>alert("unsafe")</script>\n\n<img src="x" onerror="alert(1)">');

    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/onerror\s*=/i);
    expect(html).toContain('<img src="x">');
  });
});
