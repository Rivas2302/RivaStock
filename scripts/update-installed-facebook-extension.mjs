import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isNewerExtensionVersion } from '../extensions/facebook/extension-update.js';
import { extensionFiles } from './package-facebook-extension.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_BASE = 'https://rivastock.vercel.app/downloads';
const VERSION_URL = `${RELEASE_BASE}/rivastock-facebook-version.json`;
const ARCHIVE_URL = `${RELEASE_BASE}/rivastock-facebook.zip`;
const PROFILE_DATA_ROOT = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
const PERSISTENT_QA_PROFILE = join(homedir(), 'rivastock-qa-profile');
const BACKUP_ROOT = join(homedir(), 'rivastock-extension-backups');
const UPDATE_BUSY_SQL = `
SELECT NOT EXISTS (
  SELECT 1
  FROM public.facebook_devices AS device
  WHERE device.revoked_at IS NULL AND device.last_seen_at > now() - interval '3 minutes'
    AND (
      EXISTS (SELECT 1 FROM public.facebook_delivery_attempts AS attempt
        WHERE attempt.device_id = device.id AND attempt.finished_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.facebook_deliveries AS delivery
        WHERE delivery.device_id = device.id AND delivery.status = 'running')
      OR EXISTS (SELECT 1 FROM public.fb_rehearsals AS rehearsal
        WHERE rehearsal.device_id = device.id AND rehearsal.status = 'running')
    )
) AS safe_to_update;
`;

function isInside(parent, child) {
  const fromParent = relative(parent, child);
  return fromParent === '' || (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent));
}

export function extensionIdFromManifestKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(key)) throw new Error('extension-key-invalid');
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  return [...digest.subarray(0, 16)].flatMap(byte => [byte >> 4, byte & 15])
    .map(value => String.fromCharCode(97 + value)).join('');
}

export function isValidReleaseManifest(value, expectedId, expectedFiles = extensionFiles) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.version === 'string' && /^\d+\.\d+\.\d+$/.test(value.version)
    && value.protocol === 2
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
    && Array.isArray(value.files) && value.files.length > 0
    && value.files.every(file => typeof file === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(file))
    && new Set(value.files).size === value.files.length
    && value.files.length === expectedFiles.length && expectedFiles.every((file, index) => value.files[index] === file)
    && typeof expectedId === 'string' && /^[a-p]{32}$/.test(expectedId));
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function extractVerifiedStoredArchive(archive, expectedFiles) {
  if (!Buffer.isBuffer(archive)) throw new Error('extension-archive-invalid');
  const allowed = new Set(expectedFiles);
  const extracted = new Map();
  let offset = 0;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > archive.length) throw new Error('extension-archive-invalid');
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const expectedCrc = archive.readUInt32LE(offset + 14);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const uncompressedSize = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (flags !== 0 || method !== 0 || compressedSize !== uncompressedSize || dataEnd > archive.length) {
      throw new Error('extension-archive-format-unsupported');
    }
    const name = archive.subarray(nameStart, nameStart + nameLength).toString('utf8');
    if (!allowed.has(name) || name.includes('/') || name.includes('\\') || extracted.has(name)) {
      throw new Error('extension-archive-file-invalid');
    }
    const bytes = archive.subarray(dataStart, dataEnd);
    if (crc32(bytes) !== expectedCrc) throw new Error('extension-archive-checksum-invalid');
    extracted.set(name, Buffer.from(bytes));
    offset = dataEnd;
  }
  if (extracted.size !== allowed.size || [...allowed].some(name => !extracted.has(name))) {
    throw new Error('extension-archive-file-set-invalid');
  }
  return extracted;
}

export function findChromeExtensionInstall(profileDirectories, extensionId, expectedName) {
  const found = [];
  for (const profileDirectory of profileDirectories) {
    for (const preferencesText of [profileDirectory.preferencesText, profileDirectory.securePreferencesText]) {
      let preferences;
      try { preferences = JSON.parse(preferencesText); } catch { continue; }
      const entry = preferences?.extensions?.settings?.[extensionId];
      if (!entry || entry.state === 0 || typeof entry.path !== 'string' || entry.location !== 4) continue;
      if (!isAbsolute(entry.path)) continue;
      const extensionPath = resolve(entry.path);
      if (found.some(item => item.profileName === basename(profileDirectory.path) && item.extensionPath === extensionPath)) continue;
      found.push({ profileName: basename(profileDirectory.path), extensionPath, expectedName });
    }
  }
  return found;
}

