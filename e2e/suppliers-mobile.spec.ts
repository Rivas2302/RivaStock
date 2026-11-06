import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

async function mockSuppliers(page: Parameters<typeof mockSales>[0]) {
  await mockSales(page);
  const rows = [
    { id: 'supplier-a', user_id: '10000000-0000-4000-8000-000000000001', name: 'Distribuidora Norte', name_lower: 'distribuidora norte', contact_name: 'Micaela', phone: '+54 9 11 5555-0101', email: 'ventas@example.test', address: 'Av. QA 123', category: 'Tecnología', payment_terms: 'Contado', catalog_url: 'https://example.test/catalogo', facebook_url: 'https://facebook.com/example', instagram_url: 'https://instagram.com/example', is_active: true },
    { id: 'supplier-b', user_id: '10000000-0000-4000-8000-000000000001', name: 'Juguetes Delta', name_lower: 'juguetes delta', contact_name: 'Bruno', phone: '11 5555-0102', category: 'Juguetes', payment_terms: 'Cuenta corriente', is_active: true },
    { id: 'supplier-c', user_id: '10000000-0000-4000-8000-000000000001', name: 'Aromas Sur', name_lower: 'aromas sur', phone: '11 5555-0103', category: 'Perfumería', is_active: false },
  ];
  await page.route('**/rest/v1/suppliers*', route => route.fulfill({ json: rows }));
}

test('mobile suppliers filter, search and expose contact and catalog links without writes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Mobile layouts run on Android and iPhone projects.');
  await mockSuppliers(page);
  await page.setViewportSize({ width: 360, height: 740 });
  let browserDialogs = 0;
  page.on('dialog', async dialog => { browserDialogs++; await dialog.dismiss(); });
  await page.goto('/proveedores');

  const mobile = page.getByTestId('mobile-suppliers');
  await expect(mobile).toBeVisible();
  await expect(mobile.getByLabel('Resumen de proveedores')).toContainText('2 de 3');
  await expect(mobile.getByLabel('Resumen de proveedores')).toContainText('Tecnología');
  await expect(mobile.locator('article')).toHaveCount(3);
  await expect(mobile.getByRole('link', { name: 'WhatsApp de Distribuidora Norte' })).toHaveAttribute('href', /wa\.me\/5491155550101/);
  await expect(mobile.getByRole('link', { name: 'Llamar a Distribuidora Norte' })).toHaveAttribute('href', /^tel:/);
  await expect(mobile.getByRole('link', { name: 'Abrir catálogo de Distribuidora Norte' })).toHaveAttribute('href', 'https://example.test/catalogo');

  await mobile.getByRole('button', { name: 'Solo activos' }).click();
  await expect(mobile.locator('article')).toHaveCount(2);
  await mobile.getByRole('searchbox', { name: 'Buscar proveedor' }).fill('Juguetes');
  await expect(mobile.locator('article')).toHaveCount(1);
  await mobile.getByRole('searchbox', { name: 'Buscar proveedor' }).fill('');
  await mobile.getByRole('button', { name: 'Tecnología' }).click();
  await expect(mobile.locator('article')).toHaveCount(1);
  await mobile.locator('article').getByRole('button').first().click();
  const detail = page.getByRole('dialog', { name: 'Detalle del proveedor' });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://instagram.com/example');
  await expect(detail.getByRole('link', { name: 'Facebook' })).toHaveAttribute('href', 'https://facebook.com/example');
  await expect(detail.getByRole('button', { name: 'Editar proveedor' })).toBeVisible();
  await detail.getByRole('button', { name: 'Cerrar' }).click();
  await mobile.getByRole('button', { name: 'Más opciones para Distribuidora Norte' }).click();
  await mobile.getByRole('menuitem', { name: 'Eliminar proveedor' }).click();
  await expect(page.getByRole('dialog', { name: 'Eliminar proveedor' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  expect(browserDialogs).toBe(0);
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
});

test('desktop suppliers remain a table', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop layout is verified in Chromium.');
  await mockSuppliers(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/proveedores');
  await expect(page.getByTestId('mobile-suppliers')).toHaveCount(0);
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('table').getByText('Distribuidora Norte')).toBeVisible();
});
