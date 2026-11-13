import { describe, expect, it, vi } from 'vitest';
import { handleClientRuntimeDiagnostics } from './clientRuntimeDiagnostics';

const origin = 'https://rivastock.vercel.app';
const validEvent = {
  event: 'lazy_chunk_failure',
  moduleId: 'src/pages/PublicCatalog.tsx',
  clientBuildId: 'build-123-deploy-abc',
  currentBuildId: 'build-456-deploy-def',
  recovered: true,
  failureKind: 'network',
};

function request(body: unknown, requestOrigin = origin): Request {
  return new Request('https://project.example/functions/v1/client-runtime-diagnostics', {
    method: 'POST',
    headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('client runtime diagnostic endpoint', () => {
  it('accepts a small, anonymous chunk event and logs no URL or personal fields', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await handleClientRuntimeDiagnostics(request(validEvent));

    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ recorded: true });
    expect(log).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(log.mock.calls[0][0])) as Record<string, unknown>;
    expect(entry).toEqual({
      event: 'lazy_chunk_failure',
      module_id: 'src/pages/PublicCatalog.tsx',
      client_build: 'build-123-deploy-abc',
      current_build: 'build-456-deploy-def',
      recovered: true,
      failure_kind: 'network',
    });
    expect(JSON.stringify(entry)).not.toMatch(/https?:|email|token|cookie|account|user/i);
    log.mockRestore();
  });

  it('rejects unknown origins, additional fields, and oversized events', async () => {
    expect((await handleClientRuntimeDiagnostics(request(validEvent, 'https://attacker.example'))).status).toBe(403);
    expect((await handleClientRuntimeDiagnostics(request({ ...validEvent, url: 'https://private.example/chunk.js' }))).status).toBe(400);
    const largeRequest = new Request('https://project.example/functions/v1/client-runtime-diagnostics', {
      method: 'POST', headers: { Origin: origin, 'Content-Length': '3000' }, body: JSON.stringify(validEvent),
    });
    expect((await handleClientRuntimeDiagnostics(largeRequest)).status).toBe(413);
  });
});