export function buildRequiredVersionSql(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('extension-version-invalid');
  return `
INSERT INTO public.facebook_worker_policy(user_id, required_protocol, required_extension_version)
SELECT DISTINCT device.user_id, coalesce(policy.required_protocol, 1), '${version}'
FROM public.facebook_devices AS device
LEFT JOIN public.facebook_worker_policy AS policy ON policy.user_id = device.user_id
WHERE device.revoked_at IS NULL
ON CONFLICT (user_id) DO UPDATE
SET required_extension_version = EXCLUDED.required_extension_version, updated_at = now()
RETURNING user_id;
`;
}

async function listChromeProfiles() {
  const roots = [PROFILE_DATA_ROOT, PERSISTENT_QA_PROFILE].filter(Boolean);
  const profiles = [];
  for (const root of new Set(roots)) {
    let directories;
    try { directories = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const directory of directories) {
      if (!directory.isDirectory() || !/^(Default|Profile \d+)$/.test(directory.name)) continue;
      const profilePath = join(root, directory.name);
      const [preferencesText, securePreferencesText] = await Promise.all([
        readFile(join(profilePath, 'Preferences'), 'utf8').catch(() => null),
        readFile(join(profilePath, 'Secure Preferences'), 'utf8').catch(() => null),
      ]);
      if (preferencesText || securePreferencesText) profiles.push({ path: profilePath, preferencesText, securePreferencesText });
    }
  }
  return profiles;
}

function runSupabaseQuery(sql) {
  const file = join(tmpdir(), `rivastock-extension-update-${process.pid}-${Date.now()}.sql`);
  try {
    return writeFile(file, sql, { flag: 'wx' }).then(() => {
      const result = spawnSync('supabase.cmd', ['db', 'query', '--linked', '--output', 'json', '--file', file], {
        encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30_000, shell: true,
      });
      if (result.error || result.status !== 0) throw new Error('supabase-update-query-failed');
      return result.stdout;
    }).finally(() => rm(file, { force: true }));
  } catch {
    return Promise.reject(new Error('supabase-update-query-failed'));
  }
}

function rowsFromCli(output) {
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : parsed.rows ?? parsed.result ?? parsed;
  } catch { throw new Error('supabase-query-response-invalid'); }
}

async function assertNoActiveFacebookWork() {
  const rows = rowsFromCli(await runSupabaseQuery(UPDATE_BUSY_SQL));
  if (!Array.isArray(rows) || rows[0]?.safe_to_update !== true) throw new Error('facebook-work-in-progress');
}

