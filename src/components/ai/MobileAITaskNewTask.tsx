import { useEffect, useMemo, useRef, useState, type FormEvent, type TouchEvent } from 'react';
import { Check, Image, Loader2, MessageSquareText, PenLine, Search, Wifi, WifiOff, X } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import { usePermission } from '../../hooks/usePermission';
import { useBusinessPlan } from '../../hooks/useBusinessPlan';
import { db, invalidateDbCache } from '../../lib/db';
import { getInventoryHoldings, getVisibleProductStock } from '../../lib/inventoryHoldings';
import { filterOwnInventoryProducts } from '../../lib/ownInventory';
import { getVisibleQuickPriceProducts, searchProducts } from '../../lib/quickPriceLookup';
import { productPhotos } from '../../lib/facebookPublications';
import { createFacebookCopywritingJob } from '../../lib/facebookCopywriting';
import { createFacebookPhotoReviewJob } from '../../lib/facebookPhotoReview';
import { getAIFunctionSetting, isCodexFunctionModel, type AIFunctionKey, type AIFunctionSetting } from '../../lib/aiFunctionSettings';
import { createAIJob, type AIJob, type AIBridgeState, type AIProviderId, type CodexModelId, type CodexReasoningEffort } from '../../lib/aiBridge';
import { modelLabel, reasoningLabel } from '../../lib/aiOptions';
import { formatCurrency } from '../../lib/utils';
import type { Product } from '../../types';
import MobileAIChatSettings from './MobileAIChatSettings';

type MobileTaskType = 'text_generation' | 'fb_copywriting' | 'fb_photo_review';

interface MobileAITaskNewTaskProps {
  bridgeState: AIBridgeState | null;
  canWrite: boolean;
  repeatJob?: AIJob | null;
  provider: AIProviderId;
  modelId: CodexModelId;
  reasoningEffort: CodexReasoningEffort;
  includeBusinessContext: boolean;
  includeProjectContext: boolean;
  onModelChange: (model: CodexModelId) => void;
  onReasoningChange: (effort: CodexReasoningEffort) => void;
  onBusinessContextChange: (enabled: boolean) => void;
  onProjectContextChange: (enabled: boolean) => void;
  onClose: () => void;
  onCreated: (jobId: string) => void;
}

interface ProductSnapshot {
  id?: string;
  name?: string;
  category?: string;
  price?: number;
}

function inputSnapshot(job?: AIJob | null): ProductSnapshot | null {
  if (!job || !['fb_copywriting', 'fb_photo_review'].includes(job.task_type)) return null;
  try {
    const value = JSON.parse(job.input) as { product?: ProductSnapshot; product_name?: string };
    return value.product ?? { name: value.product_name };
  } catch {
    return null;
  }
}

function repeatedTaskType(job?: AIJob | null): MobileTaskType {
  return job?.task_type === 'fb_copywriting' || job?.task_type === 'fb_photo_review'
    ? job.task_type
    : 'text_generation';
}

function copyCondition(job?: AIJob | null): 'new' | 'like_new' | 'good' | 'fair' {
  if (!job || job.task_type !== 'fb_copywriting') return 'new';
  try {
    const condition = (JSON.parse(job.input) as { condition?: unknown }).condition;
    return condition === 'like_new' || condition === 'good' || condition === 'fair' ? condition : 'new';
  } catch {
    return 'new';
  }
}

