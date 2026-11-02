import { supabase } from './supabase';

export const AI_FUNCTIONS = [
  { key: 'ai_memory_extract', label: 'Extracción de memoria', description: 'Aprende recuerdos útiles de los Chats y las Tareas.' },
  { key: 'knowledge_organize', label: 'Organizar con IA', description: 'Prepara propuestas para los documentos de Conocimientos.' },
  { key: 'fb_copywriting', label: 'Redactar publicaciones', description: 'Escribe propuestas para Marketplace y grupos.' },
  { key: 'fb_supervisor_recover', label: 'Corregir pasos', description: 'Ayuda a ubicar y corregir controles durante una ejecución.' },
  { key: 'fb_supervisor_verify', label: 'Verificar resultados', description: 'Revisa evidencias de una ejecución supervisada.' },
  { key: 'fb_photo_review', label: 'Revisar fotos', description: 'Evalúa las fotos elegidas para una publicación.' },
] as const;

export type AIFunctionKey = (typeof AI_FUNCTIONS)[number]['key'];
export type AIFunctionProvider = 'codex' | 'claude';
export type AIFunctionReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type AIFunctionSetting = {
  user_id: string;
  function_key: AIFunctionKey;
  provider: AIFunctionProvider;
  model_id: string;
  reasoning_effort: AIFunctionReasoningEffort;
  business_tone: string;
};

export const CODEX_FUNCTION_MODELS = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
] as const;

const REASONING_EFFORTS: readonly AIFunctionReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const CODEX_MODEL_IDS = new Set<string>(CODEX_FUNCTION_MODELS.map((model) => model.id));

const DEFAULT_EFFORTS: Record<AIFunctionKey, AIFunctionReasoningEffort> = {
  ai_memory_extract: 'low',
  knowledge_organize: 'low',
  fb_copywriting: 'low',
  fb_supervisor_recover: 'low',
  fb_supervisor_verify: 'medium',
  fb_photo_review: 'low',
};

export function isCodexFunctionModel(value: string): value is (typeof CODEX_FUNCTION_MODELS)[number]['id'] {
  return CODEX_MODEL_IDS.has(value);
}

export function defaultAIFunctionSetting(userId: string, functionKey: AIFunctionKey): AIFunctionSetting {
  return {
    user_id: userId,
    function_key: functionKey,
    provider: 'codex',
    model_id: 'gpt-6-luna',
    reasoning_effort: DEFAULT_EFFORTS[functionKey],
    business_tone: 'Amable, claro y profesional, sin exageraciones.',
  };
}

function isAIFunctionKey(value: unknown): value is AIFunctionKey {
  return typeof value === 'string' && AI_FUNCTIONS.some((item) => item.key === value);
}

function normalizeSetting(userId: string, value: unknown, functionKey: AIFunctionKey): AIFunctionSetting {
  const fallback = defaultAIFunctionSetting(userId, functionKey);
  if (!value || typeof value !== 'object') return fallback;
  const row = value as Record<string, unknown>;
  const provider = row.provider === 'claude' ? 'claude' : row.provider === 'codex' ? 'codex' : fallback.provider;
  const modelId = typeof row.model_id === 'string' && row.model_id.length > 0 && row.model_id.length <= 120
    && (provider !== 'codex' || isCodexFunctionModel(row.model_id))
    ? row.model_id : fallback.model_id;
  const reasoningEffort = typeof row.reasoning_effort === 'string'
    && REASONING_EFFORTS.includes(row.reasoning_effort as AIFunctionReasoningEffort)
    ? row.reasoning_effort as AIFunctionReasoningEffort : fallback.reasoning_effort;
  const businessTone = typeof row.business_tone === 'string'
    && row.business_tone.trim().length > 0 && row.business_tone.length <= 500
    ? row.business_tone.trim() : fallback.business_tone;
  return { ...fallback, provider, model_id: modelId, reasoning_effort: reasoningEffort, business_tone: businessTone };
}

export async function getAIFunctionSettings(userId: string): Promise<AIFunctionSetting[]> {
  if (!userId) throw new Error('No se pudo identificar la cuenta para cargar los modelos.');
  const { data, error } = await supabase.from('ai_function_settings')
    .select('function_key, provider, model_id, reasoning_effort, business_tone')
    .eq('user_id', userId);
  if (error) throw new Error('No se pudieron cargar los modelos por función.');
  const rows = new Map<AIFunctionKey, unknown>();
  for (const row of data ?? []) {
    if (isAIFunctionKey(row.function_key)) rows.set(row.function_key, row);
  }
  return AI_FUNCTIONS.map(({ key }) => normalizeSetting(userId, rows.get(key), key));
}

export async function getAIFunctionSetting(userId: string, functionKey: AIFunctionKey): Promise<AIFunctionSetting> {
  const settings = await getAIFunctionSettings(userId);
  return settings.find((setting) => setting.function_key === functionKey) ?? defaultAIFunctionSetting(userId, functionKey);
}

export async function saveAIFunctionSetting(
  setting: AIFunctionSetting,
): Promise<AIFunctionSetting> {
  if (!setting.user_id || !AI_FUNCTIONS.some((item) => item.key === setting.function_key)) {
    throw new Error('La configuración de IA no es válida.');
  }
  if (setting.provider === 'codex' && !isCodexFunctionModel(setting.model_id)) {
    throw new Error('Elegí un modelo de Codex válido.');
  }
  if (setting.provider === 'claude' && !/^[A-Za-z0-9._:/-]{1,120}$/.test(setting.model_id)) {
    throw new Error('Ingresá un identificador de modelo de Claude Code válido.');
  }
  if (!REASONING_EFFORTS.includes(setting.reasoning_effort)) {
    throw new Error('Elegí un nivel de razonamiento válido.');
  }
  if (typeof setting.business_tone !== 'string' || setting.business_tone.trim().length < 1 || setting.business_tone.length > 500) {
    throw new Error('El tono de las publicaciones debe tener entre 1 y 500 caracteres.');
  }
  const { data, error } = await supabase.from('ai_function_settings').upsert({
    user_id: setting.user_id,
    function_key: setting.function_key,
    provider: setting.provider,
    model_id: setting.model_id,
    reasoning_effort: setting.reasoning_effort,
    business_tone: setting.business_tone.trim(),
  }, { onConflict: 'user_id,function_key' })
    .select('function_key, provider, model_id, reasoning_effort, business_tone')
    .single();
  if (error || !data) throw new Error('No se pudo guardar el modelo de esta función.');
  return normalizeSetting(setting.user_id, data, setting.function_key);
}
