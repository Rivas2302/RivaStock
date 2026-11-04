import { useEffect, useRef, type TouchEvent } from 'react';
import { Check, X } from 'lucide-react';
import type { AIProviderId, CodexModelId, CodexReasoningEffort } from '../../lib/aiBridge';
import { CODEX_MODELS, modelLabel, reasoningLabel } from '../../lib/aiOptions';

interface MobileAIChatSettingsProps {
  provider: AIProviderId;
  modelId: CodexModelId;
  reasoningEffort: CodexReasoningEffort;
  includeBusinessContext: boolean;
  includeProjectContext: boolean;
  isExistingChat: boolean;
  projectContextAllowed: boolean;
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
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const startY = useRef<number | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const modelLocked = props.isExistingChat || props.provider !== 'codex';
  const modelDescription = props.provider === 'codex'
    ? modelLabel(props.modelId).replace(/^GPT-6(?:\.1)?\s+\w+\s+—\s*/, '')
    : 'El proveedor de este chat no permite cambiar el modelo desde acá.';

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sheetRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sheetRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, [props.onClose]);

  const endTouch = (event: TouchEvent<HTMLElement>) => {
    const start = startY.current;
    startY.current = null;
    if (start !== null && event.changedTouches[0].clientY - start > 72) props.onClose();
  };

  return <div className="fixed inset-0 z-[90] flex items-end bg-black/50 lg:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <section
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-ai-chat-settings-title"
      onTouchStart={(event) => { startY.current = event.touches[0]?.clientY ?? null; }}
      onTouchEnd={endTouch}
      className="max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-[var(--ink)] shadow-2xl"
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--line-strong)]" aria-hidden="true"/>
      <header className="mb-4 flex items-center justify-between gap-4">
        <div><h2 id="mobile-ai-chat-settings-title" className="text-lg font-bold">Ajustes de este chat</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">{props.provider === 'codex' ? 'Codex' : props.provider === 'claude' ? 'Claude Code' : 'Mock'} en tu PC</p></div>
        <button ref={closeRef} type="button" onClick={props.onClose} aria-label="Cerrar ajustes" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"><X size={20}/></button>
      </header>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-bold">Modelo</legend>
        {CODEX_MODELS.map((model) => <button
          key={model.id}
          type="button"
          disabled={modelLocked}
          aria-pressed={props.modelId === model.id}
          onClick={() => props.onModelChange(model.id)}
          className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-70 ${props.modelId === model.id ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--line)] bg-[var(--surface)]'}`}
        ><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{model.label.split(' — ')[0]}</span><span className="block text-xs text-[var(--ink-muted)]">{model.id === props.modelId ? `${modelDescription} · recomendado` : model.id === 'gpt-6-astra' ? 'Máxima capacidad · consume más' : model.label.split(' — ')[1]}</span></span>{props.modelId === model.id && <Check size={17} aria-label="Seleccionado" className="shrink-0 text-[var(--brand)]"/>}</button>)}
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
            className={`min-h-10 rounded-lg px-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-70 ${props.reasoningEffort === effort.id ? 'bg-[var(--action-bg)] text-[var(--action-ink)] shadow-sm' : 'text-[var(--ink-muted)] hover:bg-[var(--surface)]'}`}
          >{effort.label}</button>)}
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">{REASONING.find((item) => item.id === props.reasoningEffort)?.description ?? `Nivel actual: ${reasoningLabel(props.reasoningEffort)}.`}</p>
      </fieldset>

      <fieldset className="mt-5 space-y-3">
        <legend className="mb-2 text-sm font-bold">Qué puede consultar</legend>
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"><span className="min-w-0 flex-1"><span className="block font-semibold">Datos del negocio</span><span className="text-xs text-[var(--ink-muted)]">Catálogo, precios e inventario</span></span><input type="checkbox" checked={props.includeBusinessContext} onChange={(event) => props.onBusinessContextChange(event.target.checked)} className="size-5 accent-[var(--brand)]"/></label>
        {props.projectContextAllowed && <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"><span className="min-w-0 flex-1"><span className="block font-semibold">Proyecto RivaStock</span><span className="text-xs text-[var(--ink-muted)]">Documentación técnica del sistema</span></span><input type="checkbox" checked={props.includeProjectContext} onChange={(event) => props.onProjectContextChange(event.target.checked)} className="size-5 accent-[var(--brand)]"/></label>}
        <p className="rounded-xl bg-[var(--brand-soft)] px-3 py-2 text-xs leading-5 text-[var(--ink-subtle)]">Tus Skills, la memoria y Conocimientos se usan siempre.</p>
      </fieldset>

      <button type="button" onClick={props.onClose} className="mt-5 min-h-12 w-full rounded-xl bg-[var(--action-bg)] px-4 text-sm font-bold text-[var(--action-ink)] hover:bg-[var(--action-bg-hover)]">Listo</button>
    </section>
  </div>;
}
