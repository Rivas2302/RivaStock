import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

async function mockQuotes(page: Parameters<typeof mockSales>[0]) {
  await mockSales(page);
  const expiresAt = new Date(Date.now() + 2 * 86400000).toISOString();
  await page.route('**/rest/v1/quotes*', route => route.fulfill({ json: [
    { id: 'quote-sent', user_id: '10000000-0000-4000-8000-000000000001', number: 'P-0007', client_id: 'customer-1', client_name: 'Cliente QA', client_phone: '1111111111', items: [{ productId: 'camera', productName: 'Cámara', quantity: 2, unitPrice: 2500, subtotal: 5000 }], subtotal: 5000, discount: 0, total: 5000, status: 'sent', valid_days: 15, expires_at: expiresAt, notes: '', created_at: expiresAt, updated_at: expiresAt, converted_to_sale_id: null },
    { id: 'quote-accepted', user_id: '10000000-0000-4000-8000-000000000001', number: 'P-0008', client_id: 'customer-2', client_name: 'María QA', client_phone: null, items: [{ productId: 'cable', productName: 'Cable', quantity: 1, unitPrice: 1500, subtotal: 1500 }, { productId: 'camera', productName: 'Cámara', quantity: 1, unitPrice: 2500, subtotal: 2500 }], subtotal: 4000, discount: 0, total: 4000, status: 'accepted', valid_days: 15, expires_at: expiresAt, notes: '', created_at: expiresAt, updated_at: expiresAt, converted_to_sale_id: null },
  ] }));
}

test('mobile quotes search, filter, share and convert using app sheets without writing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Mobile layouts run on Android and iPhone projects.');
  await mockQuotes(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/presupuestos');

  const mobile = page.getByTestId('mobile-quotes');
  await expect(mobile).toBeVisible();
  await expect(mobile.getByRole('button', { name: 'Nuevo presupuesto' })).toBeEnabled();
  await expect(mobile.getByLabel('Resumen de presupuestos')).toContainText('2');
  await expect(mobile.getByRole('button', { name: /Pasar a venta/ })).toBeVisible();
  await mobile.getByRole('button', { name: /Compartir/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Compartir Presupuesto' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).click().catch(() => undefined);

  await mobile.getByRole('searchbox', { name: 'Buscar presupuesto' }).fill('María');
  await expect(mobile.locator('article')).toHaveCount(1);
  await expect(mobile.getByText('P-0008')).toBeVisible();
  await mobile.getByRole('searchbox', { name: 'Buscar presupuesto' }).fill('');
  await mobile.getByRole('button', { name: 'Todos' }).click();
  await mobile.getByRole('button', { name: 'Enviados' }).click();
  await expect(mobile.locator('article')).toHaveCount(1);
  await expect(mobile.getByText('P-0007')).toBeVisible();
  await mobile.getByRole('button', { name: /Eliminar/ }).click();
  await expect(page.getByRole('heading', { name: 'Eliminar presupuesto' })).toBeVisible();
  await expect(page.getByText(/¿Querés eliminar/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByTestId('mobile-quotes')).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
});

test('desktop quotes remain a table', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop layout is verified in Chromium.');
  await mockQuotes(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/presupuestos');
  await expect(page.getByTestId('mobile-quotes')).toHaveCount(0);
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('table').getByText('P-0007')).toBeVisible();
});
