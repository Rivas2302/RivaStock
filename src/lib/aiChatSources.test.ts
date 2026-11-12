import { describe, expect, it } from 'vitest';
import { shouldShowAIChatKnowledgeSources } from './aiChatSources';

describe('AI chat knowledge sources', () => {
  it('shows Codex sources only after a successful knowledge tool call', () => {
    expect(shouldShowAIChatKnowledgeSources('codex', [])).toBe(false);
    expect(shouldShowAIChatKnowledgeSources('codex', [{ tool: 'conocimiento_buscar', ok: false, row_count: null, error: null, created_at: '' }])).toBe(false);
    expect(shouldShowAIChatKnowledgeSources('codex', [{ tool: 'conocimiento_buscar', ok: true, row_count: 2, error: null, created_at: '' }])).toBe(true);
  });

  it('keeps automatic sources visible for providers that use automatic retrieval', () => {
    expect(shouldShowAIChatKnowledgeSources('claude', [])).toBe(true);
    expect(shouldShowAIChatKnowledgeSources('mock', undefined)).toBe(true);
  });
});
