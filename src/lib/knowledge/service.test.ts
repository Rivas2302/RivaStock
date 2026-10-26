import { describe, expect, it, vi } from 'vitest';
import { createKnowledgeService } from './service';
import type { KnowledgeChunkSearchResponse } from './search';

const semanticResult: KnowledgeChunkSearchResponse = { mode: 'semantic', notice: null, results: [] };
const fallbackResult: KnowledgeChunkSearchResponse = { mode: 'keyword', notice: 'fallback', results: [] };

describe('searchKnowledge service contract', () => {
  it('maps auto to semantic search and translates all filter arrays', async () => {
    const semantic = vi.fn(async () => semanticResult);
    const keyword = vi.fn(async () => []);
    const searchKnowledge = createKnowledgeService({ semantic, keyword });

    const result = await searchKnowledge({
      query: '  pregunta  ',
      mode: 'auto',
      topK: 5,
      filters: { document_ids: ['doc'], category_ids: ['cat'], folder_ids: ['folder'], tag_ids: ['tag'] },
    });

    expect(semantic).toHaveBeenCalledWith('pregunta', {
      documentIds: ['doc'], categoryIds: ['cat'], folderIds: ['folder'], tagIds: ['tag'],
    }, 5);
    expect(keyword).not.toHaveBeenCalled();
    expect(result).toEqual(semanticResult);
  });

  it('forces keyword mode and preserves a fallback response mode and notice', async () => {
    const semantic = vi.fn(async () => fallbackResult);
    const keyword = vi.fn(async () => []);
    const searchKnowledge = createKnowledgeService({ semantic, keyword });

    expect(await searchKnowledge({ query: 'consulta', mode: 'keyword' })).toEqual({
      mode: 'keyword', notice: null, results: [],
    });
    expect(keyword).toHaveBeenCalledWith('consulta', {}, 10);
    expect(semantic).not.toHaveBeenCalled();
    expect(await searchKnowledge({ query: 'consulta' })).toEqual({
      mode: 'keyword', notice: 'fallback', results: [],
    });
  });
});
