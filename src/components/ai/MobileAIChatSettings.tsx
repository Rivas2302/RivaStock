import { Check } from 'lucide-react';
import type { AIProviderId, CodexModelId, CodexReasoningEffort } from '../../lib/aiBridge';
import { CODEX_MODELS, modelLabel, reasoningLabel } from '../../lib/aiOptions';
import BottomSheet from '../mobile/BottomSheet';

interface MobileAIChatSettingsProps {
  provider: AIProviderId;
  modelId: CodexModelId;
  reasoningEffort: CodexReasoningEffort;
  includeBusinessContext: boolean;
  includeProjectContext: boolean;
  isExistingChat: boolean;
  projectContextAllowed: boolean;
  title?: string;
  contextControlsDisabled?: boolean;
  contextLockedText?: string;
  onModelChange: (model: CodexModelId) => void;
  onReasoningChange: (effort: CodexReasoningEffort) => void;
  onBusinessContextChange: (enabled: boolean) => void;
  onProjectContextChange: (enabled: boolean) => void;
  onClose: () => void;
}

const REASONING: Array<{ id: CodexReasoningEffort; label: string; description: string }> = [
  { id: 'low', label: 'Bajo', description: 'Bajo gasta menos de tu plan. Subilo solo para preguntas difíciles.' },
  { id: 'medium', label: 'Medio', description: 'Equilibra velocidad y análisis.' },
  { id: 'high', label: 'Alto', description: 'Analiza con más detalle.' },
  { id: 'xhigh', label: 'Muy alto', description: 'Para pedidos que requieren mucho análisis.' },
];

export default function MobileAIChatSettings(props: MobileAIChatSettingsProps) {
  const modelLocked = props.isExistingChat || props.provider !== 'codex';
  const modelDescription = props.provider === 'codex'
    ? modelLabel(props.modelId).replace(/^GPT-6(?:\.1)?\s+\w+\s+—\s*/, '')
    : 'El proveedor de este chat no permite cambiar el modelo desde acá.';

  return <BottomSheet
    title={props.title ?? 'Ajustes de este chat'}
    titleId="mobile-ai-chat-settings-title"
    description={props.provider === 'codex' ? 'Codex en tu PC' : props.provider === 'claude' ? 'Claude Code en tu PC' : 'Mock en tu PC'}
    closeLabel="Cerrar ajustes"
    onClose={props.onClose}
  >
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-bold">Modelo</legend>
      {CODEX_MODELS.map((model) => <button
        key={model.id}
        type="button"
        disabled={modelLocked}
        aria-pressed={props.modelId === model.id}
        onClick={() => props.onModelChange(model.id)}
        className={['flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-70', props.modelId === model.id ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--line)] bg-[var(--surface)]'].join(' ')}
      ><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{model.label.split(' — ')[0]}</span><span className="block text-xs text-[var(--ink-muted)]">{model.id === props.modelId ? modelDescription + ' · recomendado' : model.id === 'gpt-6-astra' ? 'Máxima capacidad · consume más' : model.label.split(' — ')[1]}</span></span>{props.modelId === model.id && <Check size={17} aria-label="Seleccionado" className="shrink-0 text-[var(--brand)]"/>}</button>)}
      {props.isExistingChat && <p className="text-xs leading-5 text-[var(--ink-muted)]">El modelo y el razonamiento quedan fijos al crear el chat para conservar la sesión de tu PC.</p>}
      {props.provider !== 'codex' && <p className="text-xs leading-5 text-[var(--ink-muted)]">Este chat usa {props.provider === 'claude' ? 'Claude Code' : 'Mock'}; los modelos Codex no se aplican.</p>}
    </fieldset>

    <fieldset className="mt-5">
      <legend className="mb-2 text-sm font-bold">Razonamiento</legend>
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-[var(--surface-muted)] p-1">
        {REASONING.map((effort) => <button
          key={effort.id}
          type="button"
          disabled={modelLocked}
          aria-pressed={props.reasoningEffort === effort.id}
          onClick={() => props.onReasoningChange(effort.id)}
          className={['min-h-10 rounded-lg px-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-70', props.reasoningEffort === effort.id ? 'bg-[var(--action-bg)] text-[var(--action-ink)] shadow-sm' : 'text-[var(--ink-muted)] hover:bg-[var(--surface)]'].join(' ')}
        >{effort.label}</button>)}
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">{REASONING.find((item) => item.id === props.reasoningEffort)?.description ?? 'Nivel actual: ' + reasoningLabel(props.reasoningEffort) + '.'}</p>
    </fieldset>

    <fieldset className="mt-5 space-y-3">
      <legend className="mb-2 text-sm font-bold">Qué puede consultar</legend>
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"><span className="min-w-0 flex-1"><span className="block font-semibold">Datos del negocio</span><span className="text-xs text-[var(--ink-muted)]">Catálogo, precios e inventario</span></span><input type="checkbox" checked={props.includeBusinessContext} disabled={props.contextControlsDisabled} onChange={(event) => props.onBusinessContextChange(event.target.checked)} className="size-5 accent-[var(--brand)] disabled:opacity-60"/></label>
      {props.projectContextAllowed && <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"><span className="min-w-0 flex-1"><span className="block font-semibold">Proyecto RivaStock</span><span className="text-xs text-[var(--ink-muted)]">Documentación técnica del sistema</span></span><input type="checkbox" checked={props.includeProjectContext} disabled={props.contextControlsDisabled} onChange={(event) => props.onProjectContextChange(event.target.checked)} className="size-5 accent-[var(--brand)] disabled:opacity-60"/></label>}
      <p className="rounded-xl bg-[var(--brand-soft)] px-3 py-2 text-xs leading-5 text-[var(--ink-subtle)]">{props.contextLockedText ?? 'Tus Skills, la memoria y Conocimientos se usan siempre.'}</p>
    </fieldset>

    <button type="button" onClick={props.onClose} className="mt-5 min-h-12 w-full rounded-xl bg-[var(--action-bg)] px-4 text-sm font-bold text-[var(--action-ink)] hover:bg-[var(--action-bg-hover)]">Listo</button>
  </BottomSheet>;
}