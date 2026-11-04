export interface BusinessStorageObject {
  bucket_id: string;
  object_name: string;
}

export interface AccountPurgeBackend {
  authorize(token: string): Promise<boolean>;
  claimDue(): Promise<string[]>;
  listStorage(ownerUid: string): Promise<BusinessStorageObject[]>;
  removeStorage(bucketId: string, paths: string[]): Promise<void>;
  purgeDatabase(ownerUid: string): Promise<void>;
  deleteAuthUser(ownerUid: string): Promise<void>;
  recordFailure(ownerUid: string, code: 'storage_cleanup_failed' | 'database_cleanup_failed' | 'auth_delete_failed'): Promise<void>;
}

const SECRET_HEADER = 'x-riva-cron-token';
const STORAGE_BATCH_SIZE = 1_000;

export function createAccountPurgeHandler(backend: AccountPurgeBackend) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const token = request.headers.get(SECRET_HEADER);
    if (!token) return json({ error: 'unauthorized' }, 401);
    try {
      if (!await backend.authorize(token)) return json({ error: 'unauthorized' }, 401);
    } catch {
      return json({ error: 'unauthorized' }, 401);
    }

    let owners: string[];
    try { owners = await backend.claimDue(); }
    catch { return json({ error: 'purge_unavailable' }, 500); }

    let deleted = 0;
    let failed = 0;
    for (const ownerUid of owners) {
      try {
        let storageCleared = false;
        for (let page = 0; page < 10_000; page += 1) {
          const objects = await backend.listStorage(ownerUid);
          if (objects.length === 0) {
            storageCleared = true;
            break;
          }
          const grouped = new Map<string, string[]>();
          for (const object of objects) {
            if (!object.bucket_id || !object.object_name) continue;
            const paths = grouped.get(object.bucket_id) ?? [];
            paths.push(object.object_name);
            grouped.set(object.bucket_id, paths);
          }
          for (const [bucketId, paths] of grouped) {
            for (let offset = 0; offset < paths.length; offset += STORAGE_BATCH_SIZE) {
              await backend.removeStorage(bucketId, paths.slice(offset, offset + STORAGE_BATCH_SIZE));
            }
          }
        }
        if (!storageCleared) throw new Error('storage-page-limit-exceeded');
      } catch {
        await safeRecordFailure(backend, ownerUid, 'storage_cleanup_failed');
        failed += 1;
        continue;
      }

      try {
        await backend.purgeDatabase(ownerUid);
      } catch {
        await safeRecordFailure(backend, ownerUid, 'database_cleanup_failed');
        failed += 1;
        continue;
      }

      try {
        await backend.deleteAuthUser(ownerUid);
        deleted += 1;
      } catch {
        await safeRecordFailure(backend, ownerUid, 'auth_delete_failed');
        failed += 1;
      }
    }

    return json({ processed: owners.length, deleted, failed });
  };
}

async function safeRecordFailure(
  backend: AccountPurgeBackend,
  ownerUid: string,
  code: 'storage_cleanup_failed' | 'database_cleanup_failed' | 'auth_delete_failed',
) {
  try { await backend.recordFailure(ownerUid, code); } catch { /* Cron retries stale claims after 30 minutes. */ }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
