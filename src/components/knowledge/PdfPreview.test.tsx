// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PdfPreview from './PdfPreview';

describe('PdfPreview', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onOpenPdf = vi.fn();

  const render = async (ui: ReactElement) => {
    await act(async () => { root.render(ui); });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    onOpenPdf.mockReset();
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('waits for a signed URL and replaces the iframe with each refreshed URL', async () => {
    const base = {
      title: '[QA] multipage PDF',
      versionNumber: 1,
      extractionMessage: null,
      signedError: '',
      onOpenPdf,
    };

    await render(<PdfPreview {...base} signedUrl=""/>);
    expect(host.querySelector('iframe')).toBeNull();

    await render(<PdfPreview {...base} signedUrl="https://storage.example/signed/first.pdf?token=first"/>);
    const firstFrame = host.querySelector('iframe');
    expect(firstFrame?.getAttribute('src')).toBe('https://storage.example/signed/first.pdf?token=first');
    expect(firstFrame?.getAttribute('src')).not.toBe('about:blank');

    await render(<PdfPreview {...base} signedUrl="https://storage.example/signed/second.pdf?token=second"/>);
    const refreshedFrame = host.querySelector('iframe');
    expect(refreshedFrame).not.toBe(firstFrame);
    expect(refreshedFrame?.getAttribute('src')).toBe('https://storage.example/signed/second.pdf?token=second');
    expect(refreshedFrame?.getAttribute('src')).not.toBe('about:blank');
  });

  it('offers a PDF open action on desktop and mobile', async () => {
    await render(<PdfPreview
      title="[QA] multipage PDF"
      versionNumber={1}
      extractionMessage={null}
      signedUrl="https://storage.example/signed/document.pdf?token=valid"
      signedError=""
      onOpenPdf={onOpenPdf}
    />);

    const openButtons = [...host.querySelectorAll('button')];
    expect(openButtons.map((button) => button.textContent?.trim())).toEqual(['Abrir PDF', 'Abrir en pestaña nueva']);
    await act(async () => { openButtons[1].click(); });
    expect(onOpenPdf).toHaveBeenCalledTimes(1);
  });
});
