// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import StreamingAssistantMessage from './StreamingAssistantMessage';

describe('StreamingAssistantMessage', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (element: ReactElement) => act(async () => { root.render(element); });
  const settleMarkdown = () => new Promise((resolve) => window.setTimeout(resolve, 60));

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

  it('renders sanitized markdown, safe external links, scrollable tables, and code-copy controls', async () => {
    await render(<StreamingAssistantMessage content={'# Resumen\n\n[Ver detalle](https://example.com)\n\n| Día | Total |\n| --- | ---: |\n| Hoy | 12 |\n\n```txt\nresultado\n```\n\n<script>alert(1)</script>'}/>);
    await act(async () => { await settleMarkdown(); });

    const link = host.querySelector<HTMLAnchorElement>('a');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
    expect(host.querySelector('.overflow-x-auto table')).toBeTruthy();
    expect(host.querySelector('button[data-chat-copy-code]')?.textContent).toBe('Copiar código');
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('Resumen');
  });

  it('reveals completed SDK messages with a writing effect and lets the user finish the reveal', async () => {
    const fullText = 'Esta es una respuesta del SDK que llega completa y se muestra con efecto de escritura.';
    await render(<StreamingAssistantMessage content="" streaming activity="Escribiendo la respuesta…"/>);
    await render(<StreamingAssistantMessage content={fullText} streaming activity="Escribiendo la respuesta…"/>);
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 20)); });

    expect(host.textContent).toContain('Escribiendo la respuesta…');
    const bubble = host.querySelector('.chat-markdown');
    if (!bubble) throw new Error('No se encontró la burbuja de respuesta.');
    await act(async () => { bubble.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settleMarkdown(); });
    expect(host.textContent).toContain(fullText);
  });
});
