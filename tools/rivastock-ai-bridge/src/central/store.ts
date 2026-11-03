import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const CENTRAL_PATH_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/v[0-9]{1,5}\/[A-Za-z0-9._-]{1,120}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;

export interface CentralStoreOptions {
  storeDirectory: string;
  mirrorDirectory: string | null;
}

export interface StoredFileStat {
  size: number;
  mtimeMs: number;
}

export interface CentralManifestEntry extends StoredFileStat {
  sha256: string;
}

export interface CentralHashState {
  lastFullHashAt: number;
  offset: number;
}

export class CentralStore {
  readonly storeDirectory: string;
  readonly mirrorDirectory: string | null;

  constructor(options: CentralStoreOptions) {
    this.storeDirectory = resolve(options.storeDirectory);
    this.mirrorDirectory = options.mirrorDirectory ? resolve(options.mirrorDirectory) : null;
    if (this.mirrorDirectory && (isInside(this.storeDirectory, this.mirrorDirectory)
      || isInside(this.mirrorDirectory, this.storeDirectory))) {
      throw new Error('La carpeta de respaldo no puede estar dentro del almacén central.');
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.storeDirectory, { recursive: true });
    const rootInfo = await lstat(this.storeDirectory);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('La carpeta del almacén central no es segura.');
    await assertDirectoryChain(this.storeDirectory, this.storeDirectory);
    if (this.mirrorDirectory) {
      await mkdir(this.mirrorDirectory, { recursive: true });
      const mirrorInfo = await lstat(this.mirrorDirectory);
      if (mirrorInfo.isSymbolicLink() || !mirrorInfo.isDirectory()) throw new Error('La carpeta de respaldo no es segura.');
      await assertDirectoryChain(this.mirrorDirectory, this.mirrorDirectory);
    }
  }

