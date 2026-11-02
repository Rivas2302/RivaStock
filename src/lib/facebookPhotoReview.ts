import { getAIBridgeState } from './aiBridge';
import { supabase } from './supabase';
import type { AIFunctionProvider, AIFunctionReasoningEffort } from './aiFunctionSettings';

const PHOTO_ISSUES = [
  'borrosa',
  'oscura',
  'fondo desordenado',
  'texto/marca de agua ajena',
  'no muestra el producto',
] as const;

export interface FacebookPhotoReview {
  photos: Array<{
    id: string;
    usable: boolean;
    issues: Array<(typeof PHOTO_ISSUES)[number]>;
    suggested_order: number;
  }>;
  recommended_cover_photo_id: string | null;
  cover_reason: string;
}

export async function createFacebookPhotoReviewJob(
  productId: string,
  photoUrls: string[],
  settings: { provider: AIFunctionProvider; model_id: string; reasoning_effort: AIFunctionReasoningEffort },
): Promise<string> {
  const bridge = await getAIBridgeState();
  if (bridge.state === 'offline') throw new Error('Conectá la PC vinculada antes de revisar las fotos con IA.');
  const { data, error } = await supabase.rpc('request_fb_photo_review', {
    p_product_id: productId,
    p_idempotency_key: crypto.randomUUID(),
    p_photo_urls: photoUrls,
    p_provider: settings.provider,
    p_model_id: settings.model_id,
    p_reasoning_effort: settings.provider === 'codex' ? settings.reasoning_effort : null,
  });
  if (error) throw new Error(error.message || 'No se pudo iniciar la revisión de fotos.');
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && 'job_id' in data && typeof data.job_id === 'string') return data.job_id;
  throw new Error('La solicitud de revisión devolvió un identificador inválido.');
}

export async function waitForFacebookPhotoReviewJob(
  jobId: string,
  photoCount: number,
  timeoutMs = 180_000,
): Promise<FacebookPhotoReview> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await supabase.from('ai_jobs')
      .select('status, output, error, task_type')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw new Error('No se pudo consultar el estado de la revisión.');
    if (!data || data.task_type !== 'fb_photo_review') throw new Error('La tarea de revisión ya no está disponible.');
    if (data.status === 'failed') throw new Error(data.error || 'La PC no pudo revisar las fotos.');
    if (data.status === 'completed') {
      if (typeof data.output !== 'string') throw new Error('La PC devolvió una revisión vacía.');
      return parseFacebookPhotoReview(data.output, photoCount);
    }
    await new Promise(resolve => window.setTimeout(resolve, 2000));
  }
  throw new Error('La PC todavía no respondió. Revisá IA → Conexión y volvé a intentarlo.');
}

export function parseFacebookPhotoReview(output: string, photoCount: number): FacebookPhotoReview {
  let parsed: unknown;
  try { parsed = JSON.parse(output); }
  catch { throw new Error('La revisión de fotos no es válida.'); }
  if (!isRecord(parsed) || Object.keys(parsed).sort().join(',') !== 'cover_reason,photos,recommended_cover_photo_id'
    || !Number.isInteger(photoCount) || photoCount < 1 || photoCount > 10
    || !Array.isArray(parsed.photos) || parsed.photos.length !== photoCount) {
    throw new Error('La revisión de fotos no cumple el formato requerido.');
  }
  const expectedIds = new Set(Array.from({ length: photoCount }, (_, index) => `IMG${String(index + 1).padStart(3, '0')}`));
  const ids = new Set<string>();
  const orders = new Set<number>();
  const photos = parsed.photos.map(value => {
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'id,issues,suggested_order,usable'
      || typeof value.id !== 'string' || !expectedIds.has(value.id) || ids.has(value.id)
      || typeof value.usable !== 'boolean'
      || !Number.isSafeInteger(value.suggested_order) || (value.suggested_order as number) < 1
      || (value.suggested_order as number) > photoCount || orders.has(value.suggested_order as number)
      || !Array.isArray(value.issues) || value.issues.length > PHOTO_ISSUES.length
      || !value.issues.every(issue => typeof issue === 'string' && PHOTO_ISSUES.includes(issue as (typeof PHOTO_ISSUES)[number]))
      || new Set(value.issues).size !== value.issues.length) {
      throw new Error('La evaluación de una foto no cumple el formato requerido.');
    }
    ids.add(value.id);
    orders.add(value.suggested_order as number);
    return {
      id: value.id,
      usable: value.usable,
      issues: value.issues as Array<(typeof PHOTO_ISSUES)[number]>,
      suggested_order: value.suggested_order as number,
    };
  });
  if (ids.size !== photoCount || orders.size !== photoCount) throw new Error('La revisión debe incluir todas las fotos y un orden único.');
  if (typeof parsed.cover_reason !== 'string' || !parsed.cover_reason.trim() || parsed.cover_reason.length > 300) {
    throw new Error('La recomendación de portada no tiene una explicación válida.');
  }
  const usableIds = new Set(photos.filter(photo => photo.usable).map(photo => photo.id));
  const coverId = parsed.recommended_cover_photo_id;
  if (usableIds.size === 0 ? coverId !== null : typeof coverId !== 'string' || !usableIds.has(coverId)) {
    throw new Error('La portada recomendada debe ser una foto utilizable.');
  }
  return { photos, recommended_cover_photo_id: coverId as string | null, cover_reason: parsed.cover_reason.trim() };
}

export async function appendFacebookProductPhoto(
  productId: string,
  sourcePhoto: string,
  newPhoto: string,
): Promise<{ images: string[]; image_url: string | null; updated_at: string }> {
  const { data, error } = await supabase.rpc('append_facebook_product_photo', {
    p_product_id: productId,
    p_source_photo: sourcePhoto,
    p_new_photo: newPhoto,
  });
  if (error) throw new Error(error.message || 'No se pudo guardar la foto mejorada.');
  if (!isRecord(data) || !Array.isArray(data.images) || !data.images.every(item => typeof item === 'string')
    || !(typeof data.image_url === 'string' || data.image_url === null) || typeof data.updated_at !== 'string') {
    throw new Error('La actualización de fotos devolvió datos inválidos.');
  }
  return { images: data.images as string[], image_url: data.image_url as string | null, updated_at: data.updated_at as string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
