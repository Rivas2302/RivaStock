// @vitest-environment jsdom
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import NumberField from './NumberField';
import MoneyInput from './MoneyInput';

function Harness({ initialValue = 0, required = false }: { initialValue?: number; required?: boolean }) {
  const [value, setValue] = useState(initialValue);
  return <>
    <NumberField aria-label="Monto" value={value} min={0} required={required} onChange={(event) => setValue(Number(event.target.value.replace(',', '.')) || 0)} />
    <output>{value}</output>
  </>;
}

describe('NumberField', () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = async (ui: ReactElement) => act(async () => { root.render(ui); });
  const setInputValue = async (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('shows zero as an empty placeholder and selects all existing text on focus', async () => {
    await render(<Harness initialValue={0} />);
    const input = host.querySelector('input')!;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('0');
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');

    await render(<Harness key="existing" initialValue={1250} />);
    const existing = host.querySelector('input')!;
    await act(async () => existing.focus());
    expect(existing.value).toBe('1250');
    expect(existing.selectionStart).toBe(0);
    expect(existing.selectionEnd).toBe(existing.value.length);
  });

  it('keeps the typed text until blur and commits Argentine comma decimals', async () => {
    await render(<Harness />);
    const input = host.querySelector('input')!;
    await act(async () => input.focus());
    await setInputValue(input, '125,50');
    expect(host.querySelector('output')?.textContent).toBe('0');
    expect(input.value).toBe('125,50');
    await act(async () => input.blur());
    expect(host.querySelector('output')?.textContent).toBe('125.5');
    expect(input.value).toBe('125.5');
  });

  it('keeps edited values, treats optional empty as zero, and shows visible validation', async () => {
    await render(<Harness initialValue={250} />);
    const input = host.querySelector('input')!;
    await act(async () => input.focus());
    await setInputValue(input, '');
    await act(async () => input.blur());
    expect(host.querySelector('output')?.textContent).toBe('0');

    await render(<Harness initialValue={250} required />);
    const requiredInput = host.querySelector('input')!;
    await act(async () => requiredInput.focus());
    await setInputValue(requiredInput, '');
    await act(async () => requiredInput.blur());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('obligatorio');
  });

  it('adds a currency symbol without changing decimal text handling', async () => {
    await render(<MoneyInput aria-label="Precio" value={0} onChange={() => undefined} className="money-input" />);
    expect(host.textContent).toContain('$');
    expect(host.querySelector('input')?.value).toBe('');
    expect(host.querySelector('input')?.className).toContain('pl-8');
  });
});