async function fetchRelease() {
  const headers = { 'User-Agent': 'RivaStock-Extension-Updater/1.0' };
  const versionResponse = await fetch(VERSION_URL, { headers, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!versionResponse.ok) throw new Error('extension-release-unavailable');
  const release = await versionResponse.json();
  const current = JSON.parse(await readFile(join(ROOT, 'extensions/facebook/manifest.json'), 'utf8'));
  const expectedId = extensionIdFromManifestKey(current.key);
  if (!isValidReleaseManifest(release, expectedId)) throw new Error('extension-release-manifest-invalid');
  const archiveResponse = await fetch(ARCHIVE_URL, { headers, signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!archiveResponse.ok) throw new Error('extension-archive-unavailable');
  const contentLength = Number(archiveResponse.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 5_000_000) throw new Error('extension-archive-invalid');
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  if (archive.length > 5_000_000) throw new Error('extension-archive-invalid');
  if (createHash('sha256').update(archive).digest('hex') !== release.sha256) throw new Error('extension-archive-checksum-invalid');
  return { release, current, expectedId, archive };
}

async function installRelease({ release, current, expectedId, archive }) {
  const candidates = findChromeExtensionInstall(await listChromeProfiles(), expectedId, current.name);
  const validCandidates = [];
  for (const candidate of candidates) {
    try {
      const folder = await realpath(candidate.extensionPath);
      const folderManifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
      if (folderManifest.name !== current.name || extensionIdFromManifestKey(folderManifest.key) !== expectedId) continue;
      validCandidates.push({ ...candidate, extensionPath: folder, installedVersion: folderManifest.version });
    } catch { /* Missing, stale, or non-extension paths are ignored. */ }
  }
  if (validCandidates.length !== 1) throw new Error(validCandidates.length ? 'multiple-extension-installations' : 'extension-installation-not-found');
  const install = validCandidates[0];
  if (install.installedVersion === release.version) return { ...install, updated: false, releaseVersion: release.version };
  if (!isNewerExtensionVersion(release.version, install.installedVersion)) {
    throw new Error('extension-release-would-downgrade');
  }
  await assertNoActiveFacebookWork();
  const extracted = extractVerifiedStoredArchive(archive, release.files);
  const backupBase = resolve(BACKUP_ROOT);
  const repositoryRoot = await realpath(ROOT);
  if (isInside(repositoryRoot, backupBase)) throw new Error('extension-backup-inside-repository');
  const backupDirectory = join(backupBase, new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(backupDirectory, { recursive: true });
  await cp(install.extensionPath, join(backupDirectory, 'previous-extension'), { recursive: true, errorOnExist: true });
  const currentBackupManifest = JSON.parse(await readFile(join(backupDirectory, 'previous-extension', 'manifest.json'), 'utf8'));
  if (currentBackupManifest.version !== install.installedVersion) throw new Error('extension-backup-verification-failed');
  const stageDirectory = await mkdtemp(join(tmpdir(), 'rivastock-facebook-extension-'));
  try {
    for (const [name, bytes] of extracted) await writeFile(join(stageDirectory, name), bytes, { flag: 'wx' });
    const stagedManifest = JSON.parse(await readFile(join(stageDirectory, 'manifest.json'), 'utf8'));
    if (stagedManifest.name !== current.name || stagedManifest.version !== release.version
      || extensionIdFromManifestKey(stagedManifest.key) !== expectedId) throw new Error('extension-stage-verification-failed');
    for (const name of release.files) await writeFile(join(install.extensionPath, name), extracted.get(name));
    const installedManifest = JSON.parse(await readFile(join(install.extensionPath, 'manifest.json'), 'utf8'));
    if (installedManifest.version !== release.version) throw new Error('extension-install-verification-failed');
  } catch (error) {
    for (const name of release.files) {
      try { await cp(join(backupDirectory, 'previous-extension', name), join(install.extensionPath, name), { force: true }); }
      catch { /* A missing older file is not replaced during recovery. */ }
    }
    throw error;
  } finally {
    await rm(stageDirectory, { recursive: true, force: true });
  }
  const updateRows = rowsFromCli(await runSupabaseQuery(buildRequiredVersionSql(release.version)));
  if (!Array.isArray(updateRows) || updateRows.length === 0) throw new Error('extension-target-update-unverified');
  return { ...install, updated: true, releaseVersion: release.version, backupDirectory };
}

export async function updateInstalledFacebookExtension() {
  const release = await fetchRelease();
  return installRelease(release);
}

async function main() {
  const result = await updateInstalledFacebookExtension();
  console.log(JSON.stringify({ result: result.updated ? 'updated' : 'already-current', version: result.releaseVersion }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    const safeErrors = new Set([
      'extension-key-invalid', 'extension-release-unavailable', 'extension-release-manifest-invalid',
      'extension-archive-unavailable', 'extension-archive-checksum-invalid', 'extension-archive-format-unsupported',
      'extension-archive-file-invalid', 'extension-archive-file-set-invalid', 'extension-archive-invalid', 'extension-version-invalid',
      'extension-installation-not-found', 'multiple-extension-installations', 'extension-release-would-downgrade',
      'facebook-work-in-progress', 'extension-backup-verification-failed', 'extension-stage-verification-failed',
      'extension-install-verification-failed', 'extension-target-update-unverified', 'supabase-update-query-failed',
      'supabase-query-response-invalid', 'extension-backup-inside-repository',
    ]);
    console.error(safeErrors.has(error?.message) ? error.message : 'extension-update-failed');
    process.exitCode = 1;
  });
}

export const extensionUpdaterInternals = { UPDATE_BUSY_SQL };
