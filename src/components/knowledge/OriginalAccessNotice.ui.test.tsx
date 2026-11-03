// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OriginalAccessNotice from './OriginalAccessNotice';

describe('OriginalAccessNotice', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('shows the pending message while the central prepares the original', () => {
    act(() => root.render(<OriginalAccessNotice access={{ state: 'loading' }} onViewText={vi.fn()} onRetry={vi.fn()}/>));
    expect(host.textContent).toContain('Pidiendo el archivo a la central…');
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });

  it('shows the exact offline guidance and allows reading extracted text', () => {
    const onViewText = vi.fn();
    act(() => root.render(<OriginalAccessNotice access={{ state: 'offline', lastSeenAt: null }} onViewText={onViewText} onRetry={vi.fn()}/>));
    expect(host.textContent).toContain('La central de este negocio está apagada. Podés leer el texto del documento ahora; el original se abre cuando la PC esté prendida.');
    act(() => host.querySelector('button')?.click());
    expect(onViewText).toHaveBeenCalledOnce();
  });

  it('shows the missing-original guidance and keeps the text action available', () => {
    const onViewText = vi.fn();
    act(() => root.render(<OriginalAccessNotice access={{ state: 'missing' }} onViewText={onViewText} onRetry={vi.fn()}/>));
    expect(host.textContent).toContain('No encontramos el original en la central ni en su copia de respaldo. El texto y la búsqueda siguen funcionando.');
    act(() => host.querySelector('button')?.click());
    expect(onViewText).toHaveBeenCalledOnce();
  });

  it('leaves the notice hidden when a signed cloud or cache URL is ready', () => {
    act(() => root.render(<OriginalAccessNotice access={{ state: 'ready', source: 'cache', url: 'https://storage.invalid/original' }} onViewText={vi.fn()} onRetry={vi.fn()}/>));
    expect(host.textContent).toBe('');
  });
});
