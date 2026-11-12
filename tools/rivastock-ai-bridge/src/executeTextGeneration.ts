import type { KnowledgeClient, KnowledgeRetrievedSource } from './knowledge/client.ts';
import { buildKnowledgeContext, retrieveForJob, type RetrievalDependencies } from './knowledge/retrieval.ts';
import { buildMemoryContext, retrieveMemory, type MemoryRetrievalDependencies } from './memory/retrieve.ts';
import { hasExplicitMemoryCommand, isMemoryForgetCommand, isMemoryUpdateCommand, shouldSkipMemoryPrefilter } from './memory/filters.ts';
import type { MemoryQueueEntry } from './memory/queue.ts';
import { embedQuery } from './knowledge/embed.ts';
import { buildChatHistoryContext, referencesChatHistory } from './memory/chatHistory.ts';
import type { AIJobContext, AIProjectContext, AIProvider, AIProviderId, AIProviderOptions, AIWorkspaceFile } from './types.ts';
import { createBusinessContext, createCombinedContext } from './workspace.ts';

export interface ExecuteTextGenerationInput {
  job: { id: string; input: string; provider?: AIProviderId };
  provider: AIProvider;
  signal: AbortSignal;
  jobContext: AIJobContext;
  workspaceFiles: AIWorkspaceFile[];
  projectFiles: AIProjectContext[];
  knowledgeClient: Pick<KnowledgeClient, 'retrieve'> | null;
  workerId: string | null;
  knowledgeEnabled: boolean;
  providerOptions: AIProviderOptions;
  complete: (output: string, sessionId?: string, actionRequestIds?: string[]) => Promise<void>;
  log: (message: string) => void;
  retrievalDependencies?: Partial<RetrievalDependencies>;
  memoryClient?: Pick<KnowledgeClient, 'memoryRetrieve'> & Partial<Pick<KnowledgeClient, 'memoryChatIndex'>> | null;
  memoryWorkerId?: string | null;
  onMemoryTurn?: (entry: MemoryQueueEntry) => void;
  onContextReady?: () => void | Promise<void>;
  memoryRetrievalDependencies?: Partial<MemoryRetrievalDependencies>;
  initialTimings?: Record<string, number | string | boolean>;
  onMeasurements?: (measurements: Record<string, unknown>) => Promise<void>;
}

