import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

test('manual sale sends shipping separately and includes it in the collected total', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The focused shipping flow runs in Chromium.');
  await mockSales(page);
  await page.setViewportSize({ width: 360, height: 800 });

  let registration: Record<string, unknown> | null = null;
  await page.route('**/rest/v1/rpc/register_sale_with_shipping', async route => {
    registration = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: [{
        id: 'sale-shipping-qa',
        user_id: '10000000-0000-4000-8000-000000000001',
        total: 3_700,
        shipping_amount: 1_200,
        status: 'Pagado',
      }],
    });
  });

  await page.goto('/ventas');
  await page.getByRole('button', { name: /Nueva venta/i }).click();
  await page.getByPlaceholder('Buscar por nombre o categoría...').fill('Cámara WiFi');
  await page.getByRole('option').filter({ hasText: '[QA] Cámara WiFi' }).click();
  await page.getByRole('checkbox', { name: 'Con envío' }).check();
  const shippingInput = page.getByRole('textbox', { name: 'Costo de envío' });
  await shippingInput.fill('1200');
  await shippingInput.press('Tab');

  const dialog = page.getByRole('dialog', { name: 'Nueva Venta' });
  const total = dialog.getByText('Total a Cobrar:', { exact: true }).locator('..');
  await expect(total).toContainText('3.700');
  await expect(dialog.getByText('Envío', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Registrar Venta' }).click();

  await expect.poll(() => registration).toMatchObject({
    p_shipping_amount: 1_200,
    p_quantity: 1,
    p_unit_price: 2_500,
  });
  await expect(dialog).toHaveCount(0);
  await expect(page.evaluate(() => localStorage.getItem('rivastock:last-shipping-amount:10000000-0000-4000-8000-000000000001'))).resolves.toBe('1200');
});
