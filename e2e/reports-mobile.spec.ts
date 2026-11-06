import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

function reportFixture() {
  const today = new Date();
  const ymd = (offset: number) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const sales = Array.from({ length: 8 }, (_, index) => ({
    id: `report-sale-${index + 1}`, date: ymd(index % 7), productName: `Producto QA ${index + 1}`,
    quantity: index + 1, unitPrice: 2500, total: (index + 1) * 2500,
    paymentMethod: index % 2 ? 'Transferencia' : 'Efectivo', status: index === 1 ? 'Pendiente' : 'Pagado',
  }));
  return {
    kpis: { totalSales: 52500, transactionCount: 8, paidCount: 7, pendingCount: 1, averageTicket: 7500, pendingAmount: 5000 },
    daily: Array.from({ length: 7 }, (_, index) => ({ date: ymd(6 - index), total: (index + 1) * 5000, count: index + 1 })),
    byPayment: [{ paymentMethod: 'Efectivo', total: 30000, count: 4 }, { paymentMethod: 'Transferencia', total: 22500, count: 3 }],
    topProducts: [
      { productId: 'p1', productName: 'Auricular QA', quantity: 6, revenue: 30000 },
      { productId: 'p2', productName: 'Cable QA', quantity: 4, revenue: 22500 },
    ],
    sales,
    range: { from: ymd(6), to: ymd(0) },
  };
}

async function mockReport(page: Parameters<typeof mockSales>[0]) {
  await mockSales(page);
  const fixture = reportFixture();
  await page.route('**/rest/v1/rpc/get_sales_report', route => route.fulfill({ json: fixture }));
}

test('mobile reports show period controls, KPI cards, charts and expandable sale cards without writes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'Mobile layouts run on Android and iPhone projects.');
  await mockReport(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/reportes');

  const mobile = page.getByTestId('mobile-reports');
  await expect(mobile).toBeVisible();
  await expect(mobile.getByRole('heading', { name: 'Reportes' })).toBeVisible();
  await expect(mobile.getByRole('button', { name: '7 días' })).toHaveAttribute('aria-pressed', 'true');
  await expect(mobile.getByLabel('Resumen de ventas')).toContainText('52.500');
  await expect(mobile.getByRole('img', { name: /Gráfico de barras/ })).toBeVisible();
  await expect(mobile.getByRole('heading', { name: 'Productos más vendidos' })).toBeVisible();
  await expect(mobile.getByRole('heading', { name: 'Cómo te pagaron' })).toBeVisible();
  await expect(mobile.locator('article')).toHaveCount(5);
  await mobile.getByRole('button', { name: /Ver todas las ventas/ }).click();
  await expect(mobile.locator('article')).toHaveCount(8);

  await mobile.getByRole('button', { name: 'Elegir fechas' }).click();
  await expect(mobile.getByRole('region', { name: 'Elegir fechas' })).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);

  await mobile.getByRole('button', { name: 'Más opciones: exportar el reporte' }).click();
  await expect(mobile.getByRole('menuitem', { name: 'Exportar Excel' })).toBeEnabled();
  await expect(mobile.getByRole('menuitem', { name: 'Exportar PDF' })).toBeEnabled();
  const button = await mobile.getByRole('button', { name: 'Hoy' }).boundingBox();
  expect(button?.height).toBeGreaterThanOrEqual(44);
});

test('desktop reports keep the existing analytics and wide sales table', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop layout is verified in Chromium.');
  await mockReport(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/reportes');
  await expect(page.getByTestId('mobile-reports')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Reportes y Analytics' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('table').getByText('Producto QA 1')).toBeVisible();
});
