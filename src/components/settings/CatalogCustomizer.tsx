import { useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from 'lucide-react';
import type { CatalogConfig, Category, Product } from '../../types';
import { cn } from '../../lib/utils';
import {
  CATALOG_SECTION_LABELS, CATALOG_THEME_OPTIONS, defaultCatalogPresentation,
  getActiveCatalogTheme, moveCatalogSection, moveCatalogSectionToIndex, normalizeCatalogSections,
  type CatalogPresentation, type CatalogThemeId,
} from '../../lib/catalogPresentation';

interface CatalogCustomizerProps {
  config: CatalogConfig;
  categories: Category[];
  products: Product[];
  canEdit: boolean;
  onSave: (presentation: CatalogPresentation) => Promise<void>;
  onUploadCover: (file: File) => Promise<string>;
}

export default function CatalogCustomizer({ config, categories, products, canEdit, onSave, onUploadCover }: CatalogCustomizerProps) {
  const [draft, setDraft] = useState<CatalogPresentation>(() => {
    const defaults = defaultCatalogPresentation(config);
    return {
      ...defaults,
      ...config.presentation,
      sections: normalizeCatalogSections(config.presentation?.sections),
      schedules: config.presentation?.schedules ?? [],
      featuredProductIds: config.presentation?.featuredProductIds ?? defaults.featuredProductIds,
      offerProductIds: config.presentation?.offerProductIds ?? defaults.offerProductIds,
      offerDiscountPercentByProduct: config.presentation?.offerDiscountPercentByProduct ?? defaults.offerDiscountPercentByProduct,
      ambience: { ...defaults.ambience, ...config.presentation?.ambience },
    };
  });
  const [scheduleTheme, setScheduleTheme] = useState<CatalogThemeId>('christmas');
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [draggedSection, setDraggedSection] = useState<string | null>(null);
  const [error, setError] = useState('');
  const activeTheme = getActiveCatalogTheme(draft);
  const theme = CATALOG_THEME_OPTIONS.find(option => option.id === activeTheme) ?? CATALOG_THEME_OPTIONS[0];

  const update = (changes: Partial<CatalogPresentation>) => setDraft(current => ({ ...current, ...changes }));
  const addSchedule = () => {
    if (!scheduleStart || !scheduleEnd || scheduleEnd < scheduleStart) {
      setError('Elegí un período válido para programar el tema.');
      return;
    }
    update({ schedules: [...draft.schedules, { id: crypto.randomUUID(), theme: scheduleTheme, startDate: scheduleStart, endDate: scheduleEnd }] });
    setError('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try { await onSave(draft); }
    catch { setError('No pudimos guardar la personalización. Intentá de nuevo.'); }
    finally { setSaving(false); }
  };

  return <section aria-labelledby="catalog-customizer-title" className="space-y-5 rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-4 text-[var(--ink)] sm:p-6">
    <header>
      <h3 id="catalog-customizer-title" className="text-lg font-bold">Personalizar catálogo</h3>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">Diseñá la portada y el orden de lo que ven tus clientes.</p>
    </header>

    <div data-testid="catalog-live-preview" className="relative isolate overflow-hidden rounded-2xl p-5 text-white sm:p-7" style={{ backgroundColor: draft.heroColor }}>
      {draft.heroImageUrl && <img src={draft.heroImageUrl} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover"/>}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-slate-950/70 via-slate-950/30 to-transparent"/>
      <svg aria-hidden="true" viewBox="0 0 120 120" className="pointer-events-none absolute -right-3 -top-4 -z-10 h-36 w-36 opacity-20" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="60" cy="60" r="38"/><path d="M60 8v104M8 60h104M24 24l72 72m0-72L24 96"/></svg>
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-white/75">Vista previa · {theme.label}</p>
      <h4 className="mt-4 max-w-xl text-2xl font-extrabold sm:text-4xl">{draft.heroTitle || config.businessName}</h4>
      <p className="mt-2 max-w-xl text-sm text-white/85 sm:text-base">{draft.heroDescription}</p>
      <span className="mt-5 inline-flex rounded-full px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: draft.accentColor }}>Ver productos</span>
    </div>

    <section aria-label="Tema" className="space-y-3">
      <h4 className="font-semibold">Tema</h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {CATALOG_THEME_OPTIONS.map(option => <button key={option.id} type="button" aria-pressed={draft.theme === option.id} onClick={() => update({ theme: option.id, heroColor: option.heroColor, accentColor: option.accentColor, heroTitle: option.title, heroDescription: option.description })} className={cn('min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-semibold', draft.theme === option.id ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--line)] hover:bg-[var(--surface-muted)]')}><span className="mr-2 inline-block size-3 rounded-full align-middle" style={{ background: option.accentColor }}/>{option.label}</button>)}
      </div>
    </section>

    <section aria-label="Programar tema" className="space-y-3 rounded-xl border border-[var(--line)] p-4">
      <div><h4 className="font-semibold">Programar tema</h4><p className="text-xs text-[var(--ink-muted)]">Si coinciden dos fechas, se usa el tema que empieza más tarde. Al terminar, vuelve a Normal.</p></div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs font-medium">Tema<select value={scheduleTheme} onChange={event => setScheduleTheme(event.target.value as CatalogThemeId)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-sm">{CATALOG_THEME_OPTIONS.filter(option => option.id !== 'custom').map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label className="text-xs font-medium">Desde<input type="date" value={scheduleStart} onChange={event => setScheduleStart(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-sm"/></label>
        <label className="text-xs font-medium">Hasta<input type="date" value={scheduleEnd} onChange={event => setScheduleEnd(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-sm"/></label>
        <button type="button" onClick={addSchedule} className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 text-sm font-semibold text-[var(--action-ink)]"><Plus size={17}/>Agregar fecha</button>
      </div>
      {draft.schedules.map(schedule => <div key={schedule.id} className="flex min-h-11 items-center justify-between gap-3 border-t border-[var(--line)] pt-2 text-sm"><span>{CATALOG_THEME_OPTIONS.find(option => option.id === schedule.theme)?.label}: {schedule.startDate} al {schedule.endDate}</span><button type="button" aria-label={`Eliminar tema programado ${schedule.startDate}`} onClick={() => update({ schedules: draft.schedules.filter(item => item.id !== schedule.id) })} className="flex size-11 items-center justify-center rounded-lg text-[var(--danger-ink)]"><Trash2 size={17}/></button></div>)}
    </section>

    <section aria-label="Ambientación del tema" className="space-y-3 rounded-xl border border-[var(--line)] p-4">
      <div><h4 className="font-semibold">Ambientación del tema</h4><p className="text-xs text-[var(--ink-muted)]">Los efectos son decorativos, livianos y no bloquean los toques.</p></div>
      <label className="block max-w-sm text-sm font-medium">Intensidad<select value={draft.ambience.intensity} onChange={event => update({ ambience: { ...draft.ambience, intensity: event.target.value as CatalogPresentation['ambience']['intensity'] } })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3"><option value="soft">Suave</option><option value="normal">Normal</option><option value="party">Fiesta</option></select></label>
      <div className="grid gap-2 sm:grid-cols-2">
        {([
          ['animatedEffects', 'Efectos animados en la pantalla'],
          ['headerDecoration', 'Adorno debajo del encabezado'],
          ['productDecoration', 'Decoración en las tarjetas'],
          ['countdown', 'Cuenta regresiva del tema'],
          ['themedFont', 'Tipografía del tema'],
          ['welcomeCard', 'Cartel de bienvenida'],
        ] as const).map(([key, label]) => <label key={key} className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] px-3 text-sm font-medium"><input type="checkbox" checked={draft.ambience[key]} onChange={event => update({ ambience: { ...draft.ambience, [key]: event.target.checked } })} className="size-5 accent-[var(--brand)]"/>{label}</label>)}
      </div>
      <label className="block text-sm font-medium">Texto de la cinta de anuncios<input value={draft.ambience.announcementText} maxLength={120} onChange={event => update({ ambience: { ...draft.ambience, announcementText: event.target.value } })} placeholder="Ej.: Envíos gratis en General Pico" className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3"/></label>
    </section>

    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium">Título de portada<input value={draft.heroTitle} maxLength={90} onChange={event => update({ heroTitle: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3"/></label>
      <label className="text-sm font-medium">Texto de portada<textarea value={draft.heroDescription} maxLength={240} onChange={event => update({ heroDescription: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2"/></label>
      <label className="text-sm font-medium">Color de portada<input type="color" value={draft.heroColor} onChange={event => update({ heroColor: event.target.value })} className="mt-1 block h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1"/></label>
      <label className="text-sm font-medium">Color principal<input type="color" value={draft.accentColor} onChange={event => update({ accentColor: event.target.value })} className="mt-1 block h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1"/></label>
    </div>
    <label className={cn('flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-[var(--line-strong)] px-3 text-sm font-semibold hover:bg-[var(--surface-muted)]', canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}><ImagePlus size={18}/> {draft.heroImageUrl ? 'Cambiar foto de portada' : 'Subir foto de portada'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!canEdit} className="sr-only" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { update({ heroImageUrl: await onUploadCover(file) }); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo subir la portada.'); } finally { event.target.value = ''; } }}/></label>

    <section aria-label="Secciones del catálogo" className="space-y-2">
      <h4 className="font-semibold">Secciones del catálogo</h4>
      {draft.sections.map((section, index) => <div key={section.id} draggable={canEdit} onDragStart={event => { setDraggedSection(section.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', section.id); }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const source = event.dataTransfer.getData('text/plain') || draggedSection; if (source) update({ sections: moveCatalogSectionToIndex(draft.sections, source as CatalogPresentation['sections'][number]['id'], index) }); setDraggedSection(null); }} onDragEnd={() => setDraggedSection(null)} className={cn('flex min-h-12 items-center gap-2 border-b border-[var(--line)]', canEdit && 'cursor-grab active:cursor-grabbing', draggedSection === section.id && 'opacity-50')}>
        <input type="checkbox" aria-label={`Mostrar ${CATALOG_SECTION_LABELS[section.id]}`} checked={section.visible} onChange={event => update({ sections: draft.sections.map(item => item.id === section.id ? { ...item, visible: event.target.checked } : item) })} className="size-5" style={{ accentColor: 'var(--brand)' }}/>
        <span className="min-w-0 flex-1 text-sm font-medium">{CATALOG_SECTION_LABELS[section.id]}</span>
        <button type="button" aria-label={`Subir ${CATALOG_SECTION_LABELS[section.id]}`} disabled={index === 0} onClick={() => update({ sections: moveCatalogSection(draft.sections, section.id, -1) })} className="flex size-11 items-center justify-center rounded-lg disabled:opacity-30"><ArrowUp size={17}/></button>
        <button type="button" aria-label={`Bajar ${CATALOG_SECTION_LABELS[section.id]}`} disabled={index === draft.sections.length - 1} onClick={() => update({ sections: moveCatalogSection(draft.sections, section.id, 1) })} className="flex size-11 items-center justify-center rounded-lg disabled:opacity-30"><ArrowDown size={17}/></button>
      </div>)}
    </section>

    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">Productos destacados<select value={draft.featuredCategoryId ?? ''} onChange={event => update({ featuredCategoryId: event.target.value || null })} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3"><option value="">Elegir manualmente</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      {!draft.featuredCategoryId && <fieldset className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[var(--line)] p-2"><legend className="px-1 text-xs font-medium">Elegí productos destacados</legend>{products.map(product => <label key={product.id} className="flex min-h-10 items-center gap-2 px-2 text-sm"><input type="checkbox" checked={draft.featuredProductIds.includes(product.id)} onChange={event => update({ featuredProductIds: event.target.checked ? [...draft.featuredProductIds, product.id] : draft.featuredProductIds.filter(id => id !== product.id) })} className="size-4" style={{ accentColor: 'var(--brand)' }}/><span className="truncate">{product.name}</span></label>)}{products.length === 0 && <p className="px-2 text-xs text-[var(--ink-muted)]">No hay productos disponibles.</p>}</fieldset>}
    </div>
    <section aria-label="Ofertas" className="space-y-2 rounded-xl border border-[var(--line)] p-3">
      <label className="block max-w-sm text-sm font-medium">Hasta<input type="datetime-local" value={draft.offerEndsAt ?? ''} onChange={event => update({ offerEndsAt: event.target.value || null })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3"/></label>
      <fieldset className="max-h-56 space-y-1 overflow-y-auto"><legend className="px-1 text-sm font-semibold">Ofertas con descuento</legend>{products.map(product => {
        const selected = draft.offerProductIds?.includes(product.id) ?? false;
        return <div key={product.id} className="flex min-h-11 items-center gap-2 px-2 text-sm">
          <input type="checkbox" aria-label={`Incluir ${product.name} en Ofertas`} checked={selected} onChange={event => update({ offerProductIds: event.target.checked ? [...(draft.offerProductIds ?? []), product.id] : (draft.offerProductIds ?? []).filter(id => id !== product.id) })} className="size-4" style={{ accentColor: 'var(--brand)' }}/>
          <span className="min-w-0 flex-1 truncate">{product.name}</span>
          {selected && <label className="flex items-center gap-1 text-xs">Descuento %<input aria-label={`Descuento de ${product.name}` } type="number" min="1" max="90" value={draft.offerDiscountPercentByProduct[product.id] ?? ''} onChange={event => update({ offerDiscountPercentByProduct: { ...draft.offerDiscountPercentByProduct, [product.id]: Number(event.target.value) } })} className="min-h-10 w-16 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2"/></label>}
        </div>;
      })}</fieldset>
      <p className="text-xs text-[var(--ink-muted)]">La sección aparece solo si el descuento es válido y la oferta todavía no venció.</p>
    </section>
    <div className="space-y-2">
      {[['showWhatsAppButton', 'Botón de WhatsApp en cada producto'], ['showProductsWithoutPhoto', 'Mostrar productos sin foto']].map(([key, label]) => <label key={key} className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] px-3 text-sm font-medium"><input type="checkbox" checked={draft[key as 'showWhatsAppButton' | 'showProductsWithoutPhoto']} onChange={event => update({ [key]: event.target.checked })} className="size-5 accent-[var(--brand)]"/>{label}</label>)}
      <p className="text-xs text-[var(--ink-muted)]">Los precios, stock y pedidos online siguen usando los controles existentes del catálogo.</p>
    </div>

    {error && <p role="alert" className="text-sm font-medium text-[var(--danger-ink)]">{error}</p>}
    <div className="flex flex-col-reverse gap-2 border-t border-[var(--line)] pt-4 sm:flex-row sm:justify-end">
      <a href={`/catalogo/${config.slug}`} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center rounded-xl border border-[var(--line)] px-5 text-sm font-semibold">Ver catálogo</a>
      <button type="button" onClick={() => void save()} disabled={saving || !canEdit} className="min-h-12 rounded-xl bg-[var(--action-bg)] px-6 text-sm font-bold text-[var(--action-ink)] disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar cambios'}</button>
    </div>
  </section>;
}
