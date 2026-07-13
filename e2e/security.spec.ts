import { expect, test } from '@playwright/test';

const protectedRoutes = ['/', '/stock', '/ventas', '/reportes', '/pos', '/presupuestos', '/clientes', '/proveedores', '/ingresos', '/caja', '/pedidos', '/config', '/trazabilidad'];

for (const route of protectedRoutes) {
  test(`blocks anonymous access to ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
  });
}

test('keeps intended public routes outside the authenticated shell', async ({ page }) => {
  await page.goto('/forgot-password');
  await expect(page).toHaveURL(/\/forgot-password$/);
});
