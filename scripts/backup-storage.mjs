import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_SIZE = 1000;
const DOWNLOAD_CONCURRENCY = 3;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function isPathInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === '' || (pathFromParent !== '..' && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent));
}

function projectRefFromEnvironment() {
  const configured = process.env.SUPABASE_PROJECT_REF?.trim();
  if (configured) {
    if (!PROJECT_REF_PATTERN.test(configured)) throw new Error('project-ref-invalid');
    return configured;
  }

  const projectRefPath = join(ROOT, 'supabase', '.temp', 'project-ref');
  if (!existsSync(projectRefPath)) throw new Error('project-ref-missing');
  const projectRef = readFileSync(projectRefPath, 'utf8').trim();
  if (!PROJECT_REF_PATTERN.test(projectRef)) throw new Error('project-ref-invalid');
  return projectRef;
}

function cliProcessSpec(binary, args) {
  if (/\.(?:mjs|cjs|js)$/i.test(binary)) return { command: process.execPath, args: [binary, ...args], shell: false };
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(binary)) return { command: binary, args, shell: true };
  if (process.platform === 'win32' && /\.ps1$/i.test(binary)) {
    return {
      command: process.env.POWERSHELL_EXE || 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', binary, ...args],
      shell: false,
    };
  }
  return { command: binary, args, shell: false };
}

export function selectStorageBackupCredentials(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('api-key-list-invalid');
  }
  if (!Array.isArray(parsed)) throw new Error('api-key-list-invalid');
  const secretKeys = parsed.filter((entry) => entry?.type === 'secret'
    && typeof entry.api_key === 'string' && entry.api_key.startsWith('sb_secret_'));
  const selected = secretKeys.find((entry) => entry.name === 'default') ?? secretKeys[0];
  if (!selected) throw new Error('secret-api-key-missing');
  const legacyServiceRole = parsed.find((entry) => entry?.name === 'service_role'
    && typeof entry.api_key === 'string' && entry.api_key.startsWith('eyJ'));
  if (!legacyServiceRole) throw new Error('legacy-storage-jwt-missing');
  return { apiKey: selected.api_key, legacyStorageJwt: legacyServiceRole.api_key };
}

function safeStorageErrorCode(prefix, error) {
  const status = Number(error?.status ?? error?.statusCode);
  const code = typeof error?.code === 'string' && /^[a-z0-9_-]{1,40}$/i.test(error.code)
    ? `-${error.code.toLowerCase()}`
    : '';
  return `${prefix}${Number.isInteger(status) && status > 0 ? `-${status}` : ''}${code}`;
}

function getStorageBackupCredentials(projectRef) {
  let binary = process.env.SUPABASE_CLI_BIN || 'supabase';
  let args = ['projects', 'api-keys', '--project-ref', projectRef, '--output', 'json'];
  if (!process.env.SUPABASE_CLI_BIN && process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    const cmd = appData ? join(appData, 'npm', 'supabase.cmd') : '';
    const ps1 = appData ? join(appData, 'npm', 'supabase.ps1') : '';
    if (ps1 && existsSync(ps1)) binary = ps1;
    else if (cmd && existsSync(cmd)) binary = cmd;
    else binary = 'supabase.cmd';
  }

  const spec = cliProcessSpec(binary, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    shell: spec.shell,
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) throw new Error('api-key-list-failed');
  return selectStorageBackupCredentials(result.stdout || '');
}

function createStorageClient(projectRef, { apiKey, legacyStorageJwt }) {
  const projectUrl = `https://${projectRef}.supabase.co`;
  const fetchWithStorageJwt = (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    try {
      const requestUrl = new URL(input instanceof Request ? input.url : String(input));
      if (requestUrl.origin === projectUrl && requestUrl.pathname.startsWith('/storage/v1/')) {
        headers.set('apikey', apiKey);
        headers.set('Authorization', `Bearer ${legacyStorageJwt}`);
        return fetch(input, { ...init, headers });
      }
    } catch {
      // Use API key-only headers for invalid or relative URLs.
    }
    if (headers.get('Authorization') === `Bearer ${apiKey}`) headers.delete('Authorization');
    return fetch(input, { ...init, headers });
  };
  return createClient(projectUrl, apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchWithStorageJwt },
  });
}

function parseArguments(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const result = { backupDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--backup-dir' || !argv[index + 1]) throw new Error('unsupported-options');
    if (result.backupDir) throw new Error('duplicate-backup-dir');
    result.backupDir = argv[index + 1];
    index += 1;
  }
  return result;
}

