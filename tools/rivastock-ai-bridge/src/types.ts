import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StreamReporter } from './streamReporter.ts';

export type AIProviderId = 'mock' | 'codex' | 'claude';
export type CodexModelId = 'gpt-6-luna' | 'gpt-6.1-sol' | 'gpt-6-astra';
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export interface CodexSecuritySettings {
  codex_sandbox: CodexSandboxMode;
  allow_project_root: boolean;
}
export const DEFAULT_CODEX_SECURITY: CodexSecuritySettings = {
  codex_sandbox: 'read-only',
  allow_project_root: false,
};

export interface AIProviderOptions {
  model_id?: string;
  reasoning_effort?: CodexReasoningEffort;
  chat_id?: string | null;
  session_id?: string | null;
  images?: Array<{ id: string; path: string }>;
  safe_text_only?: boolean;
  codex_security?: CodexSecuritySettings;
  memory_response_guidance?: 'remember-auto' | 'remember-confirm' | 'update-auto' | 'update-confirm' | 'forget-auto' | 'forget-confirm' | 'disabled';
  stream?: StreamReporter;
  plain_text?: boolean;
  assistant?: { business_card: string; agent_instructions?: string };
}

export interface AIWorkspaceFile {
  path: string;
  content: string;
  updated_at: string;
}

export interface AIProjectContext {
  path: string;
  content: string;
  updated_at: string;
}

export interface AIJobContext {
  include_business_context: boolean;
  include_project_context: boolean;
  model_id: CodexModelId | null;
  reasoning_effort: CodexReasoningEffort | null;
  chat_id?: string | null;
  provider_session_id?: string | null;
  business?: {
    business_name?: string;
    owner_display_name?: string;
    plan?: string;
    modules?: string[];
    counts?: Record<string, number>;
    catalog?: { public_url?: string; has_reseller_mode?: boolean };
    currency_symbol?: string;
    timezone?: string;
    now_local?: string;
  } | null;
  products: Array<{
    name: string;
    category: string;
    description: string | null;
    purchase_price: number | string;
    sale_price: number | string;
    stock: number;
    min_stock: number;
  }>;
  total_products: number;
}

export interface AIJob {
  id: string;
  provider: AIProviderId;
  task_type: 'text_generation' | 'knowledge_organize' | 'fb_copywriting' | 'fb_photo_review';
  input: string;
  model_id?: CodexModelId | null;
  reasoning_effort?: CodexReasoningEffort | null;
  chat_id?: string | null;
  attempt_count: number;
  created_at: string;
}

export interface AIProvider {
  execute(input: string, signal: AbortSignal, workspaceContext?: string, options?: AIProviderOptions): Promise<{
    output: string;
    session_id?: string;
    imageInputUnavailable?: boolean;
  }>;
}

export interface BridgeConfig {
  endpoint: string;
  automationEndpoint: string | null;
  knowledgeEndpoint: string | null;
  token: string;
  fbSupervisorEnabled: boolean;
  knowledgeEnabled: boolean;
  modelsDirectory: string;
  centralStoreDirectory: string;
  centralMirrorDirectory: string | null;
  ocrEnabled: boolean;
  codexEnabled: boolean;
  claudeEnabled: boolean;
  codexExecutable: string;
  codexHome: string;
  sessionDirectory: string;
  workerId: string | null;
  claudeExecutable: string;
  claudeMaxBudgetUsd: string;
  workspaceDirectory: string;
  projectRootDirectory: string;
  localLlmUrl: string | null;
  localLlmModel: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const endpoint = env.AI_BRIDGE_ENDPOINT?.trim() ?? '';
  const token = env.AI_BRIDGE_TOKEN?.trim() ?? '';
  const workerId = env.AI_BRIDGE_WORKER_ID?.trim() || null;
  const userDirectory = env.USERPROFILE || env.HOME || '.';
  if (!/^https:\/\//i.test(endpoint)) throw new Error('AI_BRIDGE_ENDPOINT debe ser una URL HTTPS de Supabase.');
  if (token.length < 32) throw new Error('AI_BRIDGE_TOKEN debe tener al menos 32 caracteres.');
  if (workerId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workerId)) {
    throw new Error('AI_BRIDGE_WORKER_ID debe ser el identificador UUID que muestra RivaStock.');
  }
  const normalizedEndpoint = endpoint.replace(/\/$/, '');
  const knowledgeEndpoint = normalizedEndpoint.endsWith('/functions/v1/ai-bridge')
    ? normalizedEndpoint.replace(/\/functions\/v1\/ai-bridge$/, '/functions/v1/knowledge')
    : null;
  const automationEndpoint = normalizedEndpoint.endsWith('/functions/v1/ai-bridge')
    ? normalizedEndpoint.replace(/\/functions\/v1\/ai-bridge$/, '/functions/v1/automation')
    : null;
  return {
    endpoint: normalizedEndpoint,
    automationEndpoint,
    knowledgeEndpoint,
    token,
    fbSupervisorEnabled: env.AI_BRIDGE_ENABLE_FB_SUPERVISOR !== 'false',
    knowledgeEnabled: env.AI_BRIDGE_ENABLE_KNOWLEDGE !== 'false',
    modelsDirectory: resolve(env.AI_BRIDGE_MODELS_DIR?.trim()
      || join(userDirectory, '.rivastock-ai-bridge', 'models')),
    centralStoreDirectory: resolve(env.AI_BRIDGE_STORE_DIR?.trim()
      || join(userDirectory, 'RivaStock Central', 'Conocimientos')),
    centralMirrorDirectory: env.AI_BRIDGE_MIRROR_DIR?.trim()
      ? resolve(env.AI_BRIDGE_MIRROR_DIR.trim()) : null,
    ocrEnabled: env.AI_BRIDGE_ENABLE_OCR !== 'false',
    codexEnabled: env.AI_BRIDGE_ENABLE_CODEX === 'true',
    claudeEnabled: env.AI_BRIDGE_ENABLE_CLAUDE === 'true',
    codexExecutable: env.CODEX_CLI_PATH?.trim() || '',
    codexHome: env.AI_BRIDGE_CODEX_HOME?.trim() || `${env.USERPROFILE || env.HOME || '.'}/.rivastock-ai-bridge/codex`,
    sessionDirectory: resolve(env.AI_BRIDGE_SESSION_DIR?.trim()
      || join(userDirectory, '.rivastock-ai-bridge', 'sessions')),
    workerId,
    claudeExecutable: env.CLAUDE_CLI_PATH?.trim() || 'claude',
    claudeMaxBudgetUsd: parseBudget(env.AI_BRIDGE_CLAUDE_MAX_BUDGET_USD ?? '1.00'),
    workspaceDirectory: resolve(env.AI_BRIDGE_WORKSPACE_DIR?.trim()
      || resolve(dirname(fileURLToPath(import.meta.url)), '../../../.rivastock-ai/workspace')),
    projectRootDirectory: resolve(env.AI_BRIDGE_PROJECT_ROOT?.trim()
      || resolve(dirname(fileURLToPath(import.meta.url)), '../../../')),
    localLlmUrl: env.AI_BRIDGE_LOCAL_LLM_URL?.trim() || null,
    localLlmModel: env.AI_BRIDGE_LOCAL_LLM_MODEL?.trim() || null,
  };
}

function parseBudget(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 20) {
    throw new Error('AI_BRIDGE_CLAUDE_MAX_BUDGET_USD debe ser un número mayor a 0 y no superior a 20.');
  }
  return amount.toFixed(2);
}
