import { describe, expect, it, vi } from 'vitest';
import { createAccountPurgeHandler, type AccountPurgeBackend } from '../../supabase/functions/_shared/accountPurgeHandler';

function createBackend(overrides: Partial<AccountPurgeBackend> = {}): AccountPurgeBackend {
  return {
    authorize: vi.fn().mockResolvedValue(true),
    claimDue: vi.fn().mockResolvedValue(['owner-1']),
    listStorage: vi.fn().mockResolvedValueOnce([{ bucket_id: 'assets', object_name: 'owner-1/file.webp' }]).mockResolvedValue([]),
    removeStorage: vi.fn().mockResolvedValue(undefined),
    purgeDatabase: vi.fn().mockResolvedValue(undefined),
    deleteAuthUser: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function request(token = 'cron-token') {
  return new Request('https://project.example/functions/v1/account-purge', {
    method: 'POST',
    headers: token ? { 'x-riva-cron-token': token } : {},
    body: '{}',
  });
}

describe('scheduled business account purge', () => {
  it('requires the private cron token before claiming any accounts', async () => {
    const backend = createBackend({ authorize: vi.fn().mockResolvedValue(false) });
    const response = await createAccountPurgeHandler(backend)(request('wrong'));
    expect(response.status).toBe(401);
    expect(backend.claimDue).not.toHaveBeenCalled();
  });

  it('removes storage in API-sized batches before deleting the Auth user', async () => {
    const objects = Array.from({ length: 1_001 }, (_, index) => ({ bucket_id: 'assets', object_name: `owner-1/${index}.webp` }));
    const backend = createBackend({ listStorage: vi.fn().mockResolvedValueOnce(objects).mockResolvedValue([]) });
    const response = await createAccountPurgeHandler(backend)(request());
    const body = await response.json();

    expect(body).toEqual({ processed: 1, deleted: 1, failed: 0 });
    expect(backend.removeStorage).toHaveBeenNthCalledWith(1, 'assets', expect.any(Array));
    expect((backend.removeStorage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1].length)).toEqual([1_000, 1]);
    expect(backend.deleteAuthUser).toHaveBeenCalledWith('owner-1');
    expect(backend.listStorage).toHaveBeenCalledTimes(2);
    expect(backend.purgeDatabase).toHaveBeenCalledWith('owner-1');
    expect(backend.recordFailure).not.toHaveBeenCalled();
  });

  it('rechecks the first Storage page after each removal so pagination cannot skip remaining objects', async () => {
    const page = [{ bucket_id: 'assets', object_name: 'owner-1/a.webp' }];
    const backend = createBackend({ listStorage: vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce(page).mockResolvedValueOnce([]) });
    const response = await createAccountPurgeHandler(backend)(request());

    expect(await response.json()).toEqual({ processed: 1, deleted: 1, failed: 0 });
    expect(backend.removeStorage).toHaveBeenCalledTimes(2);
    expect(backend.listStorage).toHaveBeenCalledTimes(3);
  });

  it('keeps the Auth account when Storage cleanup fails and records a retryable error code', async () => {
    const backend = createBackend({ removeStorage: vi.fn().mockRejectedValue(new Error('private storage detail')) });
    const response = await createAccountPurgeHandler(backend)(request());

    expect(await response.json()).toEqual({ processed: 1, deleted: 0, failed: 1 });
    expect(backend.deleteAuthUser).not.toHaveBeenCalled();
    expect(backend.recordFailure).toHaveBeenCalledWith('owner-1', 'storage_cleanup_failed');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('records Auth deletion failures without exposing internal error details', async () => {
    const backend = createBackend({ deleteAuthUser: vi.fn().mockRejectedValue(new Error('private Auth detail')) });
    const response = await createAccountPurgeHandler(backend)(request());

    expect(await response.json()).toEqual({ processed: 1, deleted: 0, failed: 1 });
    expect(backend.recordFailure).toHaveBeenCalledWith('owner-1', 'auth_delete_failed');
  });

  it('does not delete Auth if a tenant row cannot be purged', async () => {
    const backend = createBackend({ purgeDatabase: vi.fn().mockRejectedValue(new Error('private database detail')) });
    const response = await createAccountPurgeHandler(backend)(request());

    expect(await response.json()).toEqual({ processed: 1, deleted: 0, failed: 1 });
    expect(backend.deleteAuthUser).not.toHaveBeenCalled();
    expect(backend.recordFailure).toHaveBeenCalledWith('owner-1', 'database_cleanup_failed');
  });
});
