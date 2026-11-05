import { useEffect, useId, useRef, useState } from 'react';
import { formatCurrency } from '../lib/utils';

type AdjustmentMode = 'discount' | 'surcharge';

interface AdjustmentInputProps {
  value: number;
  onChange: (signedValue: number) => void;
  label: string;
}

function getMode(value: number): AdjustmentMode {
  return value > 0 ? 'surcharge' : 'discount';
}

export default function AdjustmentInput({ value, onChange, label }: AdjustmentInputProps) {
  const inputId = useId();
  const [mode, setMode] = useState<AdjustmentMode>(() => getMode(value));
  const [amount, setAmount] = useState(() => value === 0 ? '' : String(Math.abs(value)));
  const lastEmittedValueRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastEmittedValueRef.current === value) {
      lastEmittedValueRef.current = null;
      return;
    }
    setMode(getMode(value));
    setAmount(value === 0 ? '' : String(Math.abs(value)));
  }, [value]);

  const emitAmount = (rawAmount: string, selectedMode = mode) => {
    if (rawAmount === '') {
      lastEmittedValueRef.current = 0;
      onChange(0);
      return;
    }
    if (!/^\d*(?:[.,]\d*)?$/.test(rawAmount) || /[.,]$/.test(rawAmount)) return;
    const parsed = Number(rawAmount.replace(',', '.'));
    if (!Number.isFinite(parsed)) return;
    const signedValue = selectedMode === 'discount' ? -parsed : parsed;
    lastEmittedValueRef.current = signedValue;
    onChange(signedValue);
  };

  const handleModeChange = (nextMode: AdjustmentMode) => {
    setMode(nextMode);
    emitAmount(amount, nextMode);
  };

  const handleAmountChange = (rawAmount: string) => {
    const sanitized = rawAmount.replace(/[^\d.,]/g, '').replace(/([.,].*)[.,]/g, '$1');
    setAmount(sanitized);
    emitAmount(sanitized);
  };

  const absoluteValue = Math.abs(value);
  const effectLabel = mode === 'discount' ? 'Descuento' : 'Recargo';
  const effectSign = mode === 'discount' ? '−' : '+';

  return (
    <div className="space-y-2 text-[var(--ink)]">
      <label htmlFor={inputId} className="block text-sm font-medium text-[var(--ink-subtle)]">{label}</label>
      <div role="group" aria-label="Tipo de ajuste" className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={mode === 'discount'}
          onClick={() => handleModeChange('discount')}
          className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors ${mode === 'discount' ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-subtle)] hover:bg-[var(--surface-muted)]'}`}
        >
          Descuento
        </button>
        <button
          type="button"
          aria-pressed={mode === 'surcharge'}
          onClick={() => handleModeChange('surcharge')}
          className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors ${mode === 'surcharge' ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-subtle)] hover:bg-[var(--surface-muted)]'}`}
        >
          Recargo
        </button>
      </div>
      <div className="relative">
        <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]">$</span>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => handleAmountChange(event.target.value)}
          onBlur={() => {
            if (/[.,]$/.test(amount)) {
              const normalized = amount.slice(0, -1);
              setAmount(normalized);
              emitAmount(normalized);
            }
          }}
          aria-label={`Monto de ${effectLabel.toLowerCase()}`}
          autoComplete="off"
          className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] py-2 pl-8 pr-3 text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-[var(--brand)] focus:border-[var(--brand)]"
        />
      </div>
      <p aria-live="polite" className="text-xs font-medium text-[var(--ink-muted)]">
        {effectLabel}: {effectSign}{formatCurrency(absoluteValue)}
      </p>
    </div>
  );
}
