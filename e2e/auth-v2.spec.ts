import { expect, test } from '@playwright/test';

for (const width of [390, 1280]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`auth layout follows ${colorScheme} system colors at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await page.emulateMedia({ colorScheme });
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Ingresá a tu cuenta' })).toBeVisible();
      const colors = await page.locator('.auth-v2-page').evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      });
      expect(colors.background).toBe(colorScheme === 'dark' ? 'rgb(18, 18, 18)' : 'rgb(255, 255, 255)');
      expect(colors.color).toBe(colorScheme === 'dark' ? 'rgb(242, 242, 242)' : 'rgb(25, 25, 25)');
      await expect(page.locator('.auth-v2-aside')).toHaveCSS('display', width < 768 ? 'none' : 'flex');
      if (width < 768) await expect(page.locator('#login-email')).toHaveCSS('font-size', '16px');
      await expect(page.getByRole('link', { name: 'Pedila por WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\//);
    });
  }
}

test('login errors stay in clear Spanish and do not create accounts', async ({ page }) => {
  await page.route('**/auth/v1/token**', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Invalid login credentials' }) }));
  await page.goto('/login');
  await page.getByLabel('Email').fill('fixture@example.invalid');
  await page.locator('#login-password').fill('incorrecta');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email o contraseña incorrectos.');
  await expect(page.getByText(/Registrate|Crear cuenta/i)).toHaveCount(0);
});

test('password recovery uses the same layout and reports the generic sent-link state', async ({ page }) => {
  await page.route('**/auth/v1/recover**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: 'Recuperá tu contraseña' })).toBeVisible();
  await page.getByLabel('Email').fill('fixture@example.invalid');
  await page.getByRole('button', { name: 'Enviar link de recuperación' }).click();
  await expect(page.getByRole('status')).toContainText('Si el email existe, vas a recibir un link');
});
