import { expect, test } from '@playwright/test';

test('manifest and installed icon files are local, valid PNGs at their declared sizes', async ({ request }) => {
  const manifestResponse = await request.get('/manifest.json');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as { icons: Array<{ src: string; sizes: string; type: string }> };
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }),
    expect.objectContaining({ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }),
  ]));

  for (const [path, size] of [['/icons/apple-touch-icon.png', 180], ['/icons/icon-192.png', 192], ['/icons/icon-512.png', 512]] as const) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be served`).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
    const png = Buffer.from(await response.body());
    expect(png.length).toBeGreaterThan(500);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  }

  const html = await request.get('/');
  expect(await html.text()).toContain('/icons/apple-touch-icon.png');
});

test('iPhone shows the three install steps and hides the hint for 30 days after dismissal', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('catalog-iphone-'), 'iPhone installation guidance is tested in WebKit iPhone projects.');
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('pwa-ios-test-initialized')) {
      localStorage.removeItem('pwa-ios-install-hint-shown-at');
      localStorage.removeItem('pwa-ios-install-hint-dismissed-at');
      sessionStorage.setItem('pwa-ios-test-initialized', 'true');
    }
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => false });
  });
  await page.goto('/login');
  const hint = page.getByRole('note', { name: 'Instalar RivaStock en iPhone' });
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Instalá RivaStock en tu iPhone');
  await expect(hint).toContainText('Compartir');
  await expect(hint).toContainText('Agregar a pantalla de inicio');
  await expect(hint).toContainText('Agregar');
  await expect(hint.locator('svg[aria-label="Compartir"]')).toBeAttached();
  await expect(hint.getByRole('button', { name: 'Cerrar aviso de instalación' })).toBeVisible();
  const submitBox = await page.getByRole('button', { name: 'Ingresar' }).boundingBox();
  const hintBox = await hint.boundingBox();
  expect(submitBox && hintBox && submitBox.y + submitBox.height < hintBox.y, JSON.stringify({ submitBox, hintBox })).toBe(true);
  await hint.getByRole('button', { name: 'Ahora no' }).click();
  await page.reload();
  await expect(page.getByRole('note', { name: 'Instalar RivaStock en iPhone' })).toHaveCount(0);
});

test('iPhone close button also dismisses the install hint for 30 days', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('catalog-iphone-'), 'iPhone installation guidance is tested in WebKit iPhone projects.');
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('pwa-ios-test-initialized')) {
      localStorage.removeItem('pwa-ios-install-hint-shown-at');
      localStorage.removeItem('pwa-ios-install-hint-dismissed-at');
      sessionStorage.setItem('pwa-ios-test-initialized', 'true');
    }
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => false });
  });
  await page.goto('/login');
  const hint = page.getByRole('note', { name: 'Instalar RivaStock en iPhone' });
  await expect(hint).toBeVisible();
  await hint.getByRole('button', { name: 'Cerrar aviso de instalación' }).click();
  await page.reload();
  await expect(page.getByRole('note', { name: 'Instalar RivaStock en iPhone' })).toHaveCount(0);
});

test('installed iPhone never shows the install hint', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('catalog-iphone-'), 'Installed mode is checked in WebKit iPhone projects.');
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
  });
  await page.goto('/login');
  await page.waitForTimeout(1300);
  await expect(page.getByRole('note', { name: 'Instalar RivaStock en iPhone' })).toHaveCount(0);
});

test('Android uses the native beforeinstallprompt event from its install button', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'catalog-android', 'Native browser installation is tested on the Android project.');
  await page.goto('/login');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted'; platform: string }>;
    };
    event.prompt = async () => { (window as Window & { __nativeInstallPrompted?: boolean }).__nativeInstallPrompted = true; };
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'webapp' });
    window.dispatchEvent(event);
  });
  const banner = page.getByRole('note', { name: 'Instalar RivaStock' });
  await expect(banner.getByRole('button', { name: 'Instalar app' })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Ahora no' })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Cerrar aviso de instalación' })).toBeVisible();
  await banner.getByRole('button', { name: 'Instalar app' }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __nativeInstallPrompted?: boolean }).__nativeInstallPrompted))).toBe(true);
  await expect(banner).toHaveCount(0);
});

test('Android dismissal hides the native install hint for 30 days', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'catalog-android', 'Native browser installation is tested on the Android project.');
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('pwa-android-test-initialized')) {
      localStorage.removeItem('pwa-android-install-hint-dismissed-at');
      sessionStorage.setItem('pwa-android-test-initialized', 'true');
    }
  });
  await page.goto('/login');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'dismissed'; platform: string }>;
    };
    event.prompt = async () => undefined;
    event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'webapp' });
    window.dispatchEvent(event);
  });
  const banner = page.getByRole('note', { name: 'Instalar RivaStock' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Ahora no' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'dismissed'; platform: string }>;
    };
    event.prompt = async () => undefined;
    event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'webapp' });
    window.dispatchEvent(event);
  });
  await expect(page.getByRole('note', { name: 'Instalar RivaStock' })).toHaveCount(0);
});
