import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

async function mockIntakes(page: Parameters<typeof mockSales>[0]) {
  await mockSales(page);
  const date = (offset: number) => {
    const value = new Date();
    value.setDate(value.getDate() - offset);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  };
  await page.route('**/rest/v1/stock_intakes*', route => route.fulfill({ json: [
    { id: 'intake-a', user_id: '10000000-0000-4000-8000-000000000001', date: date(0), product_id: 'camera', product_name: '[QA] Cámara WiFi', quantity: 3, purchase_price: 2000, supplier: 'Distribuidora QA', inventory_owner_name: 'Principal', created_at: new Date().toISOString() },
    { id: 'intake-b', user_id: '10000000-0000-4000-8000-000000000001', date: date(0), product_id: 'cable', product_name: '[QA] Cable iPhone C', quantity: 2, purchase_price: 1500, supplier: 'Mayorista QA', inventory_owner_name: 'Sucursal Centro', created_at: new Date().toISOString() },
    { id: 'intake-c', user_id: '10000000-0000-4000-8000-000000000001', date: date(1), product_id: 'broken', product_name: '[QA] Producto con foto rota', quantity: 1, purchase_price: 750, supplier: '', created_at: new Date().toISOString() },
  ] }));
}

test('mobile intake shows month totals, lazy thumbnails, date groups, search and existing form without saving', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Mobile layouts run on Android and iPhone projects.');
  await mockIntakes(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/ingresos');
  const mobile = page.getByTestId('mobile-intake');
  await expect(mobile).toBeVisible();
  await expect(mobile.getByRole('button', { name: 'Registrar ingreso' })).toBeEnabled();
  await expect(mobile.getByRole('button', { name: 'Escanear' })).toBeEnabled();
  await expect(mobile.getByLabel('Resumen del mes')).toContainText('9.750');
  await expect(mobile.getByLabel('Resumen del mes')).toContainText('6');
  await expect(mobile.locator('article')).toHaveCount(3);
  const cameraCard = mobile.locator('article').filter({ hasText: 'Cámara WiFi' });
  await expect(cameraCard.locator('img')).toHaveAttribute('loading', 'lazy');
  await expect(cameraCard.locator('img')).toHaveAttribute('src', /camera-a\.thumb\.webp$/);
  await expect(mobile.getByTestId('mobile-intake-day')).toHaveCount(2);

  await mobile.getByRole('searchbox', { name: 'Buscar ingreso' }).fill('Mayorista');
  await expect(mobile.locator('article')).toHaveCount(1);
  await expect(mobile.getByText('Sucursal Centro')).toBeVisible();
  await mobile.getByRole('searchbox', { name: 'Buscar ingreso' }).fill('');
  await mobile.getByRole('button', { name: 'Registrar ingreso' }).click();
  await expect(page.getByRole('dialog', { name: 'Registrar Ingreso de Mercadería' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
});

test('desktop intake keeps its existing history table', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop layout is verified in Chromium.');
  await mockIntakes(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/ingresos');
  await expect(page.getByTestId('mobile-intake')).toHaveCount(0);
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('table').getByText('[QA] Cámara WiFi')).toBeVisible();
});
