import { getAIBridgeState } from '../aiBridge';
import { supabase } from '../supabase';
import type { AIBridgeState } from '../aiBridge';
import type { KnowledgeSearchFilters } from './types';

export interface KnowledgeChunkResult {
  chunk_id: string;
  document_id: string;
  version_id: string;
  version_number: number;
  title: string;
  section_path: string;
  page_from: number | null;
  page_to: number | null;
  content: string;
  similarity: number | null;
  text_rank: number | null;
  score: number;
}

export interface KnowledgeChunkSearchResponse {
  mode: 'keyword' | 'semantic';
  notice: string | null;
  results: KnowledgeChunkResult[];
}

type SearchRequestState = {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired';
  results: KnowledgeChunkResult[] | null;
  error: string | null;
};

type RpcError = { message: string };
type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;
const dynamicRpc = supabase.rpc as unknown as Rpc;

export interface KnowledgeSearchDependencies {
  getBridgeState: () => Promise<{ state: AIBridgeState }>;
  searchText: (query: string, filters: Record<string, unknown>, topK: number) => Promise<KnowledgeChunkResult[]>;
  requestSearch: (query: string, filters: Record<string, unknown>, topK: number) => Promise<string>;
  readSearch: (requestId: string, signal?: AbortSignal) => Promise<SearchRequestState | null>;
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
}

const KEYWORD_NOTICE = 'Tu PC vinculada está desconectada: se muestran resultados por palabras clave.';
const FALLBACK_NOTICE = 'La búsqueda semántica no está disponible ahora: se muestran resultados por palabras clave.';
const POLL_INTERVAL_MS = 600;
const SEARCH_TIMEOUT_MS = 10_000;

export function createKnowledgeSearch(dependencies: KnowledgeSearchDependencies) {
  async function keywordChunkSearch(
    query: string,
    filters: KnowledgeSearchFilters = {},
    topK = 10,
  ): Promise<KnowledgeChunkResult[]> {
    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery) return [];
    return dependencies.searchText(normalizedQuery, rpcFilters(filters), normalizeTopK(topK));
  }

  async function semanticSearch(
    query: string,
    filters: KnowledgeSearchFilters = {},
    topK = 10,
    signal?: AbortSignal,
  ): Promise<KnowledgeChunkSearchResponse> {
    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery) return { mode: 'keyword', notice: null, results: [] };
    throwIfAborted(signal);

    let bridge: { state: AIBridgeState };
    try {
      bridge = await dependencies.getBridgeState();
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      return keywordFallback(normalizedQuery, filters, topK, FALLBACK_NOTICE);
    }
    throwIfAborted(signal);
    if (bridge.state !== 'idle' && bridge.state !== 'busy') {
      return keywordFallback(normalizedQuery, filters, topK, KEYWORD_NOTICE);
    }

    try {
      const requestId = await dependencies.requestSearch(normalizedQuery, rpcFilters(filters), normalizeTopK(topK));
      const results = await waitForSearch(requestId, signal);
      if (results) return { mode: 'semantic', notice: null, results };
      return keywordFallback(normalizedQuery, filters, topK, FALLBACK_NOTICE);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      return keywordFallback(normalizedQuery, filters, topK, FALLBACK_NOTICE);
    }
  }

  async function waitForSearch(requestId: string, signal?: AbortSignal): Promise<KnowledgeChunkResult[] | null> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) throwIfAborted(signal);
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SEARCH_TIMEOUT_MS);
    const deadline = dependencies.now() + SEARCH_TIMEOUT_MS;
    try {
      while (dependencies.now() < deadline && !controller.signal.aborted) {
        throwIfAborted(signal);
        const request = await dependencies.readSearch(requestId, controller.signal);
        if (!request || request.status === 'failed' || request.status === 'expired') return null;
        if (request.status === 'completed') return request.results ?? [];
        const remaining = deadline - dependencies.now();
        if (remaining <= 0) break;
        await dependencies.sleep(Math.min(POLL_INTERVAL_MS, remaining), controller.signal);
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (!timedOut) throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
    return null;
  }

  async function keywordFallback(
    query: string,
    filters: KnowledgeSearchFilters,
    topK: number,
    notice: string,
  ): Promise<KnowledgeChunkSearchResponse> {
    return { mode: 'keyword', notice, results: await keywordChunkSearch(query, filters, topK) };
  }

  return { keywordChunkSearch, semanticSearch };
}

const search = createKnowledgeSearch({
  getBridgeState: getAIBridgeState,
  searchText: async (query, filters, topK) => {
    const { data, error } = await dynamicRpc('knowledge_search_chunks_text', {
      p_query: query, p_filters: filters, p_top_k: topK,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as KnowledgeChunkResult[];
  },
  requestSearch: async (query, filters, topK) => {
    const { data, error } = await dynamicRpc('knowledge_request_search', {
      p_query: query, p_filters: filters, p_top_k: topK,
    });
    if (error) throw new Error(error.message);
    if (typeof data !== 'string') throw new Error('No se pudo iniciar la búsqueda semántica.');
    return data;
  },
  readSearch: async (requestId, signal) => {
    let request = supabase.from('knowledge_search_requests').select('status, results, error').eq('id', requestId);
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request.maybeSingle();
    if (error) throw new Error(error.message);
    return data as SearchRequestState | null;
  },
  sleep: (milliseconds, signal) => sleepWithSignal(milliseconds, signal),
  now: () => Date.now(),
});

export const keywordChunkSearch = search.keywordChunkSearch;
export const semanticSearch = search.semanticSearch;

function normalizeQuery(query: string): string {
  const normalized = query.trim();
  return normalized.length >= 2 ? normalized.slice(0, 500) : '';
}

function normalizeTopK(topK: number): number {
  return Number.isFinite(topK) ? Math.min(Math.max(Math.trunc(topK), 1), 30) : 10;
}

function rpcFilters(filters: KnowledgeSearchFilters): Record<string, unknown> {
  return {
    ...(filters.folderId ? { folder_ids: [filters.folderId] } : {}),
    ...(filters.categoryId ? { category_ids: [filters.categoryId] } : {}),
    ...(filters.tagIds?.length ? { tag_ids: filters.tagIds } : {}),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('La búsqueda fue cancelada.', 'AbortError');
}

function sleepWithSignal(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new DOMException('La búsqueda fue cancelada.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
