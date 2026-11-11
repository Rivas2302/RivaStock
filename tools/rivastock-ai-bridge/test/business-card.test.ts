import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessCardContext } from '../src/workspace.ts';

test('business card summarizes actual fields and stays under the chat prompt limit', () => {
  const card = buildBusinessCardContext({
    business_name: 'Almacén QA',
    owner_display_name: 'María',
    plan: 'RivaStock IA',
    modules: ['stock', 'sales', 'ai'],
    counts: { products: 24, products_without_photo: 3, pending_orders: 2 },
    catalog: { public_url: 'https://rivastock.vercel.app/p/almacen-qa', has_reseller_mode: true },
    currency_symbol: '$',
    timezone: 'America/Argentina/Buenos_Aires',
    now_local: '2026-11-11T15:30:00',
  });
  assert.match(card, /Negocio: Almacén QA/);
  assert.match(card, /Titular: María/);
  assert.match(card, /Módulos activos: stock, sales, ai/);
  assert.match(card, /productos sin foto: 3/);
  assert.match(card, /pedidos pendientes: 2/);
  assert.match(card, /11\/11\/2026/);
  assert.ok(card.length <= 1_500);
});

test('business card omits missing optional values instead of inventing them', () => {
  assert.equal(buildBusinessCardContext({}), '');
});
