// @vitest-environment jsdom
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BottomSheet from './BottomSheet';

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Abrir hoja</button>
    {open && <BottomSheet title="Filtros" closeLabel="Cerrar filtros" onClose={() => { onClose(); setOpen(false); }}>
      <button type="button">Aplicar</button>
    </BottomSheet>}
  </>;
}

describe('BottomSheet', () => {
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

  it('moves focus into the sheet, traps keyboard focus, and restores it after closing', async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} />);
    const trigger = host.querySelector<HTMLButtonElement>('button');
    await act(async () => { trigger?.focus(); trigger?.click(); });
    const closeButton = host.querySelector<HTMLButtonElement>('[aria-label="Cerrar filtros"]');
    const applyButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Aplicar');
    expect(document.activeElement).toBe(closeButton);

    await act(async () => {
      closeButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, shiftKey: true }));
    });
    expect(document.activeElement).toBe(applyButton);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});