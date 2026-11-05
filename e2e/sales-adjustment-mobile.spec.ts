import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

test('mobile manual sales and POS accept a discount without a minus key or creating a sale', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Touch adjustment flow runs on Android and iPhone projects.');
  await mockSales(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/ventas');
  await page.getByRole('button', { name: 'Nueva Venta' }).click();
  await page.getByPlaceholder('Buscar por nombre o categoría...').fill('Cámara WiFi');
  await page.getByRole('option').filter({ hasText: '[QA] Cámara WiFi' }).click();

  const saleDialog = page.getByRole('dialog', { name: 'Nueva Venta' });
  const saleAdjustment = saleDialog.getByLabel('Monto de descuento');
  await expect(saleAdjustment).toHaveAttribute('inputmode', 'decimal');
  await saleAdjustment.fill('1000');
  await expect(saleDialog.getByText(/Descuento: −/)).toContainText('1.000');
  await expect(saleDialog.getByText('Subtotal', { exact: true })).toBeVisible();
  await expect(saleDialog.getByText('Total a Cobrar:', { exact: true })).toBeVisible();
  await saleDialog.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('button', { name: 'Modo POS' }).click();
  const posAdjustment = page.getByLabel('Monto de descuento');
  await expect(posAdjustment).toHaveAttribute('inputmode', 'decimal');
  await posAdjustment.fill('500');
  await expect(page.getByText(/Descuento: −/)).toContainText('500');
  await expect(page.getByText(/Subtotal/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cobrar' })).toBeDisabled();
});
