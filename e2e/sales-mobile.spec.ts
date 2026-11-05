import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

test('mobile sale picker previews photos, handles missing photos and never blocks product selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Touch flows run on Android and iPhone projects.');
  await mockSales(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/ventas');
  await page.getByRole('button', { name: 'Nueva Venta' }).click();

  const search = page.getByPlaceholder('Buscar por nombre o categoría...');
  await search.fill('Cámara WiFi');
  const camera = page.getByRole('option').filter({ hasText: '[QA] Cámara WiFi' });
  await expect(camera.locator('img')).toHaveAttribute('src', /camera-a\.webp$/);
  await camera.click();
  const preview = page.getByTestId('selected-product-preview');
  await expect(preview).toContainText('[QA] Cámara WiFi');
  await expect(preview).toContainText('3 disponibles');
  await preview.getByRole('button', { name: 'Ver fotos de [QA] Cámara WiFi' }).click();
  const gallery = page.getByRole('dialog', { name: 'Fotos de [QA] Cámara WiFi' });
  await expect(gallery.locator('img')).toHaveAttribute('src', /camera-a\.webp$/);
  await gallery.getByRole('button', { name: 'Foto siguiente' }).click();
  await expect(gallery.locator('img')).toHaveAttribute('src', /camera-b\.webp$/);
  await page.keyboard.press('Escape');
  await expect(gallery).toHaveCount(0);
  await preview.getByRole('button', { name: 'Ver fotos de [QA] Cámara WiFi' }).click();
  await page.getByRole('button', { name: 'Cerrar fotos' }).click();
  await expect(gallery).toHaveCount(0);
  await preview.getByRole('button', { name: 'Ver fotos de [QA] Cámara WiFi' }).click();
  await gallery.click({ position: { x: 2, y: 2 } });
  await expect(gallery).toHaveCount(0);
  await preview.getByRole('button', { name: 'Ver fotos de [QA] Cámara WiFi' }).click();
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole('dialog', { name: 'Fotos de [QA] Cámara WiFi' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Nueva Venta' })).toBeVisible();

  await page.getByRole('button', { name: 'Cambiar' }).click();
  await search.fill('iPhone C');
  const cable = page.getByRole('option').filter({ hasText: '[QA] Cable iPhone C' });
  await expect(cable.locator('svg[aria-label="Sin imagen para [QA] Cable iPhone C"]')).toBeVisible();
  await cable.click();
  await expect(page.getByTestId('selected-product-preview')).toContainText('2 disponibles');
  await expect(page.getByTestId('selected-product-preview').locator('svg[aria-label="Sin imagen para [QA] Cable iPhone C"]')).toBeVisible();

  await page.getByRole('button', { name: 'Cambiar' }).click();
  await search.fill('foto rota');
  const broken = page.getByRole('option').filter({ hasText: '[QA] Producto con foto rota' });
  await expect(broken.locator('svg[aria-label="Sin imagen para [QA] Producto con foto rota"]')).toBeVisible();
  await broken.click();
  await expect(page.getByTestId('selected-product-preview')).toContainText('[QA] Producto con foto rota');
  await expect(page.getByRole('button', { name: /Registrar Venta/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Registrar Venta/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Registrar Venta/ })).not.toBeDisabled();
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

test('desktop product picker screenshot at 1280px without registering a sale', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop screenshot runs in Chromium.');
  await mockSales(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/ventas');
  await page.getByRole('button', { name: 'Nueva Venta' }).click();
  const search = page.getByPlaceholder('Buscar por nombre o categoría...');
  await search.fill('Cámara WiFi');
  await page.getByRole('option').filter({ hasText: '[QA] Cámara WiFi' }).click();
  await expect(page.getByTestId('selected-product-preview')).toBeVisible();
  await testInfo.attach('desktop-sales-product-photo-preview-1280x900', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'Cancelar' }).click();
});
