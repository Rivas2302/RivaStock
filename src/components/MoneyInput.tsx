import { forwardRef } from 'react';
import type { NumberFieldProps } from './NumberField';
import NumberField from './NumberField';

type MoneyInputProps = NumberFieldProps & { wrapperClassName?: string };

const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput({ wrapperClassName, className, ...props }, ref) {
  return (
    <div className={`relative ${wrapperClassName ?? ''}`}>
      <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]">$</span>
      <NumberField {...props} ref={ref} className={`pl-8 ${className ?? ''}`} />
    </div>
  );
});

export default MoneyInput;