export async function executeTextGeneration(input: ExecuteTextGenerationInput): Promise<void> {
  const startedAt = performance.now();
  const measurements: Record<string, unknown> = { ...(input.initialTimings ?? {}) };
  const businessFiles = createBusinessContext(input.jobContext);
  const injectedEmbed = input.memoryRetrievalDependencies?.embed ?? input.retrievalDependencies?.embed ?? embedQuery;
  const requestedQuery = input.job.input.slice(0, 2000);
  let queryEmbedding: Promise<number[]> | null = null;
  const embedQueryOnce = (query: string): Promise<number[]> => {
    if (query !== requestedQuery) return injectedEmbed(query);
    queryEmbedding ??= (async () => {
      const embeddingStarted = performance.now();
      try { return await injectedEmbed(query); }
      finally { measurements.query_embedding_ms = Math.round(performance.now() - embeddingStarted); }
    })();
    return queryEmbedding;
  };
  let memoryContext = '';
  let chatHistoryContext = '';
  let memoryTurn: MemoryQueueEntry | null = null;
  let memoryResponseGuidance: AIProviderOptions['memory_response_guidance'];
  if (input.memoryClient && input.memoryWorkerId) {
    const memoryStarted = performance.now();
    const memories = await retrieveMemory(input.memoryClient, input.memoryWorkerId, input.job.id,
      input.job.input, { log: input.log, ...input.memoryRetrievalDependencies, embed: embedQueryOnce });
    measurements.memory_retrieval_including_embedding_ms = Math.round(performance.now() - memoryStarted);
    if (memories) {
      const chatId = input.jobContext.chat_id;
      const explicitCommand = hasExplicitMemoryCommand(input.job.input);
      if (chatId && explicitCommand) {
        if (!memories.enabled || memories.mode === 'off') memoryResponseGuidance = 'disabled';
        else if (isMemoryForgetCommand(input.job.input)) {
          memoryResponseGuidance = memories.mode === 'confirm' ? 'forget-confirm' : 'forget-auto';
        } else if (isMemoryUpdateCommand(input.job.input)) {
          memoryResponseGuidance = memories.mode === 'confirm' ? 'update-confirm' : 'update-auto';
        } else {
          memoryResponseGuidance = memories.mode === 'confirm' ? 'remember-confirm' : 'remember-auto';
        }
      }
      if (memories.enabled) memoryContext = buildMemoryContext(memories.memories);
      if (memories.enabled && memories.mode !== 'off' && referencesChatHistory(input.job.input)
        && input.memoryClient.memoryChatIndex) {
        try {
          const indexStarted = performance.now();
          chatHistoryContext = buildChatHistoryContext(
            await input.memoryClient.memoryChatIndex(input.memoryWorkerId, input.job.id),
          );
          measurements.chat_history_index_ms = Math.round(performance.now() - indexStarted);
        } catch {
          input.log(`No se pudo recuperar el índice de chats anteriores para la tarea ${input.job.id}.`);
        }
      }
      if (chatId && memories.enabled && memories.mode !== 'off') {
        const cadenceDue = memories.user_turn_count === 1 || memories.user_turn_count % 3 === 0;
        const summaryDue = memories.message_count > 0 && memories.message_count % 10 === 9;
        const prefiltered = cadenceDue && !explicitCommand && !summaryDue
          && shouldSkipMemoryPrefilter(input.job.input);
        memoryTurn = {
          jobId: input.job.id,
          chatId,
          input: input.job.input,
          output: '',
          shouldExtract: (cadenceDue && !prefiltered) || explicitCommand || summaryDue,
          summaryDue,
          metric: prefiltered ? 'skipped_prefilter' : null,
        };
      }
    }
  }
  let sources: KnowledgeRetrievedSource[] = [];
  if (input.knowledgeEnabled && input.workerId && input.knowledgeClient) {
    const knowledgeStarted = performance.now();
    sources = await retrieveForJob(input.knowledgeClient, input.workerId, input.job, {
      log: input.log,
      ...input.retrievalDependencies,
      embed: embedQueryOnce,
    });
    measurements.knowledge_retrieval_ms = Math.round(performance.now() - knowledgeStarted);
  } else {
    measurements.knowledge_retrieval_ms = 0;
  }
  input.log(`Tarea ${input.job.id}: ${sources.length} fuentes de Conocimientos.`);
  await input.onContextReady?.();
  const stream = input.providerOptions.stream;
  if (stream) stream.setActivity({ kind: 'thinking', label: 'Pensando…' });
  const generationSignal = stream
    ? AbortSignal.any([input.signal, stream.cancelled])
    : input.signal;
  const providerStartedAt = performance.now();
  const result = await input.provider.execute(input.job.input, generationSignal,
    createCombinedContext(input.workspaceFiles, input.projectFiles, businessFiles,
      [chatHistoryContext, memoryContext, buildKnowledgeContext(sources)].filter(Boolean).join('\n\n')),
    { ...input.providerOptions,
      ...(input.job.provider === 'codex' ? {
      onCodexStart: () => {
        measurements.codex_start_elapsed_ms = Math.round(performance.now() - providerStartedAt);
        input.providerOptions.onCodexStart?.();
      },
      onFirstProviderEvent: () => {
        measurements.codex_first_event_elapsed_ms = Math.round(performance.now() - providerStartedAt);
        input.providerOptions.onFirstProviderEvent?.();
      },
      onPromptBuilt: (length) => {
        measurements.prompt_chars = length;
        input.providerOptions.onPromptBuilt?.(length);
      } } : {}),
      ...(input.job.provider === 'codex' && input.jobContext.chat_id && input.workerId
        ? { tool_worker_id: input.workerId, tool_job_id: input.job.id } : {}),
      ...(memoryResponseGuidance ? { memory_response_guidance: memoryResponseGuidance } : {}) });
  if (typeof result.output !== 'string' || result.output.trim().length === 0 || result.output.length > 20_000) {
    throw new Error('El proveedor devolvió una respuesta vacía o demasiado extensa.');
  }
  measurements.codex_first_event_to_final_ms = typeof measurements.codex_first_event_elapsed_ms === 'number'
    ? Math.max(0, Math.round(performance.now() - providerStartedAt - measurements.codex_first_event_elapsed_ms)) : 0;
  measurements.codex_start_to_first_event_ms = typeof measurements.codex_first_event_elapsed_ms === 'number'
    && typeof measurements.codex_start_elapsed_ms === 'number'
    ? Math.max(0, measurements.codex_first_event_elapsed_ms - measurements.codex_start_elapsed_ms) : 0;
  measurements.response_chars = result.output.trim().length;
  measurements.tool_calls = result.tool_timings ?? [];
  if (input.signal.aborted) throw new Error('La tarea fue interrumpida antes de completarse.');
  if (stream) {
    stream.setText(result.output.trim());
    stream.setActivity({ kind: 'writing', label: 'Respuesta lista' });
    await stream.flush();
    if (stream.cancelled.aborted && !result.output.includes('_(Respuesta detenida)_')) {
      throw new Error('Cancelado por el usuario');
    }
  }
  const saveStarted = performance.now();
  await input.complete(result.output.trim(), result.session_id, result.action_request_ids);
  measurements.response_save_ms = Math.round(performance.now() - saveStarted);
  await input.onMeasurements?.(measurements);
  if (memoryTurn && input.onMemoryTurn) {
    memoryTurn.output = result.output.trim();
    input.onMemoryTurn(memoryTurn);
  }
}
