import { expect, test } from '@playwright/test';
import { mockSales } from './mock-sales';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';

test('changing only the ribbon color saves it and applies it to the public catalog', async ({ page }) => {
  await mockSales(page);

  let catalogConfig: Record<string, unknown> = {
    id: 'catalog-qa', user_id: OWNER_ID, business_name: 'Negocio QA', slug: 'qa-catalog',
    enabled: true, show_prices: true, show_out_of_stock: false, show_stock: true, show_stock_quantity: false,
    welcome_message: 'Bienvenidos', primary_color: '#3156A6', accent_color: '#3156A6',
    allow_orders: true, layout: 'Grid', font_style: 'Modern', announcement_color: null,
    presentation: {
      theme: 'normal', schedules: [], heroTitle: 'Encontrá lo que buscás', heroDescription: 'Bienvenidos',
      heroImageUrl: null, useBusinessCover: false, heroColor: '#172033', accentColor: '#3156A6',
      sections: [{ id: 'featured', visible: true }, { id: 'offers', visible: true }, { id: 'categories', visible: true }, { id: 'new', visible: false }, { id: 'all', visible: true }],
      featuredMode: 'manual', featuredProductIds: [], featuredCategoryId: null, offerProductIds: [],
      offerDiscountPercentByProduct: {}, offerEndsAt: null,
      ambience: { intensity: 'normal', animatedEffects: false, headerDecoration: false, productDecoration: false, countdown: false, announcementText: 'Envíos en General Pico', themedFont: false, welcomeCard: false },
      showWhatsAppButton: true, showProductsWithoutPhoto: true,
      whatsappMessageTemplate: 'Hola, quiero {producto} por {precio}. {link}',
    },
  };

  await page.route('**/rest/v1/catalog_config*', async route => {
    if (route.request().method() === 'PATCH') {
      catalogConfig = { ...catalogConfig, ...route.request().postDataJSON() as Record<string, unknown> };
      return route.fulfill({ json: catalogConfig });
    }
    return route.fulfill({ json: [catalogConfig] });
  });

  await page.goto('/config?tab=catalog');
  await expect(page.getByRole('heading', { name: 'Tu catálogo' })).toBeVisible();
  await page.getByRole('button', { name: /Tema y ambientación/ }).click();

  const ribbonMode = page.getByRole('combobox', { name: 'Color de la cinta' });
  await ribbonMode.selectOption('custom');
  await page.getByRole('button', { name: 'Verde' }).click();
  const save = page.getByRole('button', { name: 'Guardar cambios' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  expect(catalogConfig.announcement_color).toBe('#15803D');

  await page.goto('/catalogo/qa-catalog');
  const announcement = page.getByRole('note', { name: 'Anuncio del catálogo' });
  await expect(announcement).toBeVisible();
  await expect(announcement).toHaveCSS('background-color', 'rgb(21, 128, 61)');
});

test('catalog WhatsApp inquiry message can be edited, previewed, and used by the floating button', async ({ page }) => {
  await mockSales(page);
  let catalogConfig: Record<string, unknown> = {
    id: 'catalog-qa', user_id: OWNER_ID, business_name: 'Negocio QA', slug: 'qa-catalog',
    enabled: true, show_prices: true, show_out_of_stock: false, show_stock: true, show_stock_quantity: false,
    welcome_message: 'Bienvenidos', primary_color: '#3156A6', accent_color: '#3156A6',
    allow_orders: true, layout: 'Grid', font_style: 'Modern', announcement_color: null,
    whatsapp_number: '5492302000000',
    presentation: {
      theme: 'normal', schedules: [], heroTitle: 'Negocio QA', heroDescription: 'Bienvenidos',
      heroImageUrl: null, useBusinessCover: false, heroColor: '#172033', accentColor: '#3156A6',
      sections: [{ id: 'all', visible: true }], featuredProductIds: [], offerProductIds: [],
      ambience: { intensity: 'normal', animatedEffects: false, headerDecoration: false, productDecoration: false, countdown: false, announcementText: '' },
      showWhatsAppButton: true, whatsappMessageTemplate: 'Hola por {producto}',
    },
  };
  await page.route('**/rest/v1/catalog_config*', async route => {
    if (route.request().method() === 'PATCH') {
      catalogConfig = { ...catalogConfig, ...route.request().postDataJSON() as Record<string, unknown> };
      return route.fulfill({ json: catalogConfig });
    }
    return route.fulfill({ json: [catalogConfig] });
  });

  await page.goto('/config?tab=catalog');
  await expect(page.getByRole('heading', { name: 'Tu catálogo' })).toBeVisible();
  await page.getByRole('button', { name: /WhatsApp y pedidos online/ }).click();
  const message = page.getByRole('textbox', { name: 'Mensaje al consultar el catálogo' });
  await message.fill('Hola {negocio}! Consulto por el catálogo: {link}');
  await expect(page.getByLabel('Vista previa del mensaje de WhatsApp')).toContainText('Hola Negocio QA! Consulto por el catálogo:');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  expect((catalogConfig.presentation as Record<string, unknown>).whatsappCatalogMessageTemplate).toBe('Hola {negocio}! Consulto por el catálogo: {link}');

  await page.goto('/catalogo/qa-catalog');
  const floatingButton = page.getByTestId('catalog-floating-whatsapp');
  const href = new URL(await floatingButton.getAttribute('href') ?? '');
  expect(href.hostname).toBe('wa.me');
  expect(href.pathname).toBe('/5492302000000');
  expect(href.searchParams.get('text')).toBe('Hola Negocio QA! Consulto por el catálogo: http://127.0.0.1:4173/p/qa-catalog');
});
