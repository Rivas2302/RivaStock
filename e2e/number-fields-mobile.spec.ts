import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

test('mobile cash and sale number fields start ready for replacement and cancel without writes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'This keyboard flow runs on Android and iPhone projects.');
  await mockSales(page);
  await page.setViewportSize({ width: 360, height: 740 });

  await page.goto('/caja');
  await page.getByRole('button', { name: 'Gasto', exact: true }).click();
  const expenseDialog = page.getByRole('dialog', { name: 'Registrar Gasto' });
  const expenseAmount = expenseDialog.getByLabel('Monto');
  await expect(expenseAmount).toHaveAttribute('inputmode', 'decimal');
  await expect(expenseAmount).toHaveValue('');
  await expenseAmount.fill('125,50');
  await expenseDialog.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  const closingDialog = page.getByRole('dialog', { name: 'Cierre de caja' });
  const countedCash = closingDialog.getByLabel('Efectivo contado');
  await expect(countedCash).toHaveAttribute('inputmode', 'decimal');
  await expect(countedCash).toHaveValue('');
  await countedCash.fill('125,50');
  await page.keyboard.press('Escape');
  await expect(closingDialog).toHaveCount(0);

  await page.goto('/ventas');
  await page.getByRole('button', { name: 'Nueva Venta' }).click();
  await page.getByPlaceholder('Buscar por nombre o categoría...').fill('Cámara WiFi');
  await page.getByRole('option').filter({ hasText: '[QA] Cámara WiFi' }).click();
  const saleDialog = page.getByRole('dialog', { name: 'Nueva Venta' });
  const quantity = saleDialog.getByLabel('Cantidad');
  await expect(quantity).toHaveAttribute('inputmode', 'numeric');
  await quantity.focus();
  const selection = await quantity.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]);
  expect(selection).toEqual([0, (await quantity.inputValue()).length]);
  await page.keyboard.type('2');
  await expect(quantity).toHaveValue('2');
  await saleDialog.getByRole('button', { name: 'Cancelar' }).click();
});

