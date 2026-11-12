import { describe, expect, it } from 'vitest';
import { pendingAIJobMessage } from './aiBridgeStatus';

describe('pending AI job message', () => {
  it('shows the queued message while the device is online or status is still loading', () => {
    expect(pendingAIJobMessage('idle')).toBe('En cola, tu PC lo toma en un instante…');
    expect(pendingAIJobMessage('busy')).toBe('En cola, tu PC lo toma en un instante…');
    expect(pendingAIJobMessage(null)).toBe('En cola, tu PC lo toma en un instante…');
  });

  it('shows the connection message only after the heartbeat has expired', () => {
    expect(pendingAIJobMessage('offline')).toBe('Esperando a que el AI Bridge se conecte.');
  });
});