async function getBackupDirectory(requestedPath) {
  const backupRoot = resolve(process.env.RIVASTOCK_BACKUP_ROOT
    || join(process.env.USERPROFILE || homedir(), 'rivastock-backups'));
  await mkdir(backupRoot, { recursive: true });
  const realBackupRoot = await realpath(backupRoot);
  if (isPathInside(await realpath(ROOT), realBackupRoot)) throw new Error('backup-directory-inside-repository');

  if (!requestedPath) {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const directory = join(realBackupRoot, timestamp);
    await mkdir(directory, { recursive: false });
    return { backupRoot: realBackupRoot, backupDir: await realpath(directory) };
  }

  const backupDir = resolve(requestedPath);
  if (!existsSync(backupDir)) throw new Error('backup-directory-missing');
  const realBackupDir = await realpath(backupDir);
  if (!isPathInside(realBackupRoot, realBackupDir)) throw new Error('backup-directory-outside-root');
  if (isPathInside(await realpath(ROOT), realBackupDir)) throw new Error('backup-directory-inside-repository');
  return { backupRoot: realBackupRoot, backupDir: realBackupDir };
}

function safeObjectRelativePath(bucket, objectPath) {
  const segments = objectPath.split('/');
  if (!bucket || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('storage-object-path-invalid');
  }
  const identity = createHash('sha256').update(`${bucket}\0${objectPath}`).digest('hex');
  return join('storage', `~${Buffer.from(bucket).toString('base64url')}`, identity.slice(0, 2), `${identity}.blob`);
}

function normalizeStorageEntry(bucket, prefix, entry) {
  if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name.includes('/')
    || entry.name === '.' || entry.name === '..') throw new Error('storage-list-entry-invalid');
  const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
  const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : null;
  const isFolder = entry.id === null && metadata === null;
  if (isFolder) return { folder: objectPath };
  const size = Number(metadata?.size);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('storage-object-size-missing');
  return {
    object: {
      bucket,
      path: objectPath,
      size,
      updatedAt: typeof entry.updated_at === 'string' ? entry.updated_at : null,
      etag: typeof metadata?.eTag === 'string' ? metadata.eTag : (typeof metadata?.etag === 'string' ? metadata.etag : null),
      file: safeObjectRelativePath(bucket, objectPath).split(sep).join('/'),
    },
  };
}

async function listStorageObjects(storage, bucket) {
  const objects = [];
  const pendingFolders = [''];
  const visitedFolders = new Set();
  while (pendingFolders.length) {
    const prefix = pendingFolders.pop();
    if (visitedFolders.has(prefix)) throw new Error('storage-folder-cycle');
    visitedFolders.add(prefix);
    let offset = 0;
    while (true) {
      const { data, error } = await storage.from(bucket).list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error || !Array.isArray(data)) throw new Error('storage-list-failed');
      for (const entry of data) {
        const normalized = normalizeStorageEntry(bucket, prefix, entry);
        if (normalized.folder) pendingFolders.push(normalized.folder);
        else objects.push(normalized.object);
      }
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }
  objects.sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(objects.map((object) => object.path)).size !== objects.length) throw new Error('storage-duplicate-object');
  return objects;
}

async function listAllStorageObjects(client) {
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error) throw new Error(safeStorageErrorCode('storage-bucket-list-failed', error));
  if (!Array.isArray(buckets)) throw new Error('storage-bucket-list-invalid');
  const names = buckets.map((bucket) => bucket?.name).filter((name) => typeof name === 'string' && name.length > 0);
  if (names.length !== buckets.length || new Set(names).size !== names.length) throw new Error('storage-bucket-list-invalid');
  if (names.length === 0) throw new Error('storage-bucket-list-empty');
  names.sort((left, right) => left.localeCompare(right));
  const objects = [];
  for (const bucket of names) objects.push(...await listStorageObjects(client.storage, bucket));
  return { buckets: names, objects };
}

function inventorySignature(inventory) {
  return inventory.map((object) => `${object.bucket}\0${object.path}\0${object.size}\0${object.updatedAt ?? ''}\0${object.etag ?? ''}`).join('\n');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  const file = await readFile(path);
  hash.update(file);
  return hash.digest('hex');
}

function manifestPath(directory, file) {
  const destination = resolve(directory, file);
  if (!isPathInside(directory, destination)) throw new Error('backup-file-path-invalid');
  return destination;
}

async function loadManifest(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed?.version !== 1 || !Array.isArray(parsed.objects) || !Array.isArray(parsed.buckets)) throw new Error();
    return parsed;
  } catch {
    throw new Error('storage-manifest-invalid');
  }
}

function manifestObjectsByIdentity(manifest) {
  const map = new Map();
  for (const object of manifest?.objects ?? []) {
    if (typeof object?.bucket !== 'string' || typeof object?.path !== 'string' || typeof object?.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(object.sha256)) continue;
    map.set(`${object.bucket}\0${object.path}`, object);
  }
  return map;
}

