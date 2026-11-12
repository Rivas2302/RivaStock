import type { AIBridgeState } from './aiBridge';

export function pendingAIJobMessage(state: AIBridgeState | null): string {
  return state === 'offline'
    ? 'Esperando a que el AI Bridge se conecte.'
    : 'En cola, tu PC lo toma en un instante…';
}
