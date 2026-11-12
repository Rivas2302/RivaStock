import type { AIChatToolCall, AIProviderId } from './aiBridge';

export function shouldShowAIChatKnowledgeSources(
  provider: AIProviderId | undefined,
  calls: AIChatToolCall[] | undefined,
): boolean {
  return provider !== 'codex' || Boolean(calls?.some((call) => call.tool === 'conocimiento_buscar' && call.ok));
}
