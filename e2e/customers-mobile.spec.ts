import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

async function mockCustomers(page: Parameters<typeof mockSales>[0]) {
  await mockSales(page);
  const rows = [
    { id: 'customer-due', user_id: '10000000-0000-4000-8000-000000000001', name: 'Micaela Torres', name_lower: 'micaela torres', phone: '+54 9 11 5555-0101', current_balance: 124900, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'customer-clear', user_id: '10000000-0000-4000-8000-000000000001', name: 'Bruno Aguirre', name_lower: 'bruno aguirre', phone: '11 5555-0102', current_balance: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'customer-credit', user_id: '10000000-0000-4000-8000-000000000001', name: 'Andrea Juárez', name_lower: 'andrea juárez', phone: '11 5555-0103', current_balance: -2500, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ];
  await page.route('**/rest/v1/customers*', route => {
    const cursor = new URL(route.request().url()).searchParams.get('id');
    return route.fulfill({ json: cursor ? [] : rows });
  });
}

test('mobile customer list filters balances, links WhatsApp and opens full-screen account details without writes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Mobile layouts run on Android and iPhone projects.');
  await mockCustomers(page);
  await page.setViewportSize({ width: 360, height: 740 });
  let browserDialogs = 0;
  page.on('dialog', async dialog => { browserDialogs++; await dialog.dismiss(); });
  await page.goto('/clientes');

  const mobile = page.getByTestId('mobile-customers');
  await expect(mobile).toBeVisible();
  await expect(mobile.getByLabel('Resumen de cuentas corrientes')).toContainText('124.900');
  await expect(mobile.getByLabel('Resumen de cuentas corrientes')).toContainText('1 clientes con saldo pendiente');
  await expect(mobile.locator('article')).toHaveCount(3);
  await expect(mobile.getByRole('link', { name: 'Escribirle por WhatsApp a Micaela Torres' })).toHaveAttribute('href', /wa\.me\/5491155550101/);

  await mobile.getByRole('button', { name: 'Cobrar' }).click();
  await expect(mobile.getByRole('button', { name: /Deben/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(mobile.locator('article')).toHaveCount(1);
  await mobile.getByRole('searchbox', { name: 'Buscar cliente' }).fill('Micaela');
  await expect(mobile.locator('article')).toHaveCount(1);
  await mobile.getByRole('searchbox', { name: 'Buscar cliente' }).fill('');
  await mobile.getByRole('button', { name: /Al día/ }).click();
  await expect(mobile.locator('article')).toHaveCount(2);

  await mobile.getByRole('button', { name: /Bruno Aguirre/ }).click();
  const ficha = page.getByRole('dialog', { name: 'Ficha del Cliente' });
  await expect(ficha).toBeVisible();
  await expect(ficha.getByText('Bruno Aguirre')).toBeVisible();
  await expect(ficha.getByRole('button', { name: 'Editar cliente' })).toBeVisible();
  await ficha.getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByRole('dialog', { name: 'Eliminar cliente' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  expect(browserDialogs).toBe(0);
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
});

test('desktop customers remain a table', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop layout is verified in Chromium.');
  await mockCustomers(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/clientes');
  await expect(page.getByTestId('mobile-customers')).toHaveCount(0);
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('table').getByText('Micaela Torres')).toBeVisible();
});
