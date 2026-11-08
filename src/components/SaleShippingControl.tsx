import MoneyInput from './MoneyInput';
import { readLastShippingAmount, rememberLastShippingAmount } from '../lib/saleShippingStorage';

interface SaleShippingControlProps {
  ownerUid?: string | null;
  enabled: boolean;
  amount: number;
  onEnabledChange: (enabled: boolean) => void;
  onAmountChange: (amount: number) => void;
}

export default function SaleShippingControl({
  ownerUid,
  enabled,
  amount,
  onEnabledChange,
  onAmountChange,
}: SaleShippingControlProps) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Con envío</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">Se suma al total sin cambiar la ganancia de los productos.</span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={event => {
            const nextEnabled = event.target.checked;
            onEnabledChange(nextEnabled);
            if (nextEnabled && amount <= 0) onAmountChange(readLastShippingAmount(ownerUid));
          }}
          aria-label="Con envío"
          className="h-5 w-5 accent-indigo-600"
        />
      </label>
      {enabled && (
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Costo de envío
          <MoneyInput
            min="0"
            aria-label="Costo de envío"
            value={amount}
            onChange={event => {
              const nextAmount = Math.max(0, Number(event.target.value) || 0);
              onAmountChange(nextAmount);
              rememberLastShippingAmount(ownerUid, nextAmount);
            }}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>
      )}
    </section>
  );
}
