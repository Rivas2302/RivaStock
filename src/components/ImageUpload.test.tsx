// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageUpload } from './ImageUpload';

const { rpc, uploadToStorage, optimizeUploadImage, showToast, reportProductPhotoUploadFailure } = vi.hoisted(() => ({
  rpc: vi.fn(),
  uploadToStorage: vi.fn(),
  optimizeUploadImage: vi.fn(),
  showToast: vi.fn(),
  reportProductPhotoUploadFailure: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../lib/db', () => ({ uploadToStorage, deleteFromStorage: vi.fn() }));
vi.mock('../lib/imageOptimization', () => ({
  imageFileExtension: () => 'webp',
  optimizeUploadImage,
}));
vi.mock('../lib/toast', () => ({ showToast }));
vi.mock('../lib/productPhotoUploadDiagnostics', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/productPhotoUploadDiagnostics')>(),
  reportProductPhotoUploadFailure,
}));
vi.mock('../lib/productPhotos', () => ({
  PRODUCT_PHOTO_CACHE_CONTROL: '31536000',
  getProductThumbnailPath: (path: string) => `thumbs/${path}`,
  getProductThumbnailUrl: (url: string) => `thumb:${url}`,
}));

describe('ImageUpload storage guard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    rpc.mockReset().mockResolvedValue({
      data: { allowed: false, reason: 'project_storage_full' },
      error: null,
    });
    uploadToStorage.mockReset();
    showToast.mockReset();
    reportProductPhotoUploadFailure.mockReset();
    optimizeUploadImage.mockReset().mockImplementation(async () =>
      new File([new Uint8Array([1, 2])], 'optimized.webp', { type: 'image/webp' }));
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('checks the combined original and thumbnail size and shows the exact denial without uploading', async () => {
    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="product" onChange={vi.fn()} />);
    });

    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const image = new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [image] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rpc).toHaveBeenCalledWith('storage_upload_check', {
      p_bucket: 'assets',
      p_bytes: 4,
    });
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent)
      .toBe('Sin espacio en la nube de RivaStock. Avisá a RivaTech.');
    expect(showToast).toHaveBeenCalledWith('Sin espacio en la nube de RivaStock. Avisá a RivaTech.', 'error');
    expect(reportProductPhotoUploadFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'no_space' }));
  });

  it('uploads a WebP original and its derived thumbnail while exposing only the original URL', async () => {
    const onChange = vi.fn();
    rpc.mockResolvedValue({ data: { allowed: true, reason: null }, error: null });
    uploadToStorage.mockImplementation(async (path: string) => `https://cdn.test/${path}`);
    optimizeUploadImage.mockImplementation(async (_file: File, maxDimension: number) => new File(
      [new Uint8Array([maxDimension === 1600 ? 1 : 2])],
      maxDimension === 1600 ? 'original.webp' : 'thumbnail.webp',
      { type: 'image/webp' },
    ));
    vi.stubGlobal('crypto', { randomUUID: () => 'thumbnail-test-id' });

    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="product" onChange={onChange} />);
    });

    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File([new Uint8Array([9])], 'photo.png', { type: 'image/png' })],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(uploadToStorage).toHaveBeenCalledTimes(2));

    expect(optimizeUploadImage.mock.calls.map((call) => call[1])).toEqual([1600, 480]);
    expect(uploadToStorage).toHaveBeenCalledTimes(2);
    const originalPath = uploadToStorage.mock.calls[0][0] as string;
    expect(originalPath).toMatch(/^owner\/products\/product\/.+\.webp$/);
    expect(uploadToStorage.mock.calls[0][1]).toMatchObject({ type: 'image/webp' });
    expect(uploadToStorage.mock.calls[0][3]).toBe('31536000');
    expect(uploadToStorage.mock.calls[1][0]).toBe(`thumbs/${originalPath}`);
    expect(uploadToStorage.mock.calls[1][1]).toMatchObject({ type: 'image/webp' });
    expect(uploadToStorage.mock.calls[1][3]).toBe('31536000');
    expect(onChange).toHaveBeenCalledWith([`https://cdn.test/${originalPath}`]);
  });

  it('compresses a camera photo larger than 5 MB before applying the storage limit', async () => {
    rpc.mockResolvedValue({ data: { allowed: true, reason: null }, error: null });
    uploadToStorage.mockImplementation(async (path: string) => `https://cdn.test/${path}`);
    vi.stubGlobal('crypto', { randomUUID: () => 'large-photo-test-id' });
    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="new-product" onChange={vi.fn()} mobileControls />);
    });

    const camera = host.querySelector<HTMLInputElement>('input[capture="environment"]')!;
    const largePhoto = new File([new Uint8Array(6 * 1024 * 1024)], 'motorola-camera.jpg', { type: 'image/jpeg' });
    expect(largePhoto.size).toBeGreaterThan(5 * 1024 * 1024);
    Object.defineProperty(camera, 'files', { configurable: true, value: [largePhoto] });
    await act(async () => {
      camera.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await vi.waitFor(() => expect(uploadToStorage).toHaveBeenCalledTimes(2));
    expect(optimizeUploadImage).toHaveBeenCalledWith(largePhoto, 1600, { forceWebP: true, maxBytes: 2 * 1024 * 1024 });
    expect(rpc).toHaveBeenCalledWith('storage_upload_check', { p_bucket: 'assets', p_bytes: 4 });
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not open the camera when the product draft cannot be persisted', async () => {
    const onBeforeCameraOpen = vi.fn(() => false);
    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="new-product" onChange={vi.fn()} mobileControls onBeforeCameraOpen={onBeforeCameraOpen} />);
    });
    const cameraButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Sacar foto'));
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    await act(async () => { cameraButton?.click(); });

    expect(onBeforeCameraOpen).toHaveBeenCalledOnce();
    expect(inputClick).not.toHaveBeenCalled();
    inputClick.mockRestore();
  });
  it('shows the preparing state immediately and stops image processing after 20 seconds', async () => {
    vi.useFakeTimers();
    optimizeUploadImage.mockImplementationOnce(() => new Promise<File>(() => undefined));
    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="new-product" onChange={vi.fn()} mobileControls />);
    });

    const gallery = host.querySelector<HTMLInputElement>('input[multiple]')!;
    Object.defineProperty(gallery, 'files', {
      configurable: true,
      value: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })],
    });
    await act(async () => {
      gallery.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(host.querySelector('[role="status"]')?.textContent).toBe('Preparando y subiendo la foto…');
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });

    expect(host.querySelector('[role="alert"]')?.textContent)
      .toBe('El teléfono tardó más de 20 segundos en preparar la foto. Probá con otra imagen.');
    expect(reportProductPhotoUploadFailure).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'compress_original', reason: 'processing_timeout',
    }));
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('refuses an empty product id instead of sending an ambiguous Storage path', async () => {
    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="" onChange={vi.fn()} mobileControls />);
    });
    const gallery = host.querySelector<HTMLInputElement>('input[multiple]')!;
    Object.defineProperty(gallery, 'files', {
      configurable: true,
      value: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })],
    });
    await act(async () => {
      gallery.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent)
      .toBe('No se pudo identificar el producto para guardar la foto. Cerrá y volvé a abrir el formulario.');
    expect(reportProductPhotoUploadFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'product_id_missing' }));
  });

  it('shows and records an unsupported HEIC decode instead of failing silently', async () => {
    optimizeUploadImage.mockRejectedValue({ code: 'unsupported_format' });
    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="product" onChange={vi.fn()} mobileControls />);
    });

    const gallery = host.querySelector<HTMLInputElement>('input[multiple]')!;
    const heic = new File(['heic bytes'], 'photo.heic', { type: 'image/heic' });
    Object.defineProperty(gallery, 'files', { configurable: true, value: [heic] });
    await act(async () => {
      gallery.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Formato no soportado. Guardá la foto como JPG o PNG y volvé a probar.');
    expect(showToast).toHaveBeenCalledOnce();
    expect(reportProductPhotoUploadFailure).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'compress_original', reason: 'unsupported_format', imageType: 'heic',
    }));
    expect(uploadToStorage).not.toHaveBeenCalled();
  });

  it('turns a browser network error into an actionable Spanish message', async () => {
    optimizeUploadImage.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="product" onChange={vi.fn()} />);
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Sin conexión. Revisá Internet e intentá subir la foto de nuevo.');
    expect(reportProductPhotoUploadFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'no_connection' }));
  });

  it('explains an authenticated upload permission rejection without exposing backend text', async () => {
    rpc.mockResolvedValue({ data: { allowed: true, reason: null }, error: null });
    uploadToStorage.mockRejectedValue(new Error('new row violates row-level security policy for path owner/private-product/photo.webp'));
    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="private-product" onChange={vi.fn()} />);
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Sin permiso: no se pudo guardar la foto en Stock. Revisá el acceso del negocio.');
    expect(host.textContent).not.toContain('private-product');
    expect(host.textContent).not.toContain('row-level security');
    expect(reportProductPhotoUploadFailure).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'upload_original', reason: 'no_permission',
    }));
  });

  it('offers camera and gallery inputs on mobile and reorders images without uploading them again', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(<ImageUpload
        ownerUid="owner"
        productId="product"
        currentImages={['https://cdn.test/one.webp', 'https://cdn.test/two.webp']}
        onChange={onChange}
        mobileControls
        allowReorder
      />);
    });

    expect(host.querySelector<HTMLInputElement>('input[capture="environment"]')?.accept).toContain('image/*');
    expect(host.querySelector<HTMLInputElement>('input[capture="environment"]')?.accept).toContain('.heic');
    expect(host.querySelector<HTMLInputElement>('input[multiple]')?.accept).toContain('.heif');
    const moveLeft = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('aria-label') === 'Mover imagen 2 a la izquierda');
    if (!moveLeft) throw new Error('No se encontró el control para reordenar la foto.');
    await act(async () => { moveLeft.click(); });

    expect(onChange).toHaveBeenCalledWith(['https://cdn.test/two.webp', 'https://cdn.test/one.webp']);
    expect(uploadToStorage).not.toHaveBeenCalled();
  });
});
