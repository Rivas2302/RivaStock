import type { KnowledgeClient, KnowledgeRetrievedSource } from './knowledge/client.ts';
import { buildKnowledgeContext, retrieveForJob, type RetrievalDependencies } from './knowledge/retrieval.ts';
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
}

export async function executeTextGeneration(input: ExecuteTextGenerationInput): Promise<void> {
  const businessFiles = createBusinessContext(input.jobContext);
  let sources: KnowledgeRetrievedSource[] = [];
  if (input.knowledgeEnabled && input.workerId && input.knowledgeClient) {
    sources = await retrieveForJob(input.knowledgeClient, input.workerId, input.job, {
      log: input.log,
      ...input.retrievalDependencies,
    });
  }
  input.log(`Tarea ${input.job.id}: ${sources.length} fuentes de Conocimientos.`);
  const result = await input.provider.execute(input.job.input, input.signal,
    createCombinedContext(input.workspaceFiles, input.projectFiles, businessFiles, buildKnowledgeContext(sources)),
    input.providerOptions);
  if (typeof result.output !== 'string' || result.output.trim().length === 0 || result.output.length > 20_000) {
    throw new Error('El proveedor devolvió una respuesta vacía o demasiado extensa.');
  }
  if (input.signal.aborted) throw new Error('La tarea fue interrumpida antes de completarse.');
  await input.complete(result.output.trim(), result.session_id);
}
