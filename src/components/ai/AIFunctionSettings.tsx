import { useEffect, useState } from 'react';
import { AI_FUNCTIONS, CODEX_FUNCTION_MODELS, defaultAIFunctionSetting, getAIFunctionSettings, saveAIFunctionSetting, type AIFunctionKey, type AIFunctionProvider, type AIFunctionReasoningEffort, type AIFunctionSetting } from '../../lib/aiFunctionSettings';
import { useBusinessWriteAccess } from '../../hooks/useBusinessWriteAccess';

const REASONING_OPTIONS: Array<{ value: AIFunctionReasoningEffort; label: string }> = [
  { value: 'low', label: 'Bajo' },
  { value: 'medium', label: 'Medio' },
  { value: 'high', label: 'Alto' },
  { value: 'xhigh', label: 'Muy alto' },
];

const fieldClass = 'w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)]';

export default function AIFunctionSettings({ ownerUid }: { ownerUid: string }) {
  const { canWrite: canWriteBusiness } = useBusinessWriteAccess();
  const [settings, setSettings] = useState<AIFunctionSetting[]>(() => AI_FUNCTIONS.map(({ key }) => defaultAIFunctionSetting(ownerUid, key)));
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<AIFunctionKey | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setSettings(AI_FUNCTIONS.map(({ key }) => defaultAIFunctionSetting(ownerUid, key)));
    setNotice('');
    setLoading(true);
    setError('');
    void getAIFunctionSettings(ownerUid).then((next) => {
      if (active) setSettings(next);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los modelos por función.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [ownerUid]);

  const updateSetting = (functionKey: AIFunctionKey, update: Partial<AIFunctionSetting>) => {
    setSettings((current) => current.map((setting) => setting.function_key === functionKey
      ? { ...setting, ...update }
      : setting));
    setNotice('');
    setError('');
  };

  const changeProvider = (setting: AIFunctionSetting, provider: AIFunctionProvider) => {
    const modelId = provider === 'codex'
      ? (CODEX_FUNCTION_MODELS.some((model) => model.id === setting.model_id) ? setting.model_id : 'gpt-6-luna')
      : (setting.provider === 'claude' ? setting.model_id : '');
    updateSetting(setting.function_key, { provider, model_id: modelId });
  };

  const save = async (setting: AIFunctionSetting) => {
    if (!canWriteBusiness) return;
    setSavingKey(setting.function_key);
    setNotice('');
    setError('');
    try {
      const saved = await saveAIFunctionSetting(setting);
      updateSetting(setting.function_key, saved);
      setNotice(`Se guardó «${AI_FUNCTIONS.find((item) => item.key === setting.function_key)?.label ?? setting.function_key}».`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el modelo de esta función.');
    } finally {
      setSavingKey(null);
    }
  };

  return <section aria-labelledby="ai-function-settings-title" className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm md:p-6">
    <header>
      <h4 id="ai-function-settings-title" className="text-lg font-bold">Modelos por función</h4>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--ink-muted)]">Elegí el proveedor, modelo y razonamiento predeterminados de cada función. Cuando el flujo lo permite, también podés cambiar el modelo para una ejecución. Bajo consume menos uso de tu plan.</p>
    </header>
    {loading && <p role="status" className="text-sm text-[var(--ink-muted)]">Cargando configuración…</p>}
    {!loading && <fieldset disabled={!canWriteBusiness} className="min-w-0 space-y-3 border-0 p-0 disabled:opacity-70"><legend className="sr-only">Configuración editable de modelos</legend><div className="grid gap-3 xl:grid-cols-2">
      {AI_FUNCTIONS.map((item) => {
        const setting = settings.find((entry) => entry.function_key === item.key) ?? defaultAIFunctionSetting(ownerUid, item.key);
        return <article key={item.key} className="space-y-3 rounded-xl border border-[var(--line)] p-4">
          <div>
            <h5 className="font-semibold">{item.label}</h5>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{item.description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-xs font-semibold"><span>Proveedor</span><select aria-label={`${item.label}: proveedor`} disabled={savingKey !== null} value={setting.provider} onChange={(event) => changeProvider(setting, event.target.value as AIFunctionProvider)} className={`${fieldClass} disabled:opacity-60`}><option value="codex">Codex — mi PC</option><option value="claude">Claude Code — mi PC</option></select></label>
            <label className="block space-y-1.5 text-xs font-semibold"><span>Modelo</span>{setting.provider === 'codex'
              ? <select aria-label={`${item.label}: modelo`} disabled={savingKey !== null} value={setting.model_id} onChange={(event) => updateSetting(item.key, { model_id: event.target.value })} className={`${fieldClass} disabled:opacity-60`}>{CODEX_FUNCTION_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select>
              : <input aria-label={`${item.label}: modelo`} disabled={savingKey !== null} value={setting.model_id} onChange={(event) => updateSetting(item.key, { model_id: event.target.value })} placeholder="Identificador de Claude Code" maxLength={120} className={`${fieldClass} disabled:opacity-60`}/>}</label>
            <label className="block space-y-1.5 text-xs font-semibold sm:col-span-2"><span>Razonamiento</span><select aria-label={`${item.label}: razonamiento`} disabled={savingKey !== null} value={setting.reasoning_effort} onChange={(event) => updateSetting(item.key, { reasoning_effort: event.target.value as AIFunctionReasoningEffort })} className={`${fieldClass} disabled:opacity-60`}>{REASONING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
          {item.key === 'fb_copywriting' && <label className="block space-y-1.5 text-xs font-semibold"><span>Tono del negocio para publicaciones</span><textarea aria-label="Tono del negocio para publicaciones" disabled={savingKey !== null} value={setting.business_tone} onChange={(event) => updateSetting(item.key, { business_tone: event.target.value })} maxLength={500} rows={3} className={`${fieldClass} disabled:opacity-60`}/><span className="block font-normal text-[var(--ink-muted)]">Describe cómo querés que suenen los textos. No agrega datos del producto.</span></label>}
          <button type="button" disabled={savingKey !== null} onClick={() => void save(setting)} className="rounded-lg bg-[var(--action-bg)] px-3 py-2 text-xs font-bold text-[var(--action-ink)] disabled:opacity-50">{savingKey === item.key ? 'Guardando…' : 'Guardar configuración'}</button>
        </article>;
      })}
    </div></fieldset>}
    {notice && <p role="status" className="text-xs text-emerald-800 dark:text-emerald-300">{notice}</p>}
    {error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
  </section>;
}
