import { useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { InventoryHolding, InventoryOwner, Product } from '../../types';
import { resolveIdempotencyIntent, type IdempotencyIntent } from '../../lib/idempotencyIntent';
import { beginSubmission, endSubmission } from '../../lib/submissionGuard';
import type { AdjustProductStockInput, StockAdjustmentMode } from '../../lib/stockAdjustments';
import BottomSheet from '../mobile/BottomSheet';

const REASONS = [
  'Ingresó mercadería',
  'Rotura',
  'Pérdida o robo',
  'Devolución',
  'Conteo',
  'Uso interno',
  'Otro',
] as const;

interface Props {
  product: Product;
  holdings: InventoryHolding[];
  owners: InventoryOwner[];
  operableInventoryOwnerIds: string[];
  holdingsEnabled: boolean;
  canWrite: boolean;
  onClose: () => void;
  onSave: (input: AdjustProductStockInput) => Promise<unknown>;
  onOpenIntake: () => void;
}

export default function MobileStockAdjustmentSheet({
  product,
  holdings,
  owners,
  operableInventoryOwnerIds,
  holdingsEnabled,
  canWrite,
  onClose,
  onSave,
  onOpenIntake,
}: Props) {
  const activeOwnerIds = useMemo(() => new Set(operableInventoryOwnerIds), [operableInventoryOwnerIds]);
  const ownerOptions = useMemo(() => {
    const activeHoldings = new Set(holdings.filter((holding) => holding.active).map((holding) => holding.inventoryOwnerId));
    return owners.filter((owner) => (
      !owner.archivedAt
      && activeOwnerIds.has(owner.id)
      && activeHoldings.has(owner.id)
    ));
  }, [activeOwnerIds, holdings, owners]);
  const initialOwnerId = ownerOptions.find((owner) => owner.isPrimary)?.id ?? ownerOptions[0]?.id ?? '';
  const [mode, setMode] = useState<StockAdjustmentMode>('add');
  const [quantityText, setQuantityText] = useState('1');
  const [reason, setReason] = useState<string>('Ingresó mercadería');
  const [otherReason, setOtherReason] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState(initialOwnerId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const submitGuard = useRef(false);
  const idempotencyIntent = useRef<IdempotencyIntent | null>(null);

  const selectedHolding = holdings.find((holding) => (
    holding.productId === product.id
    && holding.inventoryOwnerId === selectedOwnerId
    && holding.active
  ));
  const currentStock = holdingsEnabled ? selectedHolding?.stock ?? 0 : product.stock;
  const quantity = quantityText.trim() === '' ? null : Number(quantityText);
  const quantityValid = quantity !== null
    && Number.isSafeInteger(quantity)
    && quantity >= (mode === 'count' ? 0 : 1)
    && quantity <= 2_147_483_647;
  const nextStock = quantityValid
    ? mode === 'add'
      ? currentStock + quantity
      : mode === 'remove'
        ? currentStock - quantity
        : quantity
    : currentStock;
  const belowZero = quantityValid && nextStock < 0;
  const exceedsDatabaseLimit = quantityValid && nextStock > 2_147_483_647;
  const selectedReason = reason === 'Otro' ? otherReason.trim() : reason;
  const reasonValid = selectedReason.length > 0 && selectedReason.length <= 300;
  const ownerValid = !holdingsEnabled || Boolean(selectedOwnerId && selectedHolding);
  const canSubmit = canWrite && !saving && quantityValid && !belowZero && !exceedsDatabaseLimit && reasonValid && ownerValid;

  const chooseMode = (nextMode: StockAdjustmentMode) => {
    setMode(nextMode);
    setQuantityText(nextMode === 'count' ? String(currentStock) : '1');
    setReason(nextMode === 'count' ? 'Conteo' : nextMode === 'add' ? 'Ingresó mercadería' : 'Otro');
    setOtherReason('');
    setSaveError('');
  };

  const changeOwner = (ownerId: string) => {
    setSelectedOwnerId(ownerId);
    if (mode === 'count') {
      const stock = holdings.find((holding) => (
        holding.productId === product.id && holding.inventoryOwnerId === ownerId && holding.active
      ))?.stock ?? 0;
      setQuantityText(String(stock));
    }
  };

  const submit = async () => {
    if (!canSubmit || quantity === null || !beginSubmission(submitGuard)) return;
    setSaving(true);
    setSaveError('');
    const input = {
      productId: product.id,
      inventoryOwnerId: holdingsEnabled ? selectedOwnerId : null,
      mode,
      quantity,
      reason: selectedReason,
    } satisfies Omit<AdjustProductStockInput, 'idempotencyKey'>;
    idempotencyIntent.current = resolveIdempotencyIntent(
      'stock-adjustment',
      input,
      idempotencyIntent.current,
    );
    try {
      await onSave({ ...input, idempotencyKey: idempotencyIntent.current.key });
      onClose();
    } catch {
      setSaveError('No se pudo ajustar el stock. Revisá tu conexión e intentá de nuevo.');
    } finally {
      setSaving(false);
      endSubmission(submitGuard);
    }
  };

  return <BottomSheet
    title="Ajustar stock"
    titleId="mobile-stock-adjustment-title"
    closeLabel="Cerrar ajuste de stock"
    onClose={onClose}
    className="mobile-stock-adjustment-limit"
  >
    <div className="space-y-4 pb-2">
      <div>
        <p className="truncate text-sm font-semibold">{product.name}</p>
        <p className="text-sm text-[var(--ink-subtle)]">
          {holdingsEnabled && selectedHolding && selectedOwnerId
            ? `${owners.find((owner) => owner.id === selectedOwnerId)?.name ?? 'Titular'} · `
            : ''}
          Stock actual: {currentStock} unidades
        </p>
      </div>

      {holdingsEnabled && ownerOptions.length > 1 && <label className="block space-y-1 text-sm font-semibold">
        Titular
        <select
          aria-label="Titular"
          value={selectedOwnerId}
          onChange={(event) => changeOwner(event.target.value)}
          className="min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-[var(--ink)]"
        >
          {ownerOptions.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
        </select>
      </label>}
      {holdingsEnabled && ownerOptions.length === 0 && <p role="alert" className="rounded-xl bg-[var(--danger-surface)] px-3 py-2 text-sm text-[var(--danger-ink)]">No tenés una existencia habilitada para ajustar.</p>}

      <div role="group" aria-label="Tipo de ajuste" className="grid grid-cols-3 rounded-xl bg-[var(--surface-muted)] p-1">
        {([['add', 'Sumar'], ['remove', 'Restar'], ['count', 'Contar']] as const).map(([value, label]) => <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => chooseMode(value)}
          className={`min-h-11 rounded-lg px-2 text-sm font-bold ${mode === value ? 'bg-[var(--surface)] text-[var(--brand-strong)] shadow-sm' : 'text-[var(--ink-subtle)]'}`}
        >{label}</button>)}
      </div>

      <div className="space-y-1 text-sm font-semibold">
        <label htmlFor="mobile-stock-adjustment-quantity" className="block">
          {mode === 'count' ? '¿Cuántas unidades contaste?' : 'Cantidad'}
        </label>
        <span className="flex min-h-14 items-center gap-2">
          <button
            type="button"
            aria-label="Restar una unidad"
            onClick={() => setQuantityText(String(Math.max(mode === 'count' ? 0 : 1, (quantity ?? 0) - 1)))}
            disabled={!quantityValid || quantity <= (mode === 'count' ? 0 : 1)}
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] disabled:opacity-40"
          ><Minus size={19} aria-hidden="true" /></button>
          <input
            id="mobile-stock-adjustment-quantity"
            aria-label={mode === 'count' ? 'Unidades contadas' : 'Cantidad'}
            type="number"
            inputMode="numeric"
            min={mode === 'count' ? 0 : 1}
            step="1"
            value={quantityText}
            onChange={(event) => setQuantityText(event.target.value)}
            className="h-12 min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-center text-lg font-bold text-[var(--ink)]"
          />
          <button
            type="button"
            aria-label="Sumar una unidad"
            onClick={() => setQuantityText(String((quantity ?? 0) + 1))}
            disabled={quantity !== null && !Number.isSafeInteger(quantity)}
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] disabled:opacity-40"
          ><Plus size={19} aria-hidden="true" /></button>
        </span>
      </div>

      <div aria-live="polite" className={`rounded-xl border px-4 py-3 text-sm font-semibold ${belowZero ? 'border-[var(--danger-line)] bg-[var(--danger-surface)] text-[var(--danger-ink)]' : 'border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink)]'}`}>
        Va a quedar en {quantityValid ? nextStock : '—'} unidades
        {belowZero && <span className="mt-1 block text-xs">El stock no puede quedar por debajo de cero.</span>}
        {exceedsDatabaseLimit && <span className="mt-1 block text-xs">La cantidad supera el límite permitido.</span>}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Motivo</legend>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((item) => <button
            key={item}
            type="button"
            aria-pressed={reason === item}
            onClick={() => { setReason(item); setSaveError(''); }}
            className={`min-h-10 rounded-full border px-3 text-xs font-semibold ${reason === item ? 'border-[var(--brand)] bg-[var(--brand)] text-[var(--action-ink)]' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]'}`}
          >{item}</button>)}
        </div>
      </fieldset>

      {reason === 'Otro' && <label className="block space-y-1 text-sm font-semibold">
        Escribí el motivo
        <input
          type="text"
          maxLength={300}
          value={otherReason}
          onChange={(event) => setOtherReason(event.target.value)}
          className="min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-[var(--ink)]"
        />
      </label>}

      {mode === 'add' && <button type="button" onClick={onOpenIntake} className="text-left text-sm font-semibold text-[var(--brand-strong)] underline underline-offset-4">¿Compra con proveedor? Cargá un ingreso</button>}

      {saveError && <p role="alert" className="text-sm font-semibold text-[var(--danger-ink)]">{saveError}</p>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="min-h-14 w-full rounded-xl bg-[var(--action-bg)] px-4 text-base font-bold text-[var(--action-ink)] disabled:cursor-not-allowed disabled:opacity-45"
      >{saving ? 'Guardando…' : 'Guardar ajuste'}</button>
    </div>
  </BottomSheet>;
}