function DiscardTaskSheet({
  title = '¿Descartar esta tarea?',
  message = 'El texto que escribiste se va a perder.',
  confirmLabel = 'Descartar tarea',
  onClose,
  onDiscard,
}: { title?: string; message?: string; confirmLabel?: string; onClose: () => void; onDiscard: () => void }) {
  const sheet = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !sheet.current) return;
      const buttons = Array.from(sheet.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); previousFocus.current?.focus(); };
  }, [onClose]);

  const endTouch = (event: TouchEvent<HTMLElement>) => {
    const start = touchStartY.current;
    touchStartY.current = null;
    if (start !== null && event.changedTouches[0].clientY - start > 72) onClose();
  };

  return <div className="fixed inset-0 z-[90] flex items-end bg-black/50 lg:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={sheet} role="alertdialog" aria-modal="true" aria-labelledby="mobile-ai-discard-title" onTouchStart={(event) => { touchStartY.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={endTouch} className="w-full rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-[var(--ink)] shadow-2xl">
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line-strong)]" aria-hidden="true"/>
      <h2 id="mobile-ai-discard-title" className="text-lg font-bold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{message}</p>
      <div className="mt-5 grid grid-cols-2 gap-3"><button ref={cancel} type="button" onClick={onClose} className="min-h-12 rounded-xl border border-[var(--line)] font-semibold">Seguir editando</button><button type="button" onClick={onDiscard} className="min-h-12 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] px-3 font-bold text-[var(--danger-ink)]">{confirmLabel}</button></div>
    </section>
  </div>;
}

