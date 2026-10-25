import { describe, expect, it, vi } from 'vitest';

vi.mock('../aiBridge', () => ({ getAIBridgeState: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import { createKnowledgeSearch, type KnowledgeSearchDependencies } from './search';

function result(content: string) {
  return {
    chunk_id: 'chunk-1', document_id: 'document-1', version_id: 'version-1', version_number: 1,
    title: 'Manual DVR', section_path: 'Red', page_from: 1, page_to: 1,
    content, similarity: 0.9, text_rank: 0.7, score: 0.03,
  };
}

function dependencies(overrides: Partial<KnowledgeSearchDependencies> = {}): KnowledgeSearchDependencies {
  return {
    getBridgeState: async () => ({ state: 'idle' }),
    searchText: async () => [result('keyword result')],
    requestSearch: async () => 'request-1',
    readSearch: async () => ({ status: 'completed', results: [result('semantic result')], error: null }),
    sleep: async () => undefined,
    now: () => Date.now(),
    ...overrides,
  };
}

describe('knowledge chunk search', () => {
  it('falls back to keyword chunks when the Bridge is offline', async () => {
    const searchText = vi.fn(async () => [result('keyword result')]);
    const search = createKnowledgeSearch(dependencies({ getBridgeState: async () => ({ state: 'offline' }), searchText }));

    const response = await search.semanticSearch('configurar DVR', { categoryId: 'category-1' }, 12);

    expect(response).toMatchObject({ mode: 'keyword', notice: expect.stringContaining('desconectada') });
    expect(searchText).toHaveBeenCalledWith('configurar DVR', { category_ids: ['category-1'] }, 12);
  });

  it('limits the browser query length and top-k for keyword searches', async () => {
    const searchText = vi.fn(async () => [result('keyword result')]);
    const search = createKnowledgeSearch(dependencies({ searchText }));

    await search.keywordChunkSearch(`  ${'x'.repeat(510)}  `, {}, 90);

    expect(searchText).toHaveBeenCalledWith('x'.repeat(500), {}, 30);
  });

  it('polls a connected Bridge and returns semantic results after completion', async () => {
    let now = 0;
    let polls = 0;
    const requestSearch = vi.fn(async () => 'request-1');
    const readSearch = vi.fn(async () => {
      polls += 1;
      return polls === 1
        ? { status: 'processing' as const, results: null, error: null }
        : { status: 'completed' as const, results: [result('semantic result')], error: null };
    });
    const sleep = vi.fn(async (milliseconds: number) => { now += milliseconds; });
    const search = createKnowledgeSearch(dependencies({
      now: () => now,
      readSearch,
      requestSearch,
      sleep,
    }));

    const response = await search.semanticSearch('puerto de red', { tagIds: ['tag-1'] }, 8);

    expect(response).toEqual({ mode: 'semantic', notice: null, results: [result('semantic result')] });
    expect(requestSearch).toHaveBeenCalledWith('puerto de red', { tag_ids: ['tag-1'] }, 8);
    expect(readSearch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(600, expect.any(AbortSignal));
  });

  it('falls back to keyword results when a semantic request fails', async () => {
    const search = createKnowledgeSearch(dependencies({
      readSearch: async () => ({ status: 'failed', results: null, error: 'bridge error' }),
    }));

    const response = await search.semanticSearch('cámara');

    expect(response.mode).toBe('keyword');
    expect(response.notice).toMatch(/no está disponible/);
    expect(response.results[0].content).toBe('keyword result');
  });

  it('falls back to keyword results when semantic polling reaches its deadline', async () => {
    let now = 0;
    const search = createKnowledgeSearch(dependencies({
      now: () => now,
      readSearch: async () => ({ status: 'processing', results: null, error: null }),
      sleep: async (milliseconds) => { now += milliseconds; },
    }));

    const response = await search.semanticSearch('configuración de red');

    expect(response.mode).toBe('keyword');
    expect(response.notice).toMatch(/no está disponible/);
    expect(response.results[0].content).toBe('keyword result');
  });
});
