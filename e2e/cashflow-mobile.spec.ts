import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

const now = new Date().toISOString();
const today = new Intl.DateTimeFormat('sv-SE').format(new Date());

for (const width of [360]) {
  test(`mobile cash flow navigation and sheets at ${width}px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium', 'Cash flow mobile layout is covered on Android and iPhone.');
    await mockSales(page);
    const entries = [
      { id: 'expense-1', user_id: '10000000-0000-4000-8000-000000000001', date: today, created_at: now, type: 'Gasto', source: 'Gasto', description: '[QA] Alquiler', category: 'Servicios', amount: 1200, payment_method: 'Efectivo', status: 'Pagado', notes: '' },
      { id: 'income-1', user_id: '10000000-0000-4000-8000-000000000001', date: today, created_at: now, type: 'Ingreso', source: 'Manual', description: '[QA] Venta del día', category: 'Ventas', amount: 3000, payment_method: 'Efectivo', status: 'Pagado', notes: '' },
    ];
    await page.route('**/rest/v1/cash_flow*', route => {
      const url = new URL(route.request().url());
      return route.fulfill({ json: url.searchParams.has('id') ? [] : entries });
    });
    const writes: string[] = [];
    page.on('request', request => {
      if (/\/rest\/v1\/cash_flow(?:\?|$)/.test(request.url()) && ['POST', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.method());
    });
    await page.setViewportSize({ width, height: 740 });
    await page.goto('/caja');
    await expect(page.getByTestId('mobile-cash-flow')).toBeVisible();
    await expect(page.getByText('[QA] Alquiler')).toBeVisible();
    await expect(page.getByText('[QA] Venta del día')).toBeVisible();

    await page.getByRole('button', { name: 'Gasto', exact: true }).click();
    const movement = page.getByRole('dialog', { name: 'Nuevo movimiento' });
    const amount = movement.getByLabel('Monto del gasto');
    await expect(amount).toHaveAttribute('inputmode', 'decimal');
    await expect(amount).toHaveValue('');
    await expect(movement.getByLabel('Fecha')).toHaveValue(today);
    await page.keyboard.press('Escape');
    await expect(movement).toHaveCount(0);

    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    const closing = page.getByRole('dialog', { name: 'Cerrar caja' });
    await expect(closing.getByText('Efectivo esperado')).toBeVisible();
    await expect(closing.getByText('Entró en efectivo')).toBeVisible();
    const counted = closing.getByLabel('Efectivo contado');
    await counted.fill('1000');
    await expect(closing.getByText('Coincide')).toHaveCount(0);
    await expect(closing.locator('[aria-live="polite"]')).toContainText('Faltan');
    await page.keyboard.press('Escape');
    await expect(closing).toHaveCount(0);

    await page.getByRole('button', { name: /\[QA\] Alquiler/ }).click();
    const detail = page.getByRole('dialog', { name: 'Detalle del movimiento' });
    await expect(detail.getByText('Servicios')).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Editar' })).toBeVisible();
    await detail.getByRole('button', { name: 'Eliminar' }).click();
    const confirmation = page.getByRole('alertdialog', { name: 'Eliminar movimiento' });
    await expect(confirmation).toBeVisible();
    await page.goBack();
    await expect(confirmation).toHaveCount(0);
    await expect(detail).toBeVisible();
    await page.goBack();
    await expect(detail).toHaveCount(0);

    await page.getByRole('button', { name: 'Gastos', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Servicios', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Servicios', exact: true }).click();
    await expect(page.getByText('[QA] Alquiler')).toBeVisible();
    await expect(page.getByText('[QA] Venta del día')).toHaveCount(0);
    await page.getByLabel('Buscar movimientos').fill('alquiler');
    await expect(page.getByText('[QA] Alquiler')).toBeVisible();
    await expect(writes).toEqual([]);
    await testInfo.attach(`${testInfo.project.name}-cash-flow-mobile`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
