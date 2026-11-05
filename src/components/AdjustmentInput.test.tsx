// @vitest-environment jsdom
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AdjustmentInput from './AdjustmentInput';

function Harness({ initialValue }: { initialValue: number }) {
  const [value, setValue] = useState(initialValue);
  return <>
    <AdjustmentInput label="Ajuste" value={value} onChange={setValue} />
    <output data-testid="signed-value">{value}</output>
  </>;
}

describe('AdjustmentInput', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => act(async () => { root.render(ui); });

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

  it('edits a negative stored value as a positive discount and converts it to a surcharge on toggle', async () => {
    await render(<Harness initialValue={-500} />);
    const discount = host.querySelector('button[aria-pressed="true"]');
    expect(discount?.textContent).toBe('Descuento');
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('500');
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');

    const surcharge = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Recargo') as HTMLButtonElement;
    await act(async () => { surcharge.click(); });
    expect(host.querySelector('[data-testid="signed-value"]')?.textContent).toBe('500');
    expect(surcharge.getAttribute('aria-pressed')).toBe('true');
  });

  it('maps an empty amount to zero and accepts comma decimals without a minus key', async () => {
    await render(<Harness initialValue={-500} />);
    const input = host.querySelector('input') as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      valueSetter?.call(input, '125,50');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="signed-value"]')?.textContent).toBe('-125.5');

    await act(async () => {
      valueSetter?.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="signed-value"]')?.textContent).toBe('0');
    expect(input.value).toBe('');
  });

  it('commits the numeric value when a trailing decimal separator is normalized on blur', async () => {
    await render(<Harness initialValue={0} />);
    const input = host.querySelector('input') as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      valueSetter?.call(input, '12.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.focus();
      input.blur();
    });

    expect(input.value).toBe('12');
    expect(host.querySelector('[data-testid="signed-value"]')?.textContent).toBe('-12');
  });

  it('loads an existing positive adjustment as a surcharge and defaults zero to discount', async () => {
    await render(<Harness key="positive" initialValue={250} />);
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Recargo');
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('250');

    await render(<Harness key="zero" initialValue={0} />);
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Descuento');
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('');
  });
});