async function sameRemoteObjectExists(directory, remoteObject, savedObject) {
  if (!savedObject || savedObject.size !== remoteObject.size
    || savedObject.updatedAt !== remoteObject.updatedAt || savedObject.etag !== remoteObject.etag
    || savedObject.file !== remoteObject.file || !savedObject.sha256) return false;
  const localPath = manifestPath(directory, remoteObject.file);
  try {
    const localInfo = await stat(localPath);
    if (!localInfo.isFile() || localInfo.size !== remoteObject.size) return false;
    return await sha256File(localPath) === savedObject.sha256;
  } catch {
    return false;
  }
}

async function writeManifestAtomically(path, manifest) {
  const temporary = `${path}.tmp`;
  await rm(temporary, { force: true });
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}

function summarizeManifest(manifest) {
  const buckets = manifest.buckets.map((name) => {
    const entries = manifest.objects.filter((object) => object.bucket === name);
    return { name, objects: entries.length, bytes: entries.reduce((sum, object) => sum + object.size, 0) };
  });
  return {
    buckets,
    objects: manifest.objects.length,
    bytes: manifest.objects.reduce((sum, object) => sum + object.size, 0),
    verification: 'passed',
  };
}

export function isStorageBackupFresh(generatedAt, now = Date.now()) {
  const timestamp = Date.parse(generatedAt);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < 24 * 60 * 60 * 1000;
}

async function verifyCompletedBackup(backupDir, manifest, remote) {
  if (JSON.stringify(manifest.buckets) !== JSON.stringify(remote.buckets)
    || inventorySignature(manifest.objects) !== inventorySignature(remote.objects)) return false;
  const previousByIdentity = manifestObjectsByIdentity(manifest);
  for (const remoteObject of remote.objects) {
    const savedObject = previousByIdentity.get(`${remoteObject.bucket}\0${remoteObject.path}`);
    if (!(await sameRemoteObjectExists(backupDir, remoteObject, savedObject))) return false;
  }
  return true;
}

async function findLatestCompletedBackup(backupRoot, excludedDir) {
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(backupRoot, entry.name);
    if (resolve(directory) === resolve(excludedDir)) continue;
    const manifest = await loadManifest(join(directory, 'storage-manifest.json'));
    if (manifest?.generatedAt && Number.isFinite(Date.parse(manifest.generatedAt))
      && manifest.projectRef === projectRefFromEnvironment()) candidates.push({ directory, manifest });
  }
  candidates.sort((a, b) => Date.parse(b.manifest.generatedAt) - Date.parse(a.manifest.generatedAt));
  for (const candidate of candidates) {
    let valid = true;
    for (const object of candidate.manifest.objects) {
      if (!(await sameRemoteObjectExists(candidate.directory, object, object))) { valid = false; break; }
    }
    if (valid) return candidate;
  }
  return null;
}

async function materializeBackup(source, targetDir, manifest) {
  for (const object of manifest.objects) {
    const sourcePath = manifestPath(source, object.file);
    const targetPath = manifestPath(targetDir, object.file);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    if (!(await sameRemoteObjectExists(targetDir, object, object))) throw new Error('storage-object-verification-failed');
  }
  await writeManifestAtomically(join(targetDir, 'storage-manifest.json'), manifest);
}

async function downloadObject(client, backupDir, object) {
  const { data, error } = await client.storage.from(object.bucket).download(object.path);
  if (error || !data) throw new Error('storage-object-download-failed');
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.byteLength !== object.size) throw new Error('storage-object-size-mismatch');
  const localPath = manifestPath(backupDir, object.file);
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const localInfo = await stat(localPath);
  if (localInfo.size !== object.size || await sha256File(localPath) !== sha256) throw new Error('storage-object-verification-failed');
  return { ...object, sha256 };
}

