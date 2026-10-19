import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AIProviderId = 'mock' | 'codex' | 'claude';

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
  task_type: 'text_generation';
  input: string;
  attempt_count: number;
  created_at: string;
}

export interface AIProvider {
  execute(input: string, signal: AbortSignal, workspaceContext?: string): Promise<{ output: string }>;
}

export interface BridgeConfig {
  endpoint: string;
  token: string;
  codexEnabled: boolean;
  claudeEnabled: boolean;
  codexExecutable: string;
  codexHome: string;
  claudeExecutable: string;
  claudeMaxBudgetUsd: string;
  workspaceDirectory: string;
  projectRootDirectory: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const endpoint = env.AI_BRIDGE_ENDPOINT?.trim() ?? '';
  const token = env.AI_BRIDGE_TOKEN?.trim() ?? '';
  if (!/^https:\/\//i.test(endpoint)) throw new Error('AI_BRIDGE_ENDPOINT debe ser una URL HTTPS de Supabase.');
  if (token.length < 32) throw new Error('AI_BRIDGE_TOKEN debe tener al menos 32 caracteres.');
  return {
    endpoint: endpoint.replace(/\/$/, ''),
    token,
    codexEnabled: env.AI_BRIDGE_ENABLE_CODEX === 'true',
    claudeEnabled: env.AI_BRIDGE_ENABLE_CLAUDE === 'true',
    codexExecutable: env.CODEX_CLI_PATH?.trim() || '',
    codexHome: env.AI_BRIDGE_CODEX_HOME?.trim() || `${env.USERPROFILE || env.HOME || '.'}/.rivastock-ai-bridge/codex`,
    claudeExecutable: env.CLAUDE_CLI_PATH?.trim() || 'claude',
    claudeMaxBudgetUsd: parseBudget(env.AI_BRIDGE_CLAUDE_MAX_BUDGET_USD ?? '1.00'),
    workspaceDirectory: resolve(env.AI_BRIDGE_WORKSPACE_DIR?.trim()
      || resolve(dirname(fileURLToPath(import.meta.url)), '../../../.rivastock-ai/workspace')),
    projectRootDirectory: resolve(env.AI_BRIDGE_PROJECT_ROOT?.trim()
      || resolve(dirname(fileURLToPath(import.meta.url)), '../../../')),
  };
}

function parseBudget(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 20) {
    throw new Error('AI_BRIDGE_CLAUDE_MAX_BUDGET_USD debe ser un número mayor a 0 y no superior a 20.');
  }
  return amount.toFixed(2);
}
