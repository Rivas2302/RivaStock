import { setTimeout as delay } from 'node:timers/promises';
import type { BridgeConfig } from '../types.ts';
import type { KnowledgeClient } from '../knowledge/client.ts';
import { hashCentralBatch, inventoryCentral } from './inventory.ts';
import { CentralStore } from './store.ts';
import { transferCentralBatch } from './transfer.ts';

const LOOP_INTERVAL_MS = 30_000;
const INVENTORY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATUS_INTERVAL_MS = 10 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export async function runKnowledgeCentralLoop(options: {
  client: KnowledgeClient;
  workerId: string;
  config: Pick<BridgeConfig, 'centralStoreDirectory' | 'centralMirrorDirectory'>;
  isStopping: () => boolean;
  log: (message: string) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}): Promise<void> {
  const sleep = options.sleep ?? ((milliseconds) => delay(milliseconds));
  const now = options.now ?? Date.now;
  const store = new CentralStore({
    storeDirectory: options.config.centralStoreDirectory,
    mirrorDirectory: options.config.centralMirrorDirectory,
  });
  await store.initialize();
  let hashState = await store.readHashState();
  let lastInventoryAt = 0;
  let lastStatusAt = 0;
  let lastPurgeAt = 0;

  while (!options.isStopping()) {
    try {
      const current = now();
      if (current - lastInventoryAt >= INVENTORY_INTERVAL_MS) {
        const summary = await inventoryCentral({ client: options.client, workerId: options.workerId, store, log: options.log });
        lastInventoryAt = current;
        lastStatusAt = current;
        options.log(`Inventario de la central: ${summary.localFiles} archivos, ${summary.storeBytes} bytes y ${summary.missingFiles} originales faltantes.`);
      }

      const hashed = await hashCentralBatch({
        client: options.client,
        workerId: options.workerId,
        store,
        state: hashState,
        now: current,
        log: options.log,
      });
      hashState = hashed.state;
      if (hashed.hashedBytes > 0 || hashed.finished) await store.writeHashState(hashState);

      if (current - lastPurgeAt >= PURGE_INTERVAL_MS) {
        const purged = await options.client.centralPurge(options.workerId);
        lastPurgeAt = current;
        if (purged) options.log(`Se liberaron ${purged} originales de la nube tras verificar la central.`);
      }

      const deletions = await options.client.centralDeletions(options.workerId);
      if (deletions.length) {
        const completed: string[] = [];
        for (const deletion of deletions) {
          try {
            await store.delete(deletion.relative_path);
            completed.push(deletion.id);
          } catch (error) {
            options.log(`No se pudo eliminar ${deletion.relative_path} de la central: ${error instanceof Error ? error.message : 'error del sistema'}`);
          }
        }
        if (completed.length) await options.client.centralDeletionsDone(options.workerId, completed);
      }

      await transferCentralBatch({ client: options.client, workerId: options.workerId, store, log: options.log });

      if (current - lastStatusAt >= STATUS_INTERVAL_MS) {
        const summary = await inventoryCentral({ client: options.client, workerId: options.workerId, store, log: options.log });
        lastStatusAt = current;
        options.log(`Estado de la central actualizado: ${summary.localFiles} archivos, ${summary.storeBytes} bytes.`);
      }
    } catch (error) {
      options.log(`Almacén de la central no disponible: ${error instanceof Error ? error.message : 'error del servicio'}`);
    }
    if (!options.isStopping()) await sleep(LOOP_INTERVAL_MS);
  }
}
