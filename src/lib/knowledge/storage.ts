import { imageFileExtension, optimizeUploadImage } from '../imageOptimization';
import { supabase } from '../supabase';
import { detectFormat, safeStorageName } from './files';

const STORAGE_BUCKET = 'knowledge';
const MAX_ASSET_BYTES = 10_485_760;

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function knowledgeContentTypeFor(file: File): string {
  const extension = file.name.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase();
  if (extension && CONTENT_TYPES[extension]) return CONTENT_TYPES[extension];
  const type = file.type.trim().toLowerCase();
  if (type && type !== 'application/octet-stream') return type === 'image/jpg' ? 'image/jpeg' : type;
  return CONTENT_TYPES[extension ?? ''] ?? 'application/octet-stream';
}

function throwStorageError(error: { message: string }): never {
  throw new Error(error.message);
}

export async function uploadVersionFile(
  ownerUid: string,
  documentId: string,
  versionNumber: number,
  file: File,
): Promise<string> {
  if (!detectFormat(file) || detectFormat(file) === 'editor') throw new Error('Tipo de archivo no permitido.');
  const path = `${ownerUid}/${documentId}/v${versionNumber}/${safeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    contentType: knowledgeContentTypeFor(file),
    upsert: false,
  });
  if (error) throwStorageError(error);
  return path;
}

export interface UploadedKnowledgeAsset {
  path: string;
  file: File;
  mimeType: 'image/webp' | 'image/png' | 'image/jpeg';
}

export async function uploadAsset(ownerUid: string, documentId: string, source: File): Promise<UploadedKnowledgeAsset> {
  const file = await optimizeUploadImage(source);
  const extension = imageFileExtension(file).toLowerCase();
  const mimeType = extension === 'webp' ? 'image/webp' : extension === 'png' ? 'image/png' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : null;
  if (!mimeType) throw new Error('El archivo no es una imagen compatible.');
  if (file.size < 1 || file.size > MAX_ASSET_BYTES) throw new Error('La imagen supera el límite de 10 MB.');
  const path = `${ownerUid}/${documentId}/assets/${crypto.randomUUID()}.${extension === 'jpeg' ? 'jpg' : extension}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throwStorageError(error);
  return { path, file, mimeType };
}

export async function signedUrl(path: string, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, seconds);
  if (error) throwStorageError(error);
  if (!data?.signedUrl) throw new Error('No se pudo generar el enlace del archivo.');
  return data.signedUrl;
}

export async function signedUrls(paths: string[], seconds = 3600): Promise<Record<string, string>> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) return {};
  const urls: Record<string, string> = {};
  for (let start = 0; start < uniquePaths.length; start += 100) {
    const batch = uniquePaths.slice(start, start + 100);
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(batch, seconds);
    if (error) throwStorageError(error);
    for (const entry of data ?? []) {
      if (entry.error || !entry.path || !entry.signedUrl) {
        throw new Error(entry.error ?? 'No se pudo generar el enlace de uno de los archivos.');
      }
      urls[entry.path] = entry.signedUrl;
    }
  }
  return urls;
}

export async function removePaths(paths: string[]): Promise<void> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  for (let start = 0; start < uniquePaths.length; start += 100) {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(uniquePaths.slice(start, start + 100));
    if (error) throwStorageError(error);
  }
}