export default function MobileAITaskNewTask(props: MobileAITaskNewTaskProps) {
  const { ownerUid, holdingsEnabled, allowedInventoryOwnerIds, inventoryAccessError } = useAuth();
  const canUseStock = usePermission('stock', 'write');
  const { plan, loading: planLoading, error: planError } = useBusinessPlan();
  const aiModuleEnabled = plan?.limits.modules.ai === true;
  const automationModuleEnabled = aiModuleEnabled && plan?.limits.modules.automation === true;
  const [taskType, setTaskType] = useState<MobileTaskType>(() => repeatedTaskType(props.repeatJob));
  const [prompt, setPrompt] = useState(() => props.repeatJob?.task_type === 'text_generation' || props.repeatJob?.task_type === 'knowledge_organize' ? props.repeatJob.input : '');
  const [condition, setCondition] = useState<'new' | 'like_new' | 'good' | 'fair'>(() => copyCondition(props.repeatJob));
  const [products, setProducts] = useState<Product[]>([]);
  const [productStocks, setProductStocks] = useState<Record<string, number>>({});
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [productSearch, setProductSearch] = useState(() => inputSnapshot(props.repeatJob)?.name ?? '');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [functionSetting, setFunctionSetting] = useState<AIFunctionSetting | null>(null);
  const [functionSettingsLoading, setFunctionSettingsLoading] = useState(false);
  const [functionModelId, setFunctionModelId] = useState<CodexModelId>('gpt-6-luna');
  const [functionEffort, setFunctionEffort] = useState<CodexReasoningEffort>('low');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingTaskType, setPendingTaskType] = useState<MobileTaskType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const loadedRepeatId = useRef<string | null>(null);

  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const photoUrls = selectedProduct ? productPhotos(selectedProduct) : [];
  const specialTask = taskType !== 'text_generation';
  const currentProvider = taskType === 'text_generation' ? props.provider : functionSetting?.provider ?? 'codex';
  const currentModel = taskType === 'text_generation' ? props.modelId : functionModelId;
  const currentEffort = taskType === 'text_generation' ? props.reasoningEffort : functionEffort;
  const shownProducts = useMemo(() => {
    if (!productSearch.trim()) return products.slice(0, 100);
    return searchProducts(products, productSearch).slice(0, 100);
  }, [productSearch, products]);
  const taskOptions = [
    ...(aiModuleEnabled ? [{ type: 'text_generation' as const, title: 'Texto libre', subtitle: 'Respuestas, ideas, resúmenes', Icon: MessageSquareText }] : []),
    ...(automationModuleEnabled && canUseStock ? [
      { type: 'fb_copywriting' as const, title: 'Publicación para Facebook', subtitle: 'Título y descripción de un producto', Icon: PenLine },
      { type: 'fb_photo_review' as const, title: 'Revisar fotos', subtitle: 'Orden, portada y mejoras', Icon: Image },
    ] : []),
  ];

  useEffect(() => {
    if (!specialTask || !ownerUid) return;
    let active = true;
    setProductsLoading(true);
    setProductsError('');
    if (inventoryAccessError) {
      setProductsError(inventoryAccessError);
      setProductsLoading(false);
      return () => { active = false; };
    }
    invalidateDbCache('products', 'inventory_holdings');
    void Promise.all([
      db.list<Product>('products', ownerUid),
      holdingsEnabled ? getInventoryHoldings(ownerUid) : Promise.resolve([]),
    ]).then(([loadedProducts, holdings]) => {
      if (!active) return;
      const visibleProducts = getVisibleQuickPriceProducts({
        products: filterOwnInventoryProducts(loadedProducts),
        holdings,
        holdingsEnabled,
        allowedInventoryOwnerIds,
      });
      const allowedOwnerIds = new Set(allowedInventoryOwnerIds);
      const visibleHoldings = holdings.filter((holding) => holding.active && allowedOwnerIds.has(holding.inventoryOwnerId));
      setProducts(visibleProducts);
      setProductStocks(Object.fromEntries(visibleProducts.map((product) => [
        product.id,
        holdingsEnabled ? getVisibleProductStock(product.id, visibleHoldings) : product.stock,
      ])));
    }).catch((cause: unknown) => {
      if (active) setProductsError(cause instanceof Error ? cause.message : 'No se pudieron cargar los productos.');
    }).finally(() => { if (active) setProductsLoading(false); });
    return () => { active = false; };
  }, [specialTask, ownerUid, holdingsEnabled, allowedInventoryOwnerIds, inventoryAccessError]);

  useEffect(() => {
    if (!specialTask || !ownerUid) { setFunctionSetting(null); return; }
    let active = true;
    const functionKey: AIFunctionKey = taskType === 'fb_copywriting' ? 'fb_copywriting' : 'fb_photo_review';
    setFunctionSettingsLoading(true);
    void getAIFunctionSetting(ownerUid, functionKey).then((setting) => {
      if (!active) return;
      setFunctionSetting(setting);
      if (setting.provider === 'codex' && isCodexFunctionModel(setting.model_id)) setFunctionModelId(setting.model_id);
      setFunctionEffort(setting.reasoning_effort);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los ajustes de IA.');
    }).finally(() => { if (active) setFunctionSettingsLoading(false); });
    return () => { active = false; };
  }, [specialTask, ownerUid, taskType]);

  useEffect(() => {
    const job = props.repeatJob;
    if (!job || loadedRepeatId.current === job.id || productsLoading || products.length === 0) return;
    loadedRepeatId.current = job.id;
    const snapshot = inputSnapshot(job);
    if (!snapshot) return;
    if (snapshot.id) {
      const product = products.find((candidate) => candidate.id === snapshot.id);
      if (product) setSelectedProductId(product.id);
      return;
    }
    if (!snapshot.name) return;
    const normalized = (value: string) => value.trim().toLocaleLowerCase('es-AR');
    const matches = products.filter((product) => normalized(product.name) === normalized(snapshot.name ?? '')
      && normalized(product.category ?? '') === normalized(snapshot.category ?? '')
      && (typeof snapshot.price !== 'number' || product.salePrice === snapshot.price));
    if (matches.length === 1) setSelectedProductId(matches[0].id);
  }, [props.repeatJob, productsLoading, products]);

  const close = () => {
    if (prompt.trim()) { setDiscardOpen(true); return; }
    props.onClose();
  };

  const selectTaskType = (next: MobileTaskType) => {
    if (next === taskType) return;
    if (prompt.trim()) {
      setPendingTaskType(next);
      setDiscardOpen(true);
      return;
    }
    setTaskType(next);
    setSelectedProductId('');
    setError('');
  };

  const canSubmit = props.canWrite && !planLoading && !planError && aiModuleEnabled
    && (taskType === 'text_generation' || automationModuleEnabled && canUseStock)
    && !submitting && !functionSettingsLoading && (taskType === 'text_generation'
    ? prompt.trim().length > 0
    : canUseStock && Boolean(selectedProduct) && (taskType !== 'fb_photo_review' || (photoUrls.length >= 1 && photoUrls.length <= 10)));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      let jobId: string;
      if (taskType === 'text_generation') {
        const key = crypto.randomUUID();
        jobId = (await createAIJob(prompt.trim(), props.provider, key, {
          includeBusinessContext: props.provider !== 'mock' && props.includeBusinessContext,
          includeProjectContext: props.provider !== 'mock' && props.includeProjectContext,
          modelId: props.modelId,
          reasoningEffort: props.reasoningEffort,
        })).id;
      } else {
        if (!ownerUid || !selectedProduct) throw new Error('Elegí un producto para continuar.');
        const functionKey: AIFunctionKey = taskType === 'fb_copywriting' ? 'fb_copywriting' : 'fb_photo_review';
        const setting = functionSetting ?? await getAIFunctionSetting(ownerUid, functionKey);
        const taskSettings = {
          provider: setting.provider,
          model_id: setting.provider === 'codex' ? functionModelId : setting.model_id,
          reasoning_effort: functionEffort,
        };
        jobId = taskType === 'fb_copywriting'
          ? await createFacebookCopywritingJob(selectedProduct.id, condition, taskSettings)
          : await createFacebookPhotoReviewJob(selectedProduct.id, photoUrls, taskSettings);
      }
      props.onCreated(jobId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la tarea.');
    } finally {
      setSubmitting(false);
    }
  };

  const bridgeStatus = props.bridgeState === 'idle'
    ? { label: 'Tu PC está conectada. Te avisamos cuando esté lista.', Icon: Wifi, className: 'text-[var(--success-ink)]' }
    : props.bridgeState === 'busy'
      ? { label: 'Tu PC está trabajando. La tarea queda en espera.', Icon: Loader2, className: 'text-[var(--brand)]' }
      : props.bridgeState === 'offline'
        ? { label: 'Tu PC está desconectada. Te avisamos cuando vuelva a conectarse.', Icon: WifiOff, className: 'text-[var(--ink-muted)]' }
        : { label: 'Consultando el estado de tu PC.', Icon: Loader2, className: 'text-[var(--ink-muted)]' };
  const BridgeIcon = bridgeStatus.Icon;
  const isCodex = currentProvider === 'codex';

  return <section aria-label="Nueva tarea de IA" className="-mx-4 flex min-h-[calc(100dvh-1rem)] flex-col bg-[var(--surface)] text-[var(--ink)] lg:hidden">
    <header className="flex min-h-14 items-center gap-3 border-b border-[var(--line)] px-4 py-2"><button type="button" onClick={close} aria-label="Cerrar nueva tarea" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-[var(--surface-muted)]"><X size={20}/></button><h1 className="text-[17px] font-bold">Nueva tarea</h1></header>

    <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
      <main className="flex-1 space-y-5 overflow-y-auto px-5 py-4 pb-6">
        {planLoading ? <p role="status" className="rounded-xl border border-[var(--line)] p-3 text-sm text-[var(--ink-muted)]">Verificando los módulos de tu plan…</p>
          : planError ? <p role="alert" className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">No se pudo verificar tu plan. Recargá la página antes de crear una tarea.</p>
            : !aiModuleEnabled ? <p role="alert" className="rounded-xl border border-[var(--line)] p-3 text-sm text-[var(--ink-muted)]">El módulo IA no está incluido en tu plan.</p> : null}
        <fieldset role="radiogroup" aria-label="Tipo de tarea" className="space-y-2"><legend className="sr-only">Tipo de tarea</legend>{taskOptions.map(({ type, title, subtitle, Icon }) => <button key={type} type="button" role="radio" aria-checked={taskType === type} onClick={() => selectTaskType(type)} className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border px-3.5 text-left ${taskType === type ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--line)] bg-[var(--surface-raised)] hover:bg-[var(--surface-muted)]'}`}><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${taskType === type ? 'bg-[var(--action-bg)] text-[var(--action-ink)]' : 'bg-[var(--surface-muted)] text-[var(--ink-muted)]'}`}><Icon size={19} aria-hidden="true"/></span><span className="min-w-0 flex-1"><span className="block text-[15px] font-bold">{title}</span><span className="mt-0.5 block text-[13px] text-[var(--ink-muted)]">{subtitle}</span></span>{taskType === type && <Check size={18} aria-label="Seleccionado" className="shrink-0 text-[var(--brand)]"/>}</button>)}</fieldset>

        {specialTask && <section aria-label="Elegir producto" className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-3.5">
          <label className="block space-y-2"><span className="text-sm font-bold">Producto</span><span className="relative block"><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]"/><input type="search" aria-label="Buscar producto del inventario" placeholder="Buscar producto…" value={productSearch} onChange={(event) => { setProductSearch(event.target.value); setSelectedProductId(''); }} className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] pl-10 pr-3 text-sm text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"/></span></label>
          {productsLoading ? <p role="status" className="flex items-center gap-2 text-sm text-[var(--ink-muted)]"><Loader2 size={15} className="animate-spin"/>Cargando productos…</p>
            : productsError ? <p role="alert" className="text-sm text-[var(--danger-ink)]">{productsError}</p>
              : selectedProduct ? <div className="flex items-center gap-3 rounded-xl border border-[var(--brand)] bg-[var(--brand-soft)] p-3"><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{selectedProduct.name}</strong><span className="mt-1 block text-xs text-[var(--ink-muted)]">{selectedProduct.category} · {formatCurrency(selectedProduct.salePrice)} · {productStocks[selectedProduct.id] ?? 0} en stock</span></span><button type="button" onClick={() => setSelectedProductId('')} aria-label="Cambiar producto" className="min-h-10 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold">Cambiar</button></div>
                : <><ul className="max-h-52 space-y-1 overflow-y-auto">{shownProducts.map((product) => <li key={product.id}><button type="button" onClick={() => { setSelectedProductId(product.id); setProductSearch(product.name); }} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-2.5 text-left hover:bg-[var(--surface-muted)]"><span className="min-w-0"><strong className="block truncate text-sm">{product.name}</strong><span className="text-xs text-[var(--ink-muted)]">{product.category} · {formatCurrency(product.salePrice)}</span></span><span className="shrink-0 text-xs text-[var(--ink-muted)]">{productStocks[product.id] ?? 0} en stock</span></button></li>)}</ul>{products.length > 100 && <p className="text-xs text-[var(--ink-muted)]">Mostrando hasta 100 productos. Refiná la búsqueda para encontrarlo.</p>}{shownProducts.length === 0 && <p className="text-sm text-[var(--ink-muted)]">No hay productos que coincidan con la búsqueda.</p>}</>}
          {taskType === 'fb_copywriting' && <label className="block space-y-1.5"><span className="text-sm font-bold">Condición</span><select value={condition} onChange={(event) => setCondition(event.target.value as typeof condition)} className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="new">Nuevo</option><option value="like_new">Usado, como nuevo</option><option value="good">Usado, buen estado</option><option value="fair">Usado, estado aceptable</option></select></label>}
          {taskType === 'fb_photo_review' && <p className="text-xs text-[var(--ink-muted)]">{photoUrls.length} {photoUrls.length === 1 ? 'foto seleccionada' : 'fotos seleccionadas'} · se admiten de 1 a 10.</p>}
        </section>}

        <label className="block space-y-2"><span className="text-[15px] font-bold">Contale qué necesitás</span><textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={specialTask} placeholder="Ej: escribí una respuesta amable para un cliente mayorista que pide precio por 10 cámaras" className="min-h-32 w-full resize-none rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-3.5 text-[15px] leading-6 text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-60"/>{specialTask && <span className="block text-xs leading-5 text-[var(--ink-muted)]">Esta tarea usa los datos del producto y los ajustes propios de la función. El texto libre se envía en Texto libre.</span>}</label>

        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setSettingsOpen(true)} aria-label="Abrir ajustes del modelo y razonamiento" className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-3.5 text-[13px] font-semibold text-[var(--ink-subtle)]">{modelLabel(currentModel)} · {reasoningLabel(currentEffort)}<span aria-hidden="true">⌄</span></button><button type="button" onClick={() => setSettingsOpen(true)} aria-label="Abrir ajustes de contexto" className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-3.5 text-[13px] font-semibold text-[var(--ink-subtle)]"><span className={`inline-flex size-4 items-center justify-center rounded-full border ${specialTask || props.includeBusinessContext ? 'border-[var(--success-line)] bg-[var(--success-surface)] text-[var(--success-ink)]' : 'border-[var(--line-strong)] text-transparent'}`}><Check size={11}/></span>{specialTask ? 'Datos del producto' : 'Datos del negocio'}</button></div>

        {error && <p role="alert" className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">{error}</p>}
      </main>

      <footer className="space-y-2.5 border-t border-[var(--line)] bg-[var(--surface)] px-5 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]"><p className={`flex items-center gap-2 text-[13px] ${bridgeStatus.className}`}><BridgeIcon size={15} aria-hidden="true" className={props.bridgeState === 'busy' || props.bridgeState === null ? 'motion-safe:animate-spin motion-reduce:animate-none' : undefined}/>{bridgeStatus.label}</p><button type="submit" disabled={!canSubmit} className="min-h-[52px] w-full rounded-2xl bg-[var(--action-bg)] px-4 text-base font-bold text-[var(--action-ink)] disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Enviando…' : 'Enviar a mi PC'}</button></footer>
    </form>

    {settingsOpen && <MobileAIChatSettings
      title="Ajustes de esta tarea"
      provider={currentProvider}
      modelId={currentModel}
      reasoningEffort={currentEffort}
      includeBusinessContext={specialTask ? false : props.includeBusinessContext}
      includeProjectContext={specialTask ? false : props.includeProjectContext}
      isExistingChat={false}
      projectContextAllowed={!specialTask}
      contextControlsDisabled={specialTask}
      contextLockedText={specialTask ? 'Esta tarea recibe los datos del producto y la configuración propia de su función.' : undefined}
      onModelChange={(model) => { if (specialTask) setFunctionModelId(model); else props.onModelChange(model); }}
      onReasoningChange={(effort) => { if (specialTask) setFunctionEffort(effort); else props.onReasoningChange(effort); }}
      onBusinessContextChange={props.onBusinessContextChange}
      onProjectContextChange={props.onProjectContextChange}
      onClose={() => setSettingsOpen(false)}
    />}
    {discardOpen && <DiscardTaskSheet
      title={pendingTaskType ? '¿Cambiar tipo de tarea?' : undefined}
      message={pendingTaskType ? 'El texto que escribiste no se va a enviar con este tipo de tarea.' : undefined}
      confirmLabel={pendingTaskType ? 'Cambiar tipo' : undefined}
      onClose={() => { setDiscardOpen(false); setPendingTaskType(null); }}
      onDiscard={() => {
        setDiscardOpen(false);
        if (pendingTaskType) {
          setTaskType(pendingTaskType);
          setSelectedProductId('');
          setPrompt('');
          setPendingTaskType(null);
          return;
        }
        props.onClose();
      }}
    />}
  </section>;
}
