import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import {
  createStorageClient,
  getStorageBackupCredentials,
  listAllStorageObjects,
  projectRefFromEnvironment,
} from './backup-storage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_SIZE = 1000;
const STORAGE_SAFETY_LIMIT_BYTES = 900_000_000;
const ASSETS_BUCKET = 'assets';

function parseArguments(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  let apply = false;
  let confirmedStorageBytes = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--apply') {
      if (apply) throw new Error('duplicate-apply-option');
      apply = true;
      continue;
    }
    if (argv[index] === '--confirmed-storage-bytes' && argv[index + 1]) {
      if (confirmedStorageBytes !== null) throw new Error('duplicate-storage-confirmation');
      confirmedStorageBytes = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error('unsupported-options');
  }
  if (confirmedStorageBytes !== null
    && (!Number.isSafeInteger(confirmedStorageBytes) || confirmedStorageBytes < 0)) {
    throw new Error('storage-confirmation-invalid');
  }
  if (apply && confirmedStorageBytes === null) throw new Error('storage-confirmation-required');
  return { apply, confirmedStorageBytes };
}

function safeProcessSpec() {
  const backupScript = join(ROOT, 'scripts', 'backup-db.mjs');
  return { command: process.execPath, args: [backupScript, '--with-storage'] };
}

function isPathInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === '' || (pathFromParent !== '..'
    && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent));
}

function parseVerifiedBackupOutput(stdout) {
  for (const line of (stdout || '').split(/\r?\n/).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value?.verification === 'passed' && typeof value.backup === 'string'
        && Number.isSafeInteger(value.tables) && value.tables > 0
        && Number.isSafeInteger(value.rows) && value.rows >= 0
        && Number.isSafeInteger(value.schemaBytes) && value.schemaBytes > 0
        && Number.isSafeInteger(value.dataBytes) && value.dataBytes > 0
        && value.storage?.verification === 'passed'
        && Number.isSafeInteger(value.storage.objects) && Number.isSafeInteger(value.storage.bytes)) {
        return value;
      }
    } catch {
      // Ignore npm-style notices; the backup program emits a final JSON summary.
    }
  }
  throw new Error('backup-summary-invalid');
}

async function runVerifiedBackup() {
  const { command, args } = safeProcessSpec();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) throw new Error('backup-failed');
  const summary = parseVerifiedBackupOutput(result.stdout || '');
  const backupRoot = resolve(process.env.RIVASTOCK_BACKUP_ROOT
    || join(process.env.USERPROFILE || homedir(), 'rivastock-backups'));
  const rootReal = await realpath(backupRoot);
  const backupDir = await realpath(summary.backup);
  if (!isPathInside(rootReal, backupDir) || isPathInside(await realpath(ROOT), backupDir)) {
    throw new Error('backup-location-invalid');
  }
  if (existsSync(join(backupDir, 'BACKUP-UNVERIFIED.txt'))) throw new Error('backup-incomplete');
  for (const filename of ['schema.sql', 'data.sql', 'table-counts.csv', 'storage-manifest.json']) {
    const file = join(backupDir, filename);
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) throw new Error('backup-file-invalid');
  }
  const tableCounts = await readFile(join(backupDir, 'table-counts.csv'), 'utf8');
  if (tableCounts.split(/\r?\n/).filter(Boolean).length - 1 !== summary.tables) {
    throw new Error('backup-count-manifest-invalid');
  }
  const storageManifest = JSON.parse(await readFile(join(backupDir, 'storage-manifest.json'), 'utf8'));
  if (!Array.isArray(storageManifest.objects) || storageManifest.objects.length !== summary.storage.objects
    || !Array.isArray(storageManifest.buckets)) throw new Error('storage-backup-manifest-invalid');
  return summary;
}

function extractAssetsPath(value, projectRef) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.hostname !== `${projectRef}.supabase.co`) return null;
    const marker = `/storage/v1/object/public/${ASSETS_BUCKET}/`;
    const signedMarker = `/storage/v1/object/sign/${ASSETS_BUCKET}/`;
    const authenticatedMarker = `/storage/v1/object/authenticated/${ASSETS_BUCKET}/`;
    const matchedMarker = [marker, signedMarker, authenticatedMarker].find((candidate) => url.pathname.includes(candidate));
    if (!matchedMarker) return null;
    const path = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(matchedMarker) + matchedMarker.length));
    return path || null;
  } catch {
    return null;
  }
}

function productImageUrls(product) {
  const images = Array.isArray(product.images) ? product.images : [];
  return [...new Set([...images, product.image_url].filter((value) => typeof value === 'string' && value.length > 0))];
}

async function listAllProducts(client) {
  const products = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.from('products')
      .select('id,user_id,images,image_url')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) throw new Error('product-list-failed');
    products.push(...data);
    if (data.length < PAGE_SIZE) return products;
  }
}

function productPhotoPathSet(products, projectRef, objectPaths) {
  const paths = new Set();
  for (const product of products) {
    if (typeof product.id !== 'string' || typeof product.user_id !== 'string') continue;
    const expectedPrefix = `${product.user_id}/products/${product.id}/`;
    for (const imageUrl of productImageUrls(product)) {
      const sourcePath = extractAssetsPath(imageUrl, projectRef);
      if (!sourcePath || !sourcePath.startsWith(expectedPrefix) || sourcePath.endsWith('.thumb.webp')) continue;
      if (!objectPaths.has(sourcePath)) throw new Error('product-photo-object-missing');
      paths.add(sourcePath);
    }
  }
  return paths;
}

