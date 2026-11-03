import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertStorageUploadAllowed, StorageUploadDeniedError } from './platformStorage';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc } }));

describe('assertStorageUploadAllowed', () => {
  beforeEach(() => rpc.mockReset());

  it('checks the bucket and byte total before upload', async () => {
    rpc.mockResolvedValue({ data: { allowed: true }, error: null });

    await expect(assertStorageUploadAllowed('assets', 2048)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('storage_upload_check', {
      p_bucket: 'assets',
      p_bytes: 2048,
    });
  });

  it.each([
    ['project_storage_full', 'No hay espacio en la nube de RivaStock. Avisá a RivaTech.'],
    ['suspended', 'La cuenta del negocio está suspendida.'],
  ] as const)('returns the exact user message for %s', async (reason, message) => {
    rpc.mockResolvedValue({ data: { allowed: false, reason }, error: null });

    await expect(assertStorageUploadAllowed('assets', 10)).rejects.toMatchObject({
      name: 'StorageUploadDeniedError',
      reason,
      message,
    });
  });

  it('fails closed on an unknown response or RPC error', async () => {
    rpc.mockResolvedValueOnce({ data: { allowed: false, reason: 'unknown' }, error: null });
    await expect(assertStorageUploadAllowed('assets', 10)).rejects.toThrow('No se pudo validar el espacio de almacenamiento.');

    rpc.mockResolvedValueOnce({ data: null, error: new Error('network down') });
    await expect(assertStorageUploadAllowed('assets', 10)).rejects.toThrow('network down');
  });

  it('rejects invalid sizes before calling the RPC', async () => {
    await expect(assertStorageUploadAllowed('assets', Number.NaN)).rejects.toThrow('Invalid upload size.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('exposes a typed denial for UI handling', () => {
    const denied = new StorageUploadDeniedError('suspended');
    expect(denied.message).toBe('La cuenta del negocio está suspendida.');
  });
});
