import { createHash } from 'node:crypto';
import type { KnowledgeClient } from '../knowledge/client.ts';
import { CentralStore, type CentralManifestEntry } from './store.ts';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export async function transferCentralBatch(options: {
  client: KnowledgeClient;
  workerId: string;
  store: CentralStore;
  log: (message: string) => void;
}): Promise<number> {
  const files = await options.client.centralNext(options.workerId);
  let storedCount = 0;
  for (const file of files) {
    try {
      if (file.file_size > MAX_FILE_BYTES || !file.url.startsWith('https://')) {
        throw new Error('El archivo de la central excede el límite permitido o usa una URL insegura.');
      }
      const bytes = await download(file.url, file.file_size);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash.toLowerCase() !== file.sha256.toLowerCase()) {
        await options.client.centralStored(options.workerId, file.version_id, hash);
        throw new Error('La huella SHA-256 descargada no coincide con la versión registrada.');
      }
      await options.store.write(file.relative_path, bytes, file.sha256);
      const stored = await options.client.centralStored(options.workerId, file.version_id, hash);
      if (!stored.stored) throw new Error('El backend rechazó la huella del original.');
      const fileStat = await options.store.statLocal(file.relative_path);
      if (fileStat) {
        const manifest = await options.store.readManifest();
        manifest[file.relative_path] = { ...fileStat, sha256: hash } satisfies CentralManifestEntry;
        await options.store.writeManifest(manifest);
      }
      storedCount += 1;
      options.log(`Original ${file.version_id} guardado en la central${options.store.mirrorDirectory ? ' y su respaldo' : ''}.`);
    } catch (error) {
      options.log(`No se pudo transferir ${file.version_id}: ${error instanceof Error ? error.message : 'error de transferencia'}`);
    }
  }
  return storedCount;
}

async function download(url: string, expectedSize: number): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' });
  if (!response.ok) throw new Error('No se pudo descargar el original desde la nube.');
  const length = Number(response.headers.get('content-length'));
  if ((Number.isFinite(length) && length > MAX_FILE_BYTES) || (Number.isFinite(length) && length !== expectedSize)) {
    await response.body?.cancel();
    throw new Error('El tamaño del original descargado no coincide con el registrado.');
  }
  if (!response.body) throw new Error('La respuesta de Storage no tiene contenido.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FILE_BYTES || total > expectedSize) {
      await reader.cancel();
      throw new Error('El archivo descargado supera el tamaño registrado.');
    }
    chunks.push(value);
  }
  if (total !== expectedSize) throw new Error('El archivo descargado tiene un tamaño incompleto.');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
