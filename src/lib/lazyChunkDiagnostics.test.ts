import { describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }));
import { reportLazyChunkFailure, sanitizeLazyChunkDiagnostic } from './lazyChunkDiagnostics';

describe('lazy chunk diagnostics', () => {
  it('keeps only the module key, client/current builds, recovery result, and failure category', () => {
    const value = sanitizeLazyChunkDiagnostic({
      moduleId: 'src/pages/Stock.tsx',
      clientBuildId: 'abc123-deploy456',
      currentBuildId: 'def456-deploy789',
      recovered: true,
      failureKind: 'network',
    });
    expect(value).toEqual({ moduleId: 'src/pages/Stock.tsx', clientBuildId: 'abc123-deploy456', currentBuildId: 'def456-deploy789', recovered: true, failureKind: 'network' });
    expect(JSON.stringify(value)).not.toMatch(/https?:|email|user|token|cookie/i);
  });

  it('rejects unexpected path or build values before sending a bounded diagnostic', async () => {
    await reportLazyChunkFailure({
      moduleId: 'https://example.test/private?email=owner@example.test',
      clientBuildId: 'bad build id',
      currentBuildId: null,
      recovered: false,
      failureKind: 'offline',
    });
    expect(invoke).toHaveBeenCalledWith('client-runtime-diagnostics', {
      body: { event: 'lazy_chunk_failure', moduleId: 'unknown', clientBuildId: 'unknown', currentBuildId: null, recovered: false, failureKind: 'offline' },
    });
  });
});
