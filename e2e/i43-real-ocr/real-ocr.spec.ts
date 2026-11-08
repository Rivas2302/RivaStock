import { expect, test } from '@playwright/test';

test('real Spanish OCR starts with the exact production CSP and reads marked, clean, and price-list images', async ({ page }) => {
  const pageErrors: string[] = [];
  const securityErrors: string[] = [];
  const tesseractResponses: Array<{ path: string; status: number; csp: string | undefined }> = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/tesseract/')) {
      void response.allHeaders().then(headers => tesseractResponses.push({
        path: url.pathname,
        status: response.status(),
        csp: headers['content-security-policy'],
      }));
    }
  });
  page.on('console', message => {
    if (message.type() === 'error' && /Content Security Policy|WebAssembly|wasm|tesseract/i.test(message.text())) {
      securityErrors.push(message.text());
    }
  });

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self' 'wasm-unsafe-eval'");
  await page.waitForFunction(() => Boolean((window as Window & { __I43_REAL_OCR_RESULT__?: unknown }).__I43_REAL_OCR_RESULT__), null, { timeout: 60_000 });

  const result = await page.evaluate(() => (window as Window & {
    __I43_REAL_OCR_RESULT__?: { marked?: boolean; clean?: boolean; listText?: string; fakeWorkerInstalled?: boolean; error?: string };
  }).__I43_REAL_OCR_RESULT__);
  expect(result?.error).toBeUndefined();
  expect(result?.fakeWorkerInstalled).toBe(false);
  expect(result?.marked).toBe(true);
  expect(result?.clean).toBe(false);
  expect(result?.listText?.toLocaleUpperCase('es-AR')).toContain('CABLE');
  expect(tesseractResponses.some(item => item.path.endsWith('/worker.min.js') && item.status === 200)).toBe(true);
  expect(tesseractResponses.some(item => /tesseract-core-(?:simd-)?lstm\.wasm\.js$/.test(item.path) && item.status === 200)).toBe(true);
  expect(tesseractResponses.some(item => item.path.endsWith('/spa.traineddata.gz') && item.status === 200)).toBe(true);
  expect(tesseractResponses.every(item => item.csp?.includes("'wasm-unsafe-eval'"))).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(securityErrors).toEqual([]);
});