  async readManifest(): Promise<Record<string, CentralManifestEntry>> {
    const path = join(this.storeDirectory, '.rivastock-central-manifest.json');
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 20 * 1024 * 1024) return {};
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
        if (!isValidCentralPath(key) || !value || typeof value !== 'object') return [];
        const entry = value as Partial<CentralManifestEntry>;
        if (!Number.isFinite(entry.size) || !Number.isFinite(entry.mtimeMs)
          || typeof entry.sha256 !== 'string' || !HASH_PATTERN.test(entry.sha256)) return [];
        return [[key, { size: entry.size as number, mtimeMs: entry.mtimeMs as number, sha256: entry.sha256 }]];
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  }

  async writeManifest(manifest: Record<string, CentralManifestEntry>): Promise<void> {
    const path = join(this.storeDirectory, '.rivastock-central-manifest.json');
    await writeAtomic(this.storeDirectory, path, Buffer.from(JSON.stringify(manifest), 'utf8'));
  }

  async readHashState(): Promise<CentralHashState> {
    const path = join(this.storeDirectory, '.rivastock-central-state.json');
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return { lastFullHashAt: 0, offset: 0 };
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { lastFullHashAt: 0, offset: 0 };
      const state = parsed as Partial<CentralHashState>;
      return Number.isSafeInteger(state.lastFullHashAt) && Number(state.lastFullHashAt) >= 0
        && Number.isSafeInteger(state.offset) && Number(state.offset) >= 0
        ? { lastFullHashAt: Number(state.lastFullHashAt), offset: Number(state.offset) }
        : { lastFullHashAt: 0, offset: 0 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return { lastFullHashAt: 0, offset: 0 };
      throw error;
    }
  }

  async writeHashState(state: CentralHashState): Promise<void> {
    const path = join(this.storeDirectory, '.rivastock-central-state.json');
    await writeAtomic(this.storeDirectory, path, Buffer.from(JSON.stringify(state), 'utf8'));
  }

  resolveLocal(relativePath: string): string {
    return resolveManagedPath(this.storeDirectory, relativePath);
  }

  resolveMirror(relativePath: string): string | null {
    return this.mirrorDirectory ? resolveManagedPath(this.mirrorDirectory, relativePath) : null;
  }

  async write(relativePath: string, bytes: Uint8Array, expectedHash: string): Promise<'none' | 'ok'> {
    if (!HASH_PATTERN.test(expectedHash) || hashBytes(bytes) !== expectedHash.toLowerCase()) {
      throw new Error('La huella del archivo de la central no coincide.');
    }
    const localPath = this.resolveLocal(relativePath);
    await writeAtomic(this.storeDirectory, localPath, bytes);
    if (!this.mirrorDirectory) {
      await this.remember(relativePath, expectedHash.toLowerCase());
      return 'none';
    }
    const mirrorPath = this.resolveMirror(relativePath);
    if (!mirrorPath) throw new Error('La carpeta de respaldo no está disponible.');
    await writeAtomic(this.mirrorDirectory, mirrorPath, bytes);
    const mirrorBytes = await readFile(mirrorPath);
    if (hashBytes(mirrorBytes) !== expectedHash.toLowerCase()) {
      throw new Error('La verificación de la copia de respaldo falló.');
    }
    await this.remember(relativePath, expectedHash.toLowerCase());
    return 'ok';
  }

  async readVerified(relativePath: string, expectedHash: string): Promise<Uint8Array | null> {
    if (!HASH_PATTERN.test(expectedHash)) throw new Error('La huella esperada del archivo es inválida.');
    const localPath = this.resolveLocal(relativePath);
    const localBytes = await readIfRegular(localPath, this.storeDirectory);
    if (localBytes && hashBytes(localBytes) === expectedHash.toLowerCase()) return localBytes;
    const mirrorPath = this.resolveMirror(relativePath);
    if (!mirrorPath) return null;
    const mirrorBytes = await readIfRegular(mirrorPath, this.mirrorDirectory as string);
    if (!mirrorBytes || hashBytes(mirrorBytes) !== expectedHash.toLowerCase()) return null;
    await writeAtomic(this.storeDirectory, localPath, mirrorBytes);
    await this.remember(relativePath, expectedHash.toLowerCase());
    return mirrorBytes;
  }

  async statLocal(relativePath: string): Promise<StoredFileStat | null> {
    return statManaged(this.storeDirectory, this.resolveLocal(relativePath));
  }

  async statMirror(relativePath: string): Promise<StoredFileStat | null> {
    const mirrorPath = this.resolveMirror(relativePath);
    return mirrorPath ? statManaged(this.mirrorDirectory as string, mirrorPath) : null;
  }

  async delete(relativePath: string): Promise<void> {
    await removeManaged(this.storeDirectory, this.resolveLocal(relativePath));
    const mirrorPath = this.resolveMirror(relativePath);
    if (mirrorPath && this.mirrorDirectory) await removeManaged(this.mirrorDirectory, mirrorPath);
    const manifest = await this.readManifest();
    delete manifest[relativePath];
    await this.writeManifest(manifest);
  }

  private async remember(relativePath: string, sha256: string): Promise<void> {
    const info = await this.statLocal(relativePath);
    if (!info) return;
    const manifest = await this.readManifest();
    manifest[relativePath] = { ...info, sha256 };
    await this.writeManifest(manifest);
  }
}

export function isValidCentralPath(relativePath: string): boolean {
  return CENTRAL_PATH_PATTERN.test(relativePath)
    && !relativePath.split('/').some((part) => part === '.' || part === '..');
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function hashFile(path: string): Promise<string> {
  return hashBytes(await readFile(path));
}

function resolveManagedPath(root: string, relativePath: string): string {
  if (!isValidCentralPath(relativePath) || isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new Error('La ruta del archivo de la central no es válida.');
  }
  const target = resolve(root, ...relativePath.split('/'));
  if (!isInside(root, target)) throw new Error('La ruta del archivo sale de la central.');
  return target;
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

async function assertDirectoryChain(root: string, directory: string): Promise<void> {
  if (!isInside(root, directory)) throw new Error('La carpeta del archivo sale de la central.');
  const relativeDirectory = relative(root, directory);
  let current = root;
  for (const part of relativeDirectory.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('La central no puede contener enlaces simbólicos.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(current);
    }
  }
}

async function writeAtomic(root: string, target: string, bytes: Uint8Array): Promise<void> {
  const parent = dirname(target);
  await assertDirectoryChain(root, parent);
  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error('El destino de la central no es un archivo regular.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(parent, `.rivastock-${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  await file.close();
  await rename(temporary, target);
}

async function readIfRegular(path: string, root: string): Promise<Uint8Array | null> {
  await assertDirectoryChain(root, dirname(path));
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) return null;
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function statManaged(root: string, path: string): Promise<StoredFileStat | null> {
  await assertDirectoryChain(root, dirname(path));
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) return null;
    return { size: info.size, mtimeMs: info.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function removeManaged(root: string, path: string): Promise<void> {
  await assertDirectoryChain(root, dirname(path));
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('El archivo administrado no es regular.');
    await rm(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
