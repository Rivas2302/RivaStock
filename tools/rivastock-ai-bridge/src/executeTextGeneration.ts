import type { KnowledgeClient, KnowledgeRetrievedSource } from './knowledge/client.ts';
import { buildKnowledgeContext, retrieveForJob, type RetrievalDependencies } from './knowledge/retrieval.ts';
import { buildMemoryContext, retrieveMemory, type MemoryRetrievalDependencies } from './memory/retrieve.ts';
import { hasExplicitMemoryCommand, shouldSkipMemoryPrefilter } from './memory/filters.ts';
import type { MemoryQueueEntry } from './memory/queue.ts';
import { embedQuery } from './knowledge/embed.ts';
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
  memoryClient?: Pick<KnowledgeClient, 'memoryRetrieve'> | null;
  memoryWorkerId?: string | null;
  onMemoryTurn?: (entry: MemoryQueueEntry) => void;
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
  let memoryTurn: MemoryQueueEntry | null = null;
  if (input.memoryClient && input.memoryWorkerId) {
    const memories = await retrieveMemory(input.memoryClient, input.memoryWorkerId, input.job.id,
      input.job.input, { log: input.log, ...input.memoryRetrievalDependencies, embed: embedQueryOnce });
    if (memories?.enabled) {
      memoryContext = buildMemoryContext(memories.memories);
      const chatId = input.jobContext.chat_id;
      if (chatId && memories.mode !== 'off') {
        const explicitCommand = hasExplicitMemoryCommand(input.job.input);
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
  const result = await input.provider.execute(input.job.input, input.signal,
    createCombinedContext(input.workspaceFiles, input.projectFiles, businessFiles,
      [memoryContext, buildKnowledgeContext(sources)].filter(Boolean).join('\n\n')),
    input.providerOptions);
  if (typeof result.output !== 'string' || result.output.trim().length === 0 || result.output.length > 20_000) {
    throw new Error('El proveedor devolvió una respuesta vacía o demasiado extensa.');
  }
  if (input.signal.aborted) throw new Error('La tarea fue interrumpida antes de completarse.');
  await input.complete(result.output.trim(), result.session_id);
  if (memoryTurn && input.onMemoryTurn) {
    memoryTurn.output = result.output.trim();
    input.onMemoryTurn(memoryTurn);
  }
}
