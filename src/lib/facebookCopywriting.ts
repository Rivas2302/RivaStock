import { getAIBridgeState } from './aiBridge';
import { supabase } from './supabase';
import { marketplaceCategories } from '../../extensions/facebook/marketplace-contract.js';
import type { PublicationContent } from './facebookPublications';
import type { AIFunctionProvider, AIFunctionReasoningEffort } from './aiFunctionSettings';

export interface FacebookCopywritingProposal {
  title: string;
  description: string;
  group_text: string;
  category: string;
  condition: PublicationContent['condition'];
  warnings: string[];
}

const CONDITIONS: readonly PublicationContent['condition'][] = ['new', 'like_new', 'good', 'fair'];
const PRICE_PATTERN = /(?:\$\s*\d|\b(?:ARS|USD|pesos?)\s*\d|\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*(?:pesos?|ARS|USD)\b)/i;

export async function createFacebookCopywritingJob(
  productId: string,
  condition: PublicationContent['condition'],
  settings: { provider: AIFunctionProvider; model_id: string; reasoning_effort: AIFunctionReasoningEffort },
): Promise<string> {
  const bridge = await getAIBridgeState();
  if (bridge.state === 'offline') throw new Error('Conectá la PC vinculada antes de redactar con IA.');
  const { data, error } = await supabase.rpc('request_fb_copywriting', {
    p_product_id: productId,
    p_idempotency_key: crypto.randomUUID(),
    p_condition: condition,
    p_provider: settings.provider,
    p_model_id: settings.model_id,
    p_reasoning_effort: settings.provider === 'codex' ? settings.reasoning_effort : null,
  });
  if (error) throw new Error(error.message || 'No se pudo iniciar la redacción con IA.');
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && 'job_id' in data && typeof data.job_id === 'string') return data.job_id;
  throw new Error('La solicitud de redacción devolvió un identificador inválido.');
}

export async function waitForFacebookCopywritingJob(
  jobId: string,
  expectedCondition: PublicationContent['condition'],
  timeoutMs = 180_000,
): Promise<FacebookCopywritingProposal> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await supabase.from('ai_jobs')
      .select('status, output, error')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw new Error('No se pudo consultar el estado de la redacción.');
    if (!data) throw new Error('La tarea de redacción ya no está disponible.');
    if (data.status === 'failed') throw new Error(data.error || 'La PC no pudo redactar la propuesta.');
    if (data.status === 'completed') {
      if (typeof data.output !== 'string') throw new Error('La PC devolvió una propuesta vacía.');
      return parseFacebookCopywritingProposal(data.output, expectedCondition);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error('La PC todavía no respondió. Revisá IA → Conexión y volvé a intentarlo.');
}

export function parseFacebookCopywritingProposal(
  output: string,
  expectedCondition: PublicationContent['condition'],
): FacebookCopywritingProposal {
  let parsed: unknown;
  try { parsed = JSON.parse(output); }
  catch { throw new Error('La PC devolvió una propuesta inválida.'); }
  if (!isRecord(parsed)) throw new Error('La propuesta de redacción no es válida.');
  const keys = ['title', 'description', 'group_text', 'category', 'condition', 'warnings'];
  if (Object.keys(parsed).sort().join(',') !== keys.sort().join(',')) {
    throw new Error('La propuesta de redacción contiene campos inesperados.');
  }
  const title = boundedText(parsed.title, 1, 100, 'El título');
  const description = boundedText(parsed.description, 1, 2000, 'La descripción');
  const groupText = boundedText(parsed.group_text, 1, 2000, 'El texto para grupos');
  if (/[\p{L}]/u.test(title) && title === title.toLocaleUpperCase('es-AR')) {
    throw new Error('El título no puede estar escrito completamente en mayúsculas.');
  }
  if ([...title.matchAll(/\p{Extended_Pictographic}/gu)].length > 1) {
    throw new Error('El título contiene demasiados emojis.');
  }
  if ([title, description, groupText].some((value) => /(?:https?:\/\/|www\.)\S+/i.test(value))) {
    throw new Error('La propuesta no puede incluir enlaces externos.');
  }
  if ([title, description, groupText].some((value) => PRICE_PATTERN.test(value))) {
    throw new Error('La propuesta no puede incluir un precio escrito; se usa el precio del producto.');
  }
  if (typeof parsed.category !== 'string' || !marketplaceCategories.includes(parsed.category)) {
    throw new Error('La categoría propuesta no está permitida.');
  }
  if (typeof parsed.condition !== 'string' || !CONDITIONS.includes(parsed.condition as PublicationContent['condition'])
    || parsed.condition !== expectedCondition) {
    throw new Error('La propuesta cambió la condición elegida para el producto.');
  }
  if (!Array.isArray(parsed.warnings) || parsed.warnings.length > 20
    || !parsed.warnings.every((warning) => typeof warning === 'string' && warning.trim().length > 0 && warning.length <= 250)) {
    throw new Error('Las advertencias de la propuesta no son válidas.');
  }
  return {
    title,
    description,
    group_text: groupText,
    category: parsed.category,
    condition: parsed.condition as PublicationContent['condition'],
    warnings: [...new Set((parsed.warnings as string[]).map((warning) => warning.trim()))],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, min: number, max: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new Error(`${label} debe tener entre ${min} y ${max} caracteres.`);
  }
  return value.trim();
}