export async function runStorageBackup({ backupDir: requestedPath = null, argv = process.argv.slice(2) } = {}) {
  const args = requestedPath ? { backupDir: requestedPath } : parseArguments(argv);
  if (args.help) return { help: true };
  const projectRef = projectRefFromEnvironment();
  const { backupRoot, backupDir } = await getBackupDirectory(args.backupDir);
  const finalManifestPath = join(backupDir, 'storage-manifest.json');
  const partialManifestPath = join(backupDir, 'storage-manifest.partial.json');
  if (existsSync(finalManifestPath)) {
    const existing = await loadManifest(finalManifestPath);
    if (!existing || existing.projectRef !== projectRef) throw new Error('completed-backup-invalid');
    for (const object of existing.objects) {
      if (!(await sameRemoteObjectExists(backupDir, object, object))) throw new Error('completed-backup-file-invalid');
    }
    return { backup: backupDir, ...summarizeManifest(existing) };
  }

  const previousBackup = await findLatestCompletedBackup(backupRoot, backupDir);
  if (previousBackup && isStorageBackupFresh(previousBackup.manifest.generatedAt)) {
    await materializeBackup(previousBackup.directory, backupDir, previousBackup.manifest);
    return { backup: backupDir, reusedWithinDailyWindow: true, ...summarizeManifest(previousBackup.manifest) };
  }

  const credentials = getStorageBackupCredentials(projectRef);
  const client = createStorageClient(projectRef, credentials);
  const remote = await listAllStorageObjects(client);

  const partial = await loadManifest(partialManifestPath);
  const priorByIdentity = manifestObjectsByIdentity(partial ?? previousBackup?.manifest);
  const savedObjects = [];
  const remoteKeys = new Set(remote.objects.map((object) => `${object.bucket}\0${object.path}`));
  await writeManifestAtomically(partialManifestPath, {
    version: 1,
    projectRef,
    generatedAt: new Date().toISOString(),
    buckets: remote.buckets,
    objects: [],
  });

  for (let offset = 0; offset < remote.objects.length; offset += DOWNLOAD_CONCURRENCY) {
    const batch = remote.objects.slice(offset, offset + DOWNLOAD_CONCURRENCY);
    const completed = await Promise.all(batch.map(async (remoteObject) => {
      const identity = `${remoteObject.bucket}\0${remoteObject.path}`;
      const previous = priorByIdentity.get(identity);
      if (await sameRemoteObjectExists(backupDir, remoteObject, previous)) return { ...remoteObject, sha256: previous.sha256 };
      if (previous && (await sameRemoteObjectExists(previousBackup.directory, remoteObject, previous))) {
        const source = manifestPath(previousBackup.directory, previous.file);
        const destination = manifestPath(backupDir, remoteObject.file);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(source, destination);
        return { ...remoteObject, sha256: previous.sha256 };
      }
      return downloadObject(client, backupDir, remoteObject);
    }));
    savedObjects.push(...completed);
    await writeManifestAtomically(partialManifestPath, {
      version: 1,
      projectRef,
      generatedAt: new Date().toISOString(),
      buckets: remote.buckets,
      objects: [...savedObjects],
    });
  }

  const afterDownload = await listAllStorageObjects(client);
  if (JSON.stringify(remote.buckets) !== JSON.stringify(afterDownload.buckets)
    || inventorySignature(remote.objects) !== inventorySignature(afterDownload.objects)) {
    throw new Error('storage-inventory-changed-during-backup');
  }
  if (savedObjects.length !== remote.objects.length
    || savedObjects.reduce((sum, object) => sum + object.size, 0) !== remote.objects.reduce((sum, object) => sum + object.size, 0)) {
    throw new Error('storage-inventory-verification-failed');
  }

  const manifest = {
    version: 1,
    projectRef,
    generatedAt: new Date().toISOString(),
    buckets: remote.buckets,
    objects: savedObjects.sort((left, right) => left.bucket.localeCompare(right.bucket) || left.path.localeCompare(right.path)),
  };
  if (manifest.objects.some((object) => !remoteKeys.has(`${object.bucket}\0${object.path}`))) {
    throw new Error('storage-manifest-inventory-mismatch');
  }
  for (const object of manifest.objects) {
    const localPath = manifestPath(backupDir, object.file);
    const localInfo = await stat(localPath);
    if (!localInfo.isFile() || localInfo.size !== object.size || await sha256File(localPath) !== object.sha256) {
      throw new Error('storage-manifest-file-verification-failed');
    }
  }
  await rename(partialManifestPath, finalManifestPath);
  return { backup: backupDir, ...summarizeManifest(manifest) };
}

function isMainModule() {
  const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
  return entry === import.meta.url;
}

if (isMainModule()) {
  runStorageBackup().then((result) => {
    if (result.help) {
      console.log('Usage: npm run backup:storage -- [--backup-dir <verified-backup-folder>]');
      return;
    }
    console.log(JSON.stringify(result));
  }).catch((error) => {
    const code = typeof error?.message === 'string' && /^[a-z0-9-]+$/.test(error.message)
      ? error.message
      : 'storage-backup-failed';
    console.error(JSON.stringify({ verification: 'failed', error: code }));
    process.exitCode = 1;
  });
}

export {
  createStorageClient,
  getStorageBackupCredentials,
  inventorySignature,
  isPathInside,
  listAllStorageObjects,
  normalizeStorageEntry,
  projectRefFromEnvironment,
  safeObjectRelativePath,
};
