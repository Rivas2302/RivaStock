import { describe, expect, it, vi } from 'vitest';
import { createCatalogPreviewHandler } from './catalog-preview.js';

function responseRecorder() {
  return {
    headers: {} as Record<string, string>,
    statusCode: 200,
    body: '',
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; return this; },
    status(code: number) { this.statusCode = code; return this; },
    end(value?: string) { this.body = value ?? ''; return this; },
  };
}

describe('Vercel catalog preview proxy', () => {
  const userAgent = 'WhatsApp/2.24';

  it('proxies only a validated public slug and preserves upstream metadata headers', async () => {
    const fetcher = vi.fn(async () => new Response('<title>Negocio</title><meta property="og:title">', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, s-maxage=300' },
    }));
    const response = responseRecorder();
    await createCatalogPreviewHandler(fetcher as typeof fetch)({
      method: 'GET', headers: { 'user-agent': userAgent, host: 'rivastock.vercel.app' },
      query: { slug: 'bazar-prueba' },
    }, response);

    const upstreamUrl = new URL(String(fetcher.mock.calls[0][0]));
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('og:title');
    expect(response.headers['content-type']).toContain('text/html');
    expect(upstreamUrl.searchParams.get('slug')).toBe('bazar-prueba');
    expect(upstreamUrl.searchParams.get('canonical')).toBe('catalogo');
  });

  it('passes an optional product UUID without accepting arbitrary hosts or methods', async () => {
    const fetcher = vi.fn(async () => new Response('ok'));
    const handler = createCatalogPreviewHandler(fetcher as typeof fetch);
    const badHost = responseRecorder();
    await handler({ method: 'GET', headers: { 'user-agent': userAgent, host: 'evil.example' }, query: { slug: 'bazar' } }, badHost);
    expect(badHost.statusCode).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();

    const method = responseRecorder();
    await handler({ method: 'POST', headers: { 'user-agent': userAgent }, query: { slug: 'bazar' } }, method);
    expect(method.statusCode).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not proxy malformed identifiers or ordinary browser requests', async () => {
    const fetcher = vi.fn(async () => new Response('ok'));
    const handler = createCatalogPreviewHandler(fetcher as typeof fetch);
    const invalidId = responseRecorder();
    await handler({ method: 'GET', headers: { 'user-agent': userAgent, host: 'rivastock.vercel.app' }, query: { slug: 'bazar', productId: 'bad' } }, invalidId);
    const browser = responseRecorder();
    await handler({ method: 'GET', headers: { 'user-agent': 'Mozilla/5.0', host: 'rivastock.vercel.app' }, query: { slug: 'bazar' } }, browser);
    expect(invalidId.statusCode).toBe(404);
    expect(browser.statusCode).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
