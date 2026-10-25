import type { AIProviderId, CodexModelId, CodexReasoningEffort } from './aiBridge';

export const PROVIDERS: Array<{ id: AIProviderId; label: string }> = [
  { id: 'codex', label: 'Codex — Mi PC' },
  { id: 'claude', label: 'Claude Code — Mi PC' },
  { id: 'mock', label: 'Mock — prueba de conexión' },
];

export const CODEX_MODELS: Array<{ id: CodexModelId; label: string }> = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna — más eficiente' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol — tareas complejas' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra — máxima capacidad' },
];

export function providerLabel(provider: AIProviderId): string {
  return PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
}

export function modelLabel(modelId: string | null | undefined): string {
  return CODEX_MODELS.find((item) => item.id === modelId)?.label ?? modelId ?? 'Predeterminado';
}

export function reasoningLabel(effort: CodexReasoningEffort | null | undefined): string {
  return ({ low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto' })[effort ?? 'low'];
}
