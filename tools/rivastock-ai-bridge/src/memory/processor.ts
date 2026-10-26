import { embedQuery, embedTexts, EMBEDDING_MODEL, PASSAGE_PREFIX } from '../knowledge/embed.ts';
import type { KnowledgeClient } from '../knowledge/client.ts';
import type { AIProvider } from '../types.ts';
import { normalizedEditDistance } from './filters.ts';
import {
  extractMemoryOperations, isNearDuplicate, makeApplyPayload,
  type MemoryExchange,
} from './extract.ts';
import type { MemoryQueueEntry } from './queue.ts';

type MemoryProcessingClient = Pick<KnowledgeClient,
  'memorySimilar' | 'memoryChatSummary' | 'memoryApply' | 'memoryMetric' | 'memoryFinish' | 'pendingMemoryEmbeddings' |
  'storeMemoryEmbeddings' | 'touchSimilarMemory'>;

interface MemoryProcessorOptions {
  client: MemoryProcessingClient;
  workerId: string;
  entries: MemoryQueueEntry[];
  codexProvider: AIProvider;
  codexEnabled: boolean;
  localLlmUrl: string | null;
  localLlmModel: string | null;
  log: (message: string) => void;
  signal?: AbortSignal;
  embedQuery?: (query: string) => Promise<number[]>;
  embedTexts?: (texts: string[]) => Promise<number[][]>;
}

export async function processMemoryBatch(options: MemoryProcessorOptions): Promise<void> {
  const { entries } = options;
  const extractEntries = entries.filter((entry) => entry.shouldExtract);
  try {
    const prefilteredEntries = entries.filter((item) => item.metric === 'skipped_prefilter');
    for (const entry of prefilteredEntries) {
      await options.client.memoryMetric(options.workerId, entry.jobId, 'skipped_prefilter').catch(() => undefined);
    }
    if (prefilteredEntries.length) {
      options.log(`El prefiltro local evitó ${prefilteredEntries.length} extracción(es) de memoria.`);
    }
    if (!extractEntries.length) return;

    const anchor = extractEntries[0];
    if (!anchor) return;
    const embed = options.embedQuery ?? embedQuery;
    const similarQuery = await embed(anchor.input.slice(0, 2000));
    const similar = await options.client.memorySimilar(options.workerId, anchor.jobId, similarQuery);
    const chatSummary = entries.some((entry) => entry.summaryDue)
      ? await options.client.memoryChatSummary(options.workerId, anchor.jobId) : null;
    const extractionContext = chatSummary
      ? [chatSummary, ...similar.memories.filter((memory) => memory.id !== chatSummary.id).slice(0, 7)]
      : similar.memories;
    const duplicated = extractEntries.filter((entry) => similar.memories.some((memory) =>
      isNearDuplicate(entry.input, memory, normalizedEditDistance(entry.input, memory.content))));
    const remainingEntries = extractEntries.filter((entry) => !duplicated.includes(entry));
    const summaryDue = extractEntries.some((entry) => entry.summaryDue);
    const exchangesToProcess = summaryDue ? extractEntries : remainingEntries;
    const remaining: MemoryExchange[] = exchangesToProcess.map(({ input, output }) => ({ input, output }));
    if (duplicated.length) {
      const duplicateIds = similar.memories.filter((memory) => duplicated.some((exchange) =>
        isNearDuplicate(exchange.input, memory, normalizedEditDistance(exchange.input, memory.content))))
        .map((memory) => memory.id);
      if (duplicateIds.length) await options.client.touchSimilarMemory(options.workerId, anchor.jobId, duplicateIds);
      for (const entry of duplicated) {
        await options.client.memoryMetric(options.workerId, entry.jobId, 'skipped_deduplication').catch(() => undefined);
      }
      if (!remaining.length && !summaryDue) {
        options.log(`Se evitó la extracción de memoria de ${duplicated.length} turno(s) duplicado(s).`);
        return;
      }
    }

    if (!options.codexEnabled && !(options.localLlmUrl && options.localLlmModel)) {
      options.log('Se omitió la extracción de memoria: Codex está deshabilitado y no hay un modelo local configurado.');
      return;
    }
    const fallbackProvider: AIProvider = options.codexEnabled ? options.codexProvider : {
      async execute() { throw new Error('La extracción local no respondió y Codex está deshabilitado.'); },
    };
    const extracted = await extractMemoryOperations({
      provider: fallbackProvider,
      signal: options.signal ?? new AbortController().signal,
      exchanges: remaining,
      similar: extractionContext,
      summaryDue,
      localUrl: options.localLlmUrl ?? undefined,
      localModel: options.localLlmModel ?? undefined,
      dependencies: options.embedTexts ? { embed: options.embedTexts } : undefined,
    });
    const applyPayload = makeApplyPayload(extracted);
    if (applyPayload.operations.length) await options.client.memoryApply(options.workerId, anchor.jobId, applyPayload);
    await options.client.memoryMetric(options.workerId, anchor.jobId, 'executed', extracted.provider);
    options.log(`Extracción de memoria completada (${extracted.provider}, ${applyPayload.operations.length} operación(es)).`);
  } catch {
    options.log(`Falló el procesamiento de memoria para el chat ${entries[0]?.chatId}; la respuesta de IA ya fue entregada.`);
  } finally {
    for (const entry of entries) await options.client.memoryFinish(options.workerId, entry.jobId).catch(() => undefined);
  }
}

export async function processPendingMemoryEmbeddings(
  client: Pick<KnowledgeClient, 'pendingMemoryEmbeddings' | 'storeMemoryEmbeddings'>,
  workerId: string,
  embed: (texts: string[]) => Promise<number[][]> = embedTexts,
  signal?: AbortSignal,
): Promise<number> {
  if (signal?.aborted) return 0;
  const memories = await client.pendingMemoryEmbeddings(workerId);
  if (!memories.length) return 0;
  const vectors = await embed(memories.map((memory) => `${PASSAGE_PREFIX}${memory.content}`));
  if (signal?.aborted) return 0;
  if (vectors.length !== memories.length || vectors.some((vector) => vector.length !== 384)) {
    throw new Error('El lote de embeddings de memoria no coincide con sus recuerdos.');
  }
  await client.storeMemoryEmbeddings(workerId, memories.map((memory, index) => ({
    id: memory.id,
    embedding: vectors[index] ?? [],
  })), EMBEDDING_MODEL);
  return memories.length;
}
