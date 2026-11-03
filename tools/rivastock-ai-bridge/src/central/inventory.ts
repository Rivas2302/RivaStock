import { statfs } from 'node:fs/promises';
import type { CentralExpectedFile, CentralInventoryEntry, KnowledgeClient } from '../knowledge/client.ts';
import { CentralStore, hashFile, type CentralManifestEntry } from './store.ts';

const PAGE_SIZE = 1000;
const REPORT_BATCH_SIZE = 400;
const HASH_BYTES_PER_CYCLE = 200 * 1024 * 1024;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface CentralInventoryClient extends Pick<KnowledgeClient, 'centralExpected' | 'centralInventory' | 'centralStatus'> {}

export interface CentralHashState {
  lastFullHashAt: number;
  offset: number;
}

export interface CentralInventorySummary {
  files: CentralExpectedFile[];
  storeBytes: number;
  freeBytes: number | null;
  localFiles: number;
  missingFiles: number;
  mirrorStatus: 'none' | 'ok' | 'error';
  mirrorLastOkAt: string | null;
}

export async function inventoryCentral(options: {
  client: CentralInventoryClient;
  workerId: string;
  store: CentralStore;
  log: (message: string) => void;
}): Promise<CentralInventorySummary> {
  const expected: CentralExpectedFile[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await options.client.centralExpected(options.workerId, offset, PAGE_SIZE);
    expected.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const manifest = await options.store.readManifest();
  const currentManifest: Record<string, CentralManifestEntry> = {};
  const inventory: CentralInventoryEntry[] = [];
  let storeBytes = 0;
  let localFiles = 0;
  let missingFiles = 0;
  let mirrorFailure = false;

  for (const file of expected) {
    if (file.storage_location === 'transferring') continue;
    let local = await options.store.statLocal(file.relative_path);
    if (!local || local.size !== file.file_size) {
      await options.store.readVerified(file.relative_path, file.sha256).catch(() => null);
      local = await options.store.statLocal(file.relative_path);
    }
    if (!local || local.size !== file.file_size) {
      inventory.push({ version_id: file.version_id, sha256: null, present: false });
      if (file.cloud_purged) missingFiles += 1;
      continue;
    }

    storeBytes += local.size;
    localFiles += 1;
    const previous = manifest[file.relative_path];
    const cachedHash = previous && previous.size === local.size && previous.mtimeMs === local.mtimeMs
      && previous.sha256.toLowerCase() === file.sha256.toLowerCase() ? previous.sha256 : null;
    if (cachedHash) currentManifest[file.relative_path] = { ...local, sha256: cachedHash };
    inventory.push({ version_id: file.version_id, sha256: cachedHash, present: true });

    if (options.store.mirrorDirectory) {
      const mirror = await options.store.statMirror(file.relative_path);
      if (!mirror || mirror.size !== file.file_size) mirrorFailure = true;
    }
  }

  for (let offset = 0; offset < inventory.length; offset += REPORT_BATCH_SIZE) {
    await options.client.centralInventory(options.workerId, inventory.slice(offset, offset + REPORT_BATCH_SIZE));
  }
  await options.store.writeManifest(currentManifest);

  let freeBytes: number | null = null;
  try {
    const capacity = await statfs(options.store.storeDirectory);
    freeBytes = Math.max(0, Math.floor(capacity.bavail * capacity.bsize));
  } catch (error) {
    options.log(`No se pudo medir el espacio libre de la central: ${error instanceof Error ? error.message : 'error del sistema'}`);
  }
  const mirrorStatus = options.store.mirrorDirectory ? (mirrorFailure ? 'error' : 'ok') : 'none';
  const mirrorLastOkAt = mirrorStatus === 'ok' ? new Date().toISOString() : null;
  const summary = { files: expected, storeBytes, freeBytes, localFiles, missingFiles, mirrorStatus, mirrorLastOkAt } as const;
  await options.client.centralStatus(options.workerId, {
    store_bytes: storeBytes,
    store_free_bytes: freeBytes,
    mirror_status: mirrorStatus,
    mirror_last_ok_at: mirrorLastOkAt,
    files_total: localFiles,
    files_missing: missingFiles,
  });
  return summary;
}

export async function hashCentralBatch(options: {
  client: CentralInventoryClient;
  workerId: string;
  store: CentralStore;
  state: CentralHashState;
  now?: number;
  log: (message: string) => void;
}): Promise<{ state: CentralHashState; finished: boolean; hashedBytes: number }> {
  const now = options.now ?? Date.now();
  if (options.state.offset === 0 && now - options.state.lastFullHashAt < WEEK_MS) {
    return { state: options.state, finished: true, hashedBytes: 0 };
  }

  let offset = options.state.offset;
  let hashedBytes = 0;
  const inventory: CentralInventoryEntry[] = [];
  while (hashedBytes < HASH_BYTES_PER_CYCLE) {
    const pageOffset = Math.floor(offset / PAGE_SIZE) * PAGE_SIZE;
    const page = await options.client.centralExpected(options.workerId, pageOffset, PAGE_SIZE);
    if (offset >= pageOffset + page.length) {
      const nextState = { lastFullHashAt: now, offset: 0 };
      await reportInventory(options.client, options.workerId, inventory);
      return { state: nextState, finished: true, hashedBytes };
    }
    if (!page.length) {
      const nextState = { lastFullHashAt: now, offset: 0 };
      await reportInventory(options.client, options.workerId, inventory);
      return { state: nextState, finished: true, hashedBytes };
    }

    for (const file of page.slice(offset - pageOffset)) {
      if (file.storage_location === 'transferring') {
        offset += 1;
        continue;
      }
      if (hashedBytes > 0 && hashedBytes + file.file_size > HASH_BYTES_PER_CYCLE) break;
      let local = await options.store.statLocal(file.relative_path);
      if (!local || local.size !== file.file_size) {
        await options.store.readVerified(file.relative_path, file.sha256).catch(() => null);
        local = await options.store.statLocal(file.relative_path);
      }
      if (!local || local.size !== file.file_size) {
        inventory.push({ version_id: file.version_id, sha256: null, present: false });
      } else {
        const hash = await hashFile(options.store.resolveLocal(file.relative_path));
        hashedBytes += local.size;
        inventory.push({ version_id: file.version_id, sha256: hash, present: true });
        if (hash.toLowerCase() !== file.sha256.toLowerCase()) {
          options.log(`La verificación semanal encontró una huella distinta en ${file.relative_path}.`);
        } else {
          const manifest = await options.store.readManifest();
          manifest[file.relative_path] = { ...local, sha256: hash };
          await options.store.writeManifest(manifest);
        }
      }
      offset += 1;
      if (inventory.length >= REPORT_BATCH_SIZE || hashedBytes >= HASH_BYTES_PER_CYCLE) {
        await reportInventory(options.client, options.workerId, inventory.splice(0));
      }
      if (hashedBytes >= HASH_BYTES_PER_CYCLE) break;
    }

    if (offset >= pageOffset + page.length) continue;
    break;
  }

  await reportInventory(options.client, options.workerId, inventory);
  return { state: { ...options.state, offset }, finished: false, hashedBytes };
}

async function reportInventory(client: CentralInventoryClient, workerId: string, entries: CentralInventoryEntry[]): Promise<void> {
  for (let offset = 0; offset < entries.length; offset += REPORT_BATCH_SIZE) {
    await client.centralInventory(workerId, entries.slice(offset, offset + REPORT_BATCH_SIZE));
  }
}
