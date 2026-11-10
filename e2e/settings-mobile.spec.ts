import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

async function mockSettings(page: Parameters<typeof mockSales>[0]) {
  await mockSales(page);
  await page.route('**/rest/v1/catalog_config*', route => route.fulfill({ json: [{
    id: 'catalog-qa', user_id: '10000000-0000-4000-8000-000000000001',
    business_name: 'Negocio QA', slug: 'qa-catalog', enabled: true,
    show_prices: true, show_out_of_stock: false, show_stock: true, show_stock_quantity: false,
    welcome_message: 'Bienvenidos', primary_color: '#6366f1', accent_color: '#6366f1',
    allow_orders: true, layout: 'Grid', font_style: 'Modern',
  }] }));
}

test('mobile settings menu opens current settings screens and requires a typed business name for deletion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Mobile settings are verified on Android and iPhone projects.');
  await mockSettings(page);
  await page.addInitScript(() => localStorage.setItem('pwa-ios-install-hint-dismissed-at', String(Date.now())));
  await page.setViewportSize({ width: 360, height: 740 });
  const writes: string[] = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) && pathname.includes('/rest/v1/') && !pathname.includes('/rest/v1/rpc/')) writes.push(`${request.method()} ${pathname}`);
  });
  await page.goto('/config');

  const menu = page.getByTestId('mobile-settings-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Negocio QA')).toBeVisible();
  await menu.getByRole('button', { name: 'Instalar app' }).click();
  await expect(page.getByRole('dialog', { name: 'Instalar app' })).toBeVisible();
  await page.getByRole('button', { name: 'Listo' }).click();
  await menu.getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Datos del negocio' })).toBeVisible();
  await expect(page.getByText('Nombre del Negocio', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '‹ Volver a Configuración' }).click();

  await menu.getByRole('switch', { name: 'Modo oscuro' }).click();
  await expect(menu.getByRole('switch', { name: 'Modo oscuro' })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('button', { name: /Categorías/ }).click();
  await expect(page.getByRole('heading', { name: 'Categorías', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '‹ Volver a Configuración' })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('mobile-settings-menu')).toBeVisible();
  await page.getByTestId('mobile-settings-menu').getByRole('button', { name: /Categorías/ }).click();
  await expect(page.getByRole('heading', { name: 'Categorías', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '‹ Volver a Configuración' }).click();

  await menu.getByRole('button', { name: 'Eliminar todos los datos' }).click();
  await expect(page.getByRole('heading', { name: 'Zona de peligro', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar Datos' }).click();
  await page.getByLabel('Stock (productos)').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Confirmar eliminación' });
  await expect(confirmation.getByRole('button', { name: 'Borrar seleccionado' })).toBeDisabled();
  await confirmation.getByRole('textbox').fill('Otro negocio');
  await expect(confirmation.getByRole('button', { name: 'Borrar seleccionado' })).toBeDisabled();
  await confirmation.getByRole('textbox').fill('Negocio QA');
  await expect(confirmation.getByRole('button', { name: 'Borrar seleccionado' })).toBeEnabled();
  await confirmation.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('dialog', { name: 'Seleccionar datos a eliminar' }).getByRole('button', { name: 'Cancelar' }).click();

  expect(writes).toEqual([]);
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
});

test('desktop settings remain in their existing tab layout', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop settings are verified in Chromium.');
  await mockSettings(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/config');
  await expect(page.getByTestId('mobile-settings-menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'General' })).toBeVisible();
  await expect(page.getByText('Configuración', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Instalar app' }).click();
  await expect(page.getByRole('dialog', { name: 'Instalar app' })).toBeVisible();
  await page.getByRole('button', { name: 'Listo' }).click();
  await page.screenshot({ path: 'test-results/settings-desktop-1280.png', fullPage: true });
});
