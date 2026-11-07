// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupplierListPhotoPicker from './SupplierListPhotoPicker';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('SupplierListPhotoPicker UI', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onSelect = vi.fn();

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    onSelect.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lets the reviewer select an image from the phone gallery for one product', async () => {
    await act(async () => root.render(<SupplierListPhotoPicker label="Cable USB-C" onSelect={onSelect} />));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Elegir foto de galería para Cable USB-C"]');
    expect(input).not.toBeNull();
    const file = new File(['photo'], 'cable.webp', { type: 'image/webp' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input?.dispatchEvent(new Event('change', { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith(file);
  });

  it('opens the imported screenshot and uses a manually selected crop as the product photo', async () => {
    const drawImage = vi.fn();
    const close = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: BlobCallback) => callback(new Blob(['crop'], { type: 'image/webp' })),
    };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1000, height: 500, close }));
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'canvas') return canvas as unknown as HTMLCanvasElement;
      return createElement(tagName, options);
    });
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:screenshot'),
      revokeObjectURL: vi.fn(),
    }));
    const screenshot = new File(['screenshot'], 'lista.png', { type: 'image/png' });
    await act(async () => root.render(<SupplierListPhotoPicker label="Cable USB-C" screenshot={screenshot} onSelect={onSelect} />));
    const cropButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Recortar captura'));
    await act(async () => cropButton?.click());
    const image = host.querySelector<HTMLImageElement>('img[alt="Captura cargada para recortar"]');
    expect(image).not.toBeNull();
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1000 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 500 });
    image!.getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50, toJSON: () => ({}) });
    image!.setPointerCapture = vi.fn();

    await act(async () => image!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 30 })));
    await act(async () => image!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 60 })));
    await act(async () => image!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
    const useCrop = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Usar recorte'));
    await act(async () => useCrop?.click());

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0]).toMatchObject({ name: 'foto-proveedor.webp', type: 'image/webp' });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 100, 100, 300, 300, 0, 0, 300, 300);
    expect(close).toHaveBeenCalledOnce();
  });
});
