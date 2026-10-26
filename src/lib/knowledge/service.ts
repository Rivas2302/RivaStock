import { keywordChunkSearch, semanticSearch, type KnowledgeChunkResult, type KnowledgeChunkSearchResponse } from './search';
import type { KnowledgeSearchFilters } from './types';

export interface SearchKnowledgeFilters {
  document_ids?: string[];
  category_ids?: string[];
  folder_ids?: string[];
  tag_ids?: string[];
}

export interface SearchKnowledgeInput {
  query: string;
  filters?: SearchKnowledgeFilters;
  topK?: number;
  mode?: 'auto' | 'keyword';
}

export interface SearchKnowledgeResult {
  mode: 'keyword' | 'semantic';
  notice?: string | null;
  results: KnowledgeChunkResult[];
}

export interface KnowledgeServiceDependencies {
  keyword: (query: string, filters: KnowledgeSearchFilters, topK: number) => Promise<KnowledgeChunkResult[]>;
  semantic: (query: string, filters: KnowledgeSearchFilters, topK: number) => Promise<KnowledgeChunkSearchResponse>;
}

export function createKnowledgeService(dependencies: KnowledgeServiceDependencies) {
  return async function searchKnowledge(input: SearchKnowledgeInput): Promise<SearchKnowledgeResult> {
    const query = input.query.trim();
    const filters = mapFilters(input.filters ?? {});
    const topK = input.topK ?? 10;
    if (input.mode === 'keyword') {
      return { mode: 'keyword', notice: null, results: await dependencies.keyword(query, filters, topK) };
    }
    const result = await dependencies.semantic(query, filters, topK);
    return { mode: result.mode, notice: result.notice, results: result.results };
  };
}

function mapFilters(filters: SearchKnowledgeFilters): KnowledgeSearchFilters {
  return {
    ...(filters.document_ids?.length ? { documentIds: filters.document_ids } : {}),
    ...(filters.category_ids?.length ? { categoryIds: filters.category_ids } : {}),
    ...(filters.folder_ids?.length ? { folderIds: filters.folder_ids } : {}),
    ...(filters.tag_ids?.length ? { tagIds: filters.tag_ids } : {}),
  };
}

export const searchKnowledge = createKnowledgeService({
  keyword: keywordChunkSearch,
  semantic: (query, filters, topK) => semanticSearch(query, filters, topK),
});
