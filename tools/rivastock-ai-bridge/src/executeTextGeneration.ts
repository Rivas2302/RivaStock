import type { KnowledgeClient, KnowledgeRetrievedSource } from './knowledge/client.ts';
import { buildKnowledgeContext, retrieveForJob, type RetrievalDependencies } from './knowledge/retrieval.ts';
import { buildMemoryContext, retrieveMemory, type MemoryRetrievalDependencies } from './memory/retrieve.ts';
import { hasExplicitMemoryCommand, isMemoryForgetCommand, isMemoryUpdateCommand, shouldSkipMemoryPrefilter } from './memory/filters.ts';
import type { MemoryQueueEntry } from './memory/queue.ts';
import { embedQuery } from './knowledge/embed.ts';
import { buildChatHistoryContext, referencesChatHistory } from './memory/chatHistory.ts';
import type { AIJobContext, AIProjectContext, AIProvider, AIProviderOptions, AIWorkspaceFile } from './types.ts';
import { createBusinessContext, createCombinedContext } from './workspace.ts';

export interface ExecuteTextGenerationInput {
  job: { id: string; input: string };
  provider: AIProvider;
  signal: AbortSignal;
  jobContext: AIJobContext;
  workspaceFiles: AIWorkspaceFile[];
  projectFiles: AIProjectContext[];
  knowledgeClient: Pick<KnowledgeClient, 'retrieve'> | null;
  workerId: string | null;
  knowledgeEnabled: boolean;
  providerOptions: AIProviderOptions;
  complete: (output: string, sessionId?: string) => Promise<void>;
  log: (message: string) => void;
  retrievalDependencies?: Partial<RetrievalDependencies>;
  memoryClient?: Pick<KnowledgeClient, 'memoryRetrieve'> & Partial<Pick<KnowledgeClient, 'memoryChatIndex'>> | null;
  memoryWorkerId?: string | null;
  onMemoryTurn?: (entry: MemoryQueueEntry) => void;
  onContextReady?: () => void | Promise<void>;
  memoryRetrievalDependencies?: Partial<MemoryRetrievalDependencies>;
}

export async function executeTextGeneration(input: ExecuteTextGenerationInput): Promise<void> {
  const businessFiles = createBusinessContext(input.jobContext);
  const injectedEmbed = input.memoryRetrievalDependencies?.embed ?? input.retrievalDependencies?.embed ?? embedQuery;
  const requestedQuery = input.job.input.slice(0, 2000);
  let queryEmbedding: Promise<number[]> | null = null;
  const embedQueryOnce = (query: string): Promise<number[]> => {
    if (query !== requestedQuery) return injectedEmbed(query);
    queryEmbedding ??= injectedEmbed(query);
    return queryEmbedding;
  };
  let memoryContext = '';
  let chatHistoryContext = '';
  let memoryTurn: MemoryQueueEntry | null = null;
  let memoryResponseGuidance: AIProviderOptions['memory_response_guidance'];
  if (input.memoryClient && input.memoryWorkerId) {
    const memories = await retrieveMemory(input.memoryClient, input.memoryWorkerId, input.job.id,
      input.job.input, { log: input.log, ...input.memoryRetrievalDependencies, embed: embedQueryOnce });
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
          chatHistoryContext = buildChatHistoryContext(
            await input.memoryClient.memoryChatIndex(input.memoryWorkerId, input.job.id),
          );
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
    sources = await retrieveForJob(input.knowledgeClient, input.workerId, input.job, {
      log: input.log,
      ...input.retrievalDependencies,
      embed: embedQueryOnce,
    });
  }
  input.log(`Tarea ${input.job.id}: ${sources.length} fuentes de Conocimientos.`);
  await input.onContextReady?.();
  const stream = input.providerOptions.stream;
  if (stream) stream.setActivity({ kind: 'thinking', label: 'Pensando…' });
  const generationSignal = stream
    ? AbortSignal.any([input.signal, stream.cancelled])
    : input.signal;
  const result = await input.provider.execute(input.job.input, generationSignal,
    createCombinedContext(input.workspaceFiles, input.projectFiles, businessFiles,
      [chatHistoryContext, memoryContext, buildKnowledgeContext(sources)].filter(Boolean).join('\n\n')),
    { ...input.providerOptions, ...(memoryResponseGuidance ? { memory_response_guidance: memoryResponseGuidance } : {}) });
  if (typeof result.output !== 'string' || result.output.trim().length === 0 || result.output.length > 20_000) {
    throw new Error('El proveedor devolvió una respuesta vacía o demasiado extensa.');
  }
  if (input.signal.aborted) throw new Error('La tarea fue interrumpida antes de completarse.');
  if (stream) {
    stream.setText(result.output.trim());
    stream.setActivity({ kind: 'writing', label: 'Respuesta lista' });
    await stream.flush();
    if (stream.cancelled.aborted && !result.output.includes('_(Respuesta detenida)_')) {
      throw new Error('Cancelado por el usuario');
    }
  }
  await input.complete(result.output.trim(), result.session_id);
  if (memoryTurn && input.onMemoryTurn) {
    memoryTurn.output = result.output.trim();
    input.onMemoryTurn(memoryTurn);
  }
}
