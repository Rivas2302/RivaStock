import { supabase } from './supabase';

export const STORAGE_UPLOAD_DENIAL_MESSAGES = {
  project_storage_full: 'No hay espacio en la nube de RivaStock. Avisá a RivaTech.',
  suspended: 'La cuenta del negocio está suspendida.',
} as const;

export type StorageUploadDenialReason = keyof typeof STORAGE_UPLOAD_DENIAL_MESSAGES;

export class StorageUploadDeniedError extends Error {
  constructor(readonly reason: StorageUploadDenialReason) {
    super(STORAGE_UPLOAD_DENIAL_MESSAGES[reason]);
    this.name = 'StorageUploadDeniedError';
  }
}

export function storageUploadDenialMessage(error: unknown): string | null {
  if (error instanceof StorageUploadDeniedError) {
    return STORAGE_UPLOAD_DENIAL_MESSAGES[error.reason];
  }
  return null;
}

export async function assertStorageUploadAllowed(bucket: string, bytes: number): Promise<void> {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('Invalid upload size.');
  }

  const { data, error } = await supabase.rpc('storage_upload_check', {
    p_bucket: bucket,
    p_bytes: bytes,
  });
  if (error) throw error;

  const result = data as { allowed?: unknown; reason?: unknown } | null;
  if (result?.allowed === true) return;
  if (result?.allowed === false && typeof result.reason === 'string' && result.reason in STORAGE_UPLOAD_DENIAL_MESSAGES) {
    throw new StorageUploadDeniedError(result.reason as StorageUploadDenialReason);
  }

  throw new Error('No se pudo validar el espacio de almacenamiento.');
}
