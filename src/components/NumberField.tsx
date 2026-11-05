import { forwardRef, useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'inputMode'>;

export interface NumberFieldProps extends NativeInputProps {
  value: number | string | null | undefined;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDraftChange?: (value: string) => void;
  inputMode?: 'decimal' | 'numeric';
  integer?: boolean;
  min?: number | string;
  max?: number | string;
  required?: boolean;
  label?: string;
}

function numericValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField({
  value,
  onChange,
  onDraftChange,
  inputMode,
  integer = false,
  min,
  max,
  required,
  label,
  className,
  onFocus,
  onBlur,
  ...inputProps
}, ref) {
  const initial = numericValue(value);
  const [draft, setDraft] = useState(initial === null || initial === 0 ? '' : String(value));
  const [error, setError] = useState('');
  const lastEmittedValue = useRef<number | null>(null);

  useEffect(() => {
    const current = numericValue(value);
    if (current !== null && current === lastEmittedValue.current) {
      lastEmittedValue.current = null;
      return;
    }
    setDraft(current === null || current === 0 ? '' : String(value));
    setError('');
  }, [value]);

  const commitDraft = (input?: HTMLInputElement) => {
    const normalized = draft.trim().replace(',', '.');
    const parsed = normalized === '' ? null : Number(normalized);
    const minimum = min === undefined ? null : Number(min);
    const maximum = max === undefined ? null : Number(max);
    let nextError = '';

    if (required && parsed === null) nextError = 'Este campo es obligatorio.';
    else if (parsed !== null && !Number.isFinite(parsed)) nextError = 'Ingresá un número válido.';
    else if (parsed !== null && integer && !Number.isInteger(parsed)) nextError = 'Ingresá una cantidad entera.';
    else if (parsed !== null && minimum !== null && parsed < minimum) nextError = `El valor mínimo es ${minimum}.`;
    else if (parsed !== null && maximum !== null && parsed > maximum) nextError = `El valor máximo es ${maximum}.`;

    setError(nextError);
    input?.setCustomValidity(nextError);
    if (nextError) return;

    const nextValue = parsed ?? 0;
    lastEmittedValue.current = nextValue;
    const normalizedValue = normalized.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    setDraft(normalizedValue);
    const event = {
      target: { value: normalizedValue, name: inputProps.name },
      currentTarget: null,
    } as unknown as ChangeEvent<HTMLInputElement>;
    onChange(event);
  };

  const errorId = `${inputProps.id ?? inputProps.name ?? 'number-field'}-error`;

  return (
    <>
      <input
        ref={ref}
        {...inputProps}
        type="text"
        inputMode={inputMode ?? (integer ? 'numeric' : 'decimal')}
        value={draft}
        placeholder={inputProps.placeholder ?? '0'}
        required={false}
        aria-invalid={Boolean(error) || inputProps['aria-invalid']}
        aria-describedby={error ? [inputProps['aria-describedby'], errorId].filter(Boolean).join(' ') : inputProps['aria-describedby']}
        onFocus={(event) => {
          event.currentTarget.select();
          onFocus?.(event);
        }}
        onChange={(event) => {
          const raw = event.target.value;
          const filtered = integer ? raw.replace(/\D/g, '') : raw.replace(/[^\d.,-]/g, '').replace(/([.,].*)[.,]/g, '$1');
          setDraft(filtered);
          setError('');
          event.currentTarget.setCustomValidity('');
          onDraftChange?.(filtered);
        }}
        onBlur={(event) => {
          commitDraft(event.currentTarget);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          inputProps.onKeyDown?.(event);
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className={className}
      />
      {error && <span id={errorId} role="alert" className="mt-1 block text-xs font-medium text-[var(--danger-ink)]">{error}</span>}
    </>
  );
});

export default NumberField;

