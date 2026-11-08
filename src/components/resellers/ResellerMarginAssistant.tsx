import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  ResellerMarginRules,
  ResellerMarginTier,
  ResellerMarginValueRule,
} from '../../lib/resellerMarginRules';
import {
  calculateResellerMarginSuggestion,
  normalizeMarginCategory,
  validateResellerMarginRules,
} from '../../lib/resellerMarginRules';
import type { Product } from '../../types';
import { formatCurrency } from '../../lib/utils';
import MoneyInput from '../MoneyInput';

export interface MarginSimulatorProduct {
  id: string;
  name: string;
  category: string;
  cost: number;
  retailPrice: number;
  currentResellerPrice: number;
}

export interface MarginRulesImpact {
  increaseCount: number;
  decreaseCount: number;
  averageProfit: number | null;
}

interface ResellerMarginAssistantProps {
  rules: ResellerMarginRules;
  products: Product[];
  simulatorProducts: MarginSimulatorProduct[];
  impact: MarginRulesImpact;
  targetResellerDiscountPercent: number;
  canWrite: boolean;
  saveStatus: 'saved' | 'saving' | 'error';
  onChange: (rules: ResellerMarginRules) => void;
  onApplyToList: () => void;
}

function MarginRuleFields({
  rule,
  label,
  disabled,
  onChange,
}: {
  rule: ResellerMarginValueRule;
  label: string;
  disabled: boolean;
  onChange: (next: ResellerMarginValueRule) => void;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div role="group" aria-label={`Tipo de ${label}`} className="inline-flex rounded-lg bg-[var(--surface-2)] p-1">
        {(['percent', 'fixed'] as const).map(mode => (
          <button key={mode} type="button" aria-pressed={rule.mode === mode} disabled={disabled}
            onClick={() => onChange({ ...rule, mode })}
            className="min-h-8 rounded-md px-3 text-xs font-semibold text-[var(--ink-muted)] aria-pressed:bg-[var(--surface-1)] aria-pressed:text-[var(--ink)] aria-pressed:shadow-sm disabled:opacity-50">
            {mode === 'percent' ? '%' : '$'}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {rule.mode === 'percent' ? (
          <input aria-label={label} type="number" min="0" max="500" step="0.5" value={rule.value}
            disabled={disabled} onChange={event => onChange({ ...rule, value: Math.max(0, Number(event.target.value) || 0) })}
            className="min-h-10 w-28 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)] disabled:opacity-50" />
        ) : (
          <MoneyInput aria-label={label} min="0" value={rule.value} disabled={disabled}
            onChange={event => onChange({ ...rule, value: Math.max(0, Number(event.target.value) || 0) })}
            className="min-h-10 w-32 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)] disabled:opacity-50" />
        )}
        <span className="text-xs text-[var(--ink-muted)]">{rule.mode === 'percent' ? '% del costo' : 'de ganancia'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-[11px] font-medium text-[var(--ink-muted)]">Mínimo en pesos
          <MoneyInput aria-label={`Mínimo ${label}`} min="0" value={rule.minimumProfit ?? ''} disabled={disabled}
            onChange={event => onChange({ ...rule, minimumProfit: event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0) })}
            className="mt-1 min-h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2 text-xs text-[var(--ink)] disabled:opacity-50" />
        </label>
        <label className="min-w-0 text-[11px] font-medium text-[var(--ink-muted)]">Máximo en pesos
          <MoneyInput aria-label={`Máximo ${label}`} min="0" value={rule.maximumProfit ?? ''} disabled={disabled}
            onChange={event => onChange({ ...rule, maximumProfit: event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0) })}
            className="mt-1 min-h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2 text-xs text-[var(--ink)] disabled:opacity-50" />
        </label>
      </div>
    </div>
  );
}

export default function ResellerMarginAssistant({
  rules,
  products,
  simulatorProducts,
  impact,
  targetResellerDiscountPercent,
  canWrite,
  saveStatus,
  onChange,
  onApplyToList,
}: ResellerMarginAssistantProps) {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const categories = useMemo(() => Array.from(new Set(products.map(product => product.category.trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'es-AR')), [products]);
  const categoryLabelByKey = useMemo(() => new Map(categories.map(category => [normalizeMarginCategory(category), category])), [categories]);
  const simulatorRows = simulatorProducts.map(product => {
    const suggestion = calculateResellerMarginSuggestion(rules, product);
    const publicDenominator = Math.max(0.01, 1 - Math.min(99, targetResellerDiscountPercent) / 100);
    return {
      ...product,
      suggestion,
      suggestedPublicPrice: Math.round(suggestion.suggestedResellerPrice / publicDenominator),
    };
  });
  const categoriesWithoutOverride = categories.filter(category => !rules.categoryOverrides[normalizeMarginCategory(category)]);
  const productsWithoutOverride = products.filter(product => !rules.productOverrides[product.id]);
  const rulesError = validateResellerMarginRules(rules);

  const updateTier = (index: number, change: Partial<ResellerMarginTier>) => onChange({
    ...rules,
    tiers: rules.tiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, ...change } : tier),
  });
  const updateCategoryRule = (category: string, rule: ResellerMarginValueRule) => onChange({
    ...rules,
    categoryOverrides: { ...rules.categoryOverrides, [category]: rule },
  });
  const updateProductRule = (productId: string, rule: ResellerMarginValueRule) => onChange({
    ...rules,
    productOverrides: { ...rules.productOverrides, [productId]: rule },
  });

  return (
    <section aria-labelledby="reseller-margin-title" data-testid="reseller-margin-assistant" className="space-y-5 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="reseller-margin-title" className="text-base font-bold text-[var(--ink)]">Cómo calculás tu ganancia</h3>
          <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">Definí la ganancia por costo. Una regla de producto pisa la categoría, y una categoría pisa el escalón.</p>
        </div>
          <span role="status" className="text-xs font-semibold text-[var(--ink-muted)]">{saveStatus === 'saving' ? 'Guardando reglas…' : saveStatus === 'error' ? 'Reglas pendientes de guardar' : 'Reglas guardadas'}</span>
      </header>
      {rulesError && <p role="alert" className="rounded-lg border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm font-semibold text-[var(--danger-ink)]">{rulesError}</p>}

      <div className="space-y-2" aria-label="Escalones de costo">
        {rules.tiers.map((tier, index) => {
          const minimumCost = index === 0 ? 0 : rules.tiers[index - 1]?.maximumCost ?? 0;
          return (
            <article key={tier.id} className="grid gap-3 rounded-lg border border-[var(--line)] p-3 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(12rem,1.2fr)_minmax(16rem,1.5fr)_auto] sm:items-center">
              <p className="text-xs font-semibold text-[var(--ink-muted)]">{tier.maximumCost === null ? `Más de ${formatCurrency(minimumCost)}` : `Hasta ${formatCurrency(tier.maximumCost)}`}</p>
              <label className="min-w-0 text-[11px] font-medium text-[var(--ink-muted)]">Costo máximo
                {tier.maximumCost === null
                  ? <span className="mt-1 flex min-h-10 items-center rounded-lg border border-dashed border-[var(--line)] px-3 text-sm text-[var(--ink-muted)]">Sin límite</span>
                  : <MoneyInput aria-label={`Costo máximo escalón ${index + 1}`} min="0" value={tier.maximumCost} disabled={!canWrite}
                    onChange={event => updateTier(index, { maximumCost: Math.max(0, Number(event.target.value) || 0) })}
                    className="mt-1 min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)] disabled:opacity-50" />}
              </label>
              <MarginRuleFields rule={tier} label={`Ganancia escalón ${index + 1}`} disabled={!canWrite}
                onChange={rule => updateTier(index, rule)} />
              <button type="button" aria-label={`Quitar escalón ${index + 1}`} disabled={!canWrite || rules.tiers.length <= 2}
                onClick={() => {
                  const next = rules.tiers.filter((_, tierIndex) => tierIndex !== index);
                  if (tier.maximumCost === null) next[next.length - 1] = { ...next[next.length - 1], maximumCost: null };
                  onChange({ ...rules, tiers: next });
                }} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink-muted)] disabled:opacity-40">
                <Trash2 size={14} /> Quitar
              </button>
            </article>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" disabled={!canWrite || rules.tiers.length >= 10}
            onClick={() => {
              const finite = rules.tiers.filter(tier => tier.maximumCost !== null);
              const maximumCost = Math.max(5_000, ...finite.map(tier => tier.maximumCost ?? 0)) + 10_000;
              const next = [...finite, { id: crypto.randomUUID(), maximumCost, mode: 'percent' as const, value: 25, minimumProfit: null, maximumProfit: null }, rules.tiers.find(tier => tier.maximumCost === null) ?? { id: crypto.randomUUID(), maximumCost: null, mode: 'percent' as const, value: 18, minimumProfit: null, maximumProfit: null }];
              onChange({ ...rules, tiers: next });
            }} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-40">
            <Plus size={14} /> Agregar escalón
          </button>
          <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-muted)]">Redondeo
            <select aria-label="Redondeo de precio sugerido" value={rules.rounding} disabled={!canWrite}
              onChange={event => onChange({ ...rules, rounding: event.target.value === '100' ? 100 : event.target.value === '500' ? 500 : 'none' })}
              className="min-h-9 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2 text-xs text-[var(--ink)] disabled:opacity-50">
              <option value="none">Exacto</option><option value="100">A $100</option><option value="500">A $500</option>
            </select>
          </label>
        </div>
      </div>

      <section aria-labelledby="reseller-margin-categories" className="space-y-3 border-t border-[var(--line)] pt-4">
        <div><h4 id="reseller-margin-categories" className="text-sm font-bold text-[var(--ink)]">Excepciones por categoría</h4><p className="mt-1 text-xs text-[var(--ink-muted)]">Se aplican cuando el producto no tiene una regla propia.</p></div>
        <div className="flex gap-2">
          <select aria-label="Categoría para excepción" value={selectedCategory} disabled={!canWrite || categoriesWithoutOverride.length === 0}
            onChange={event => setSelectedCategory(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)] disabled:opacity-50">
            <option value="">Elegir categoría</option>{categoriesWithoutOverride.map(category => <option key={category} value={normalizeMarginCategory(category)}>{category}</option>)}
          </select>
          <button type="button" disabled={!canWrite || !selectedCategory} onClick={() => {
            updateCategoryRule(selectedCategory, { mode: 'percent', value: 25, minimumProfit: null, maximumProfit: null });
            setSelectedCategory('');
          }} className="min-h-10 shrink-0 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)] disabled:opacity-40">Agregar</button>
        </div>
        {Object.entries(rules.categoryOverrides).map(([key, rule]) => (
          <article key={key} className="grid gap-3 rounded-lg border border-[var(--line)] p-3 sm:grid-cols-[minmax(8rem,0.6fr)_minmax(18rem,1fr)_auto] sm:items-center">
            <h5 className="text-sm font-semibold text-[var(--ink)]">{categoryLabelByKey.get(key) ?? key}</h5>
            <MarginRuleFields rule={rule} label={`Ganancia categoría ${categoryLabelByKey.get(key) ?? key}`} disabled={!canWrite} onChange={next => updateCategoryRule(key, next)} />
            <button type="button" aria-label={`Quitar excepción de categoría ${categoryLabelByKey.get(key) ?? key}`} disabled={!canWrite}
              onClick={() => { const next = { ...rules.categoryOverrides }; delete next[key]; onChange({ ...rules, categoryOverrides: next }); }}
              className="min-h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink-muted)] disabled:opacity-40">Quitar</button>
          </article>
        ))}
      </section>

      <section aria-labelledby="reseller-margin-products" className="space-y-3 border-t border-[var(--line)] pt-4">
        <div><h4 id="reseller-margin-products" className="text-sm font-bold text-[var(--ink)]">Excepciones por producto</h4><p className="mt-1 text-xs text-[var(--ink-muted)]">Esta es la regla con mayor prioridad.</p></div>
        <div className="flex gap-2">
          <select aria-label="Producto para excepción" value={selectedProduct} disabled={!canWrite || productsWithoutOverride.length === 0}
            onChange={event => setSelectedProduct(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)] disabled:opacity-50">
            <option value="">Elegir producto</option>{productsWithoutOverride.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <button type="button" disabled={!canWrite || !selectedProduct} onClick={() => {
            updateProductRule(selectedProduct, { mode: 'percent', value: 25, minimumProfit: null, maximumProfit: null });
            setSelectedProduct('');
          }} className="min-h-10 shrink-0 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)] disabled:opacity-40">Agregar</button>
        </div>
        {Object.entries(rules.productOverrides).map(([productId, rule]) => (
          <article key={productId} className="grid gap-3 rounded-lg border border-[var(--line)] p-3 sm:grid-cols-[minmax(8rem,0.6fr)_minmax(18rem,1fr)_auto] sm:items-center">
            <h5 className="truncate text-sm font-semibold text-[var(--ink)]">{products.find(product => product.id === productId)?.name ?? 'Producto'}</h5>
            <MarginRuleFields rule={rule} label={`Ganancia producto ${products.find(product => product.id === productId)?.name ?? productId}`} disabled={!canWrite} onChange={next => updateProductRule(productId, next)} />
            <button type="button" aria-label={`Quitar excepción de ${products.find(product => product.id === productId)?.name ?? 'producto'}`} disabled={!canWrite}
              onClick={() => { const next = { ...rules.productOverrides }; delete next[productId]; onChange({ ...rules, productOverrides: next }); }}
              className="min-h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink-muted)] disabled:opacity-40">Quitar</button>
          </article>
        ))}
      </section>

      <section aria-labelledby="reseller-margin-simulator" data-testid="reseller-margin-simulator" className="space-y-3 border-t border-[var(--line)] pt-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div><h4 id="reseller-margin-simulator" className="text-sm font-bold text-[var(--ink)]">Simulador</h4><p className="mt-1 text-xs text-[var(--ink-muted)]">Productos actuales distribuidos por costo. Los cambios se reflejan sin tocar la lista.</p></div>
          <button type="button" disabled={!canWrite || simulatorRows.length === 0 || Boolean(rulesError) || saveStatus !== 'saved'} onClick={onApplyToList}
            className="min-h-10 rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-ink)] disabled:opacity-50">Aplicar a la lista</button>
        </div>
        {simulatorRows.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-muted)]">Cargá productos con costo para ver la simulación.</p> : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {simulatorRows.map(row => <article key={row.id} className="rounded-lg border border-[var(--line)] p-3 text-sm">
              <p className="truncate font-semibold text-[var(--ink)]">{row.name}</p>
              <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">{row.category || 'Sin categoría'}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                <dt className="text-[var(--ink-muted)]">Costo</dt><dd className="text-right font-medium text-[var(--ink)]">{formatCurrency(row.cost)}</dd>
                <dt className="text-[var(--ink-muted)]">Precio revendedor</dt><dd className="text-right font-medium text-[var(--ink)]">{formatCurrency(row.suggestion.suggestedResellerPrice)}</dd>
                <dt className="text-[var(--ink-muted)]">Ganás</dt><dd className="text-right font-bold text-[var(--ink)]">{formatCurrency(row.suggestion.suggestedResellerPrice - row.cost)}</dd>
                <dt className="text-[var(--ink-muted)]">Público sugerido</dt><dd className="text-right font-medium text-[var(--ink)]">{formatCurrency(row.suggestedPublicPrice)}</dd>
              </dl>
            </article>)}
          </div>
        )}
        <p data-testid="reseller-margin-impact" className="rounded-lg bg-[var(--surface-2)] p-3 text-sm text-[var(--ink)]">
          Con estas reglas: <strong>{impact.increaseCount.toLocaleString('es-AR')} productos subirían</strong> y <strong>{impact.decreaseCount.toLocaleString('es-AR')} bajarían</strong>. Ganancia promedio sugerida: <strong>{impact.averageProfit === null ? '—' : `${formatCurrency(impact.averageProfit)} por producto`}</strong>.
        </p>
      </section>
    </section>
  );
}
