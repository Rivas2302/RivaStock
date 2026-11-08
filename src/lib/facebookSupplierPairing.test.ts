import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPairing, trustedPairingSender } from '../../extensions/facebook/pairing.js';

afterEach(() => vi.unstubAllGlobals());

const sender = (url: string, frameId = 0) => ({ url, frameId, tab: { id: 19 } });

describe('extension supplier capture sender boundary', () => {
  it('accepts only the exact RivaStock origin, top frame, and approved app routes', () => {
    expect(trustedPairingSender(sender('https://rivastock.vercel.app/revendedores?importar=extension'))).toBe(true);
    expect(trustedPairingSender(sender('https://rivastock.vercel.app.evil.example/revendedores'))).toBe(false);
    expect(trustedPairingSender(sender('https://rivastock.vercel.app/revendedores', 1))).toBe(false);
    expect(trustedPairingSender({ url: 'https://rivastock.vercel.app/revendedores', frameId: 0 })).toBe(false);
    expect(trustedPairingSender(sender('https://rivastock.vercel.app/login'))).toBe(false);
  });

  it('serves and acknowledges a capture only on /revendedores', async () => {
    const listener = vi.fn();
    const getCapture = vi.fn(async (captureId: string, offset: number) => ({ captureId, offset, items: [] }));
    const getCaptureImage = vi.fn(async (_captureId: string, _imageUrl: string) => ({ mimeType: 'image/webp', base64: 'AQID', size: 3 }));
    const acknowledgeCapture = vi.fn(async () => ({ received: true }));
    vi.stubGlobal('chrome', { runtime: { onMessageExternal: { addListener: listener } } });
    registerPairing({ getCapture, getCaptureImage, acknowledgeCapture });
    const handler = listener.mock.calls[0][0] as (message: unknown, from: unknown, reply: (value: unknown) => void) => boolean | void;
    const reply = vi.fn();

    expect(handler({ type: 'rivastock-get-capture', captureId: 'a1b2c3d4-e5f6-4789-a012-123456789abc', offset: 0 },
      sender('https://rivastock.vercel.app/config'), reply)).toBeUndefined();
    expect(getCapture).not.toHaveBeenCalled();

    expect(handler({ type: 'rivastock-get-capture', captureId: 'a1b2c3d4-e5f6-4789-a012-123456789abc', offset: 0 },
      sender('https://rivastock.vercel.app/revendedores?importar=extension'), reply)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getCapture).toHaveBeenCalledWith('a1b2c3d4-e5f6-4789-a012-123456789abc', 0);
    expect(reply).toHaveBeenCalledWith({ captureId: 'a1b2c3d4-e5f6-4789-a012-123456789abc', offset: 0, items: [] });

    handler({ type: 'supplier-capture-read-image', captureId: 'a1b2c3d4-e5f6-4789-a012-123456789abc', imageUrl: 'https://supplier.example.test/photo.webp' },
      sender('https://rivastock.vercel.app/config'), reply);
    expect(getCaptureImage).not.toHaveBeenCalled();
    handler({ type: 'supplier-capture-read-image', captureId: 'a1b2c3d4-e5f6-4789-a012-123456789abc', imageUrl: 'https://supplier.example.test/photo.webp' },
      sender('https://rivastock.vercel.app/revendedores'), reply);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getCaptureImage).toHaveBeenCalledWith('a1b2c3d4-e5f6-4789-a012-123456789abc', 'https://supplier.example.test/photo.webp');

    handler({ type: 'rivastock-capture-received', captureId: 'a1b2c3d4-e5f6-4789-a012-123456789abc' },
      sender('https://rivastock.vercel.app/revendedores'), reply);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(acknowledgeCapture).toHaveBeenCalledWith('a1b2c3d4-e5f6-4789-a012-123456789abc');
  });
});