async function convertToWebpThumbnail(page, blob, path) {
  const bytes = Buffer.from(await blob.arrayBuffer());
  const sourceType = blob.type || (path.toLowerCase().endsWith('.png') ? 'image/png'
    : path.toLowerCase().endsWith('.jpg') || path.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/webp');
  const encodedSource = bytes.toString('base64');
  const encodedThumbnail = await page.evaluate(async ({ base64, mimeType }) => {
    const binary = atob(base64);
    const sourceBytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) sourceBytes[index] = binary.charCodeAt(index);
    const bitmap = await createImageBitmap(new Blob([sourceBytes], { type: mimeType }));
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas-context-unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const thumbnail = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('webp-encoding-failed')), 'image/webp', 0.82);
    });
    canvas.width = 0;
    canvas.height = 0;
    if (thumbnail.type !== 'image/webp') throw new Error('webp-encoding-unavailable');
    const data = new Uint8Array(await thumbnail.arrayBuffer());
    let binaryOutput = '';
    for (let offset = 0; offset < data.length; offset += 0x8000) {
      binaryOutput += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
    }
    return btoa(binaryOutput);
  }, { base64: encodedSource, mimeType: sourceType });
  return Buffer.from(encodedThumbnail, 'base64');
}

async function generateMissingThumbnails(client, page, projectRef) {
  const inventory = await listAllStorageObjects(client);
  const assetObjects = new Set(inventory.objects.filter((object) => object.bucket === ASSETS_BUCKET).map((object) => object.path));
  const totalBytes = inventory.objects.reduce((total, object) => total + object.size, 0);
  const products = await listAllProducts(client);
  const sourcePaths = productPhotoPathSet(products, projectRef, assetObjects);
  const pending = [];

  for (const sourcePath of sourcePaths) {
    const thumbnailPath = sourcePath.replace(/\.[^./]+$/, '.thumb.webp');
    if (assetObjects.has(thumbnailPath)) continue;
    const { data, error } = await client.storage.from(ASSETS_BUCKET).download(sourcePath);
    if (error || !data) throw new Error('product-photo-download-failed');
    const bytes = await convertToWebpThumbnail(page, data, sourcePath);
    pending.push({ path: thumbnailPath, bytes });
  }

  return { currentStorageBytes: totalBytes, pending, sourcePaths: sourcePaths.size };
}

async function verifyBackupFilesForApply(backup) {
  if (existsSync(join(resolve(backup.backup), 'BACKUP-UNVERIFIED.txt'))) throw new Error('backup-incomplete');
  return backup;
}

async function runBackfill(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log('Usage: npm run backfill:product-thumbnails [-- --apply --confirmed-storage-bytes <exact-current-total>]');
    console.log('Default mode reports a dry run. --apply creates and verifies a full backup before adding only missing thumbnail objects.');
    return;
  }

  let backup = null;
  if (options.apply) backup = await verifyBackupFilesForApply(await runVerifiedBackup());

  const projectRef = projectRefFromEnvironment();
  const credentials = getStorageBackupCredentials(projectRef);
  const client = createStorageClient(projectRef, credentials);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const plan = await generateMissingThumbnails(client, page, projectRef);
    if (options.confirmedStorageBytes !== null
      && plan.currentStorageBytes !== options.confirmedStorageBytes) {
      throw new Error('storage-total-changed-since-preflight');
    }
    const addedBytes = plan.pending.reduce((total, object) => total + object.bytes.length, 0);
    if (plan.currentStorageBytes + addedBytes > STORAGE_SAFETY_LIMIT_BYTES) {
      throw new Error('storage-budget-would-be-exceeded');
    }

    if (options.apply) {
      const beforeUpload = await listAllStorageObjects(client);
      const beforeBytes = beforeUpload.objects.reduce((total, object) => total + object.size, 0);
      if (beforeBytes !== plan.currentStorageBytes) throw new Error('storage-inventory-changed-during-backfill');
      for (const object of plan.pending) {
        const { error } = await client.storage.from(ASSETS_BUCKET).upload(object.path, new Blob([object.bytes], { type: 'image/webp' }), {
          contentType: 'image/webp',
          upsert: false,
        });
        if (error) throw new Error('thumbnail-upload-failed');
      }
      const afterUpload = await listAllStorageObjects(client);
      const afterBytes = afterUpload.objects.reduce((total, object) => total + object.size, 0);
      if (afterBytes !== plan.currentStorageBytes + addedBytes
        || plan.pending.some((object) => !afterUpload.objects.some((saved) => saved.bucket === ASSETS_BUCKET && saved.path === object.path && saved.size === object.bytes.length))) {
        throw new Error('thumbnail-backfill-verification-failed');
      }
      console.log(JSON.stringify({
        verification: 'passed',
        backup: backup.backup,
        productsWithPhotos: plan.sourcePaths,
        thumbnailsAdded: plan.pending.length,
        bytesAdded: addedBytes,
        storageBytesBefore: plan.currentStorageBytes,
        storageBytesAfter: afterBytes,
      }));
      return;
    }

    console.log(JSON.stringify({
      verification: 'dry-run',
      productsWithPhotos: plan.sourcePaths,
      thumbnailsPlanned: plan.pending.length,
      estimatedBytes: addedBytes,
      storageBytesBefore: plan.currentStorageBytes,
      storageSafetyLimitBytes: STORAGE_SAFETY_LIMIT_BYTES,
    }));
  } finally {
    await browser.close();
  }
}

function isMainModule() {
  const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
  return entry === import.meta.url;
}

if (isMainModule()) {
  runBackfill().catch((error) => {
    const code = typeof error?.message === 'string' && /^[a-z0-9-]+$/.test(error.message)
      ? error.message
      : 'thumbnail-backfill-failed';
    console.error(JSON.stringify({ verification: 'failed', error: code }));
    process.exitCode = 1;
  });
}

export { extractAssetsPath, parseArguments, productPhotoPathSet };
