import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InventoryHolding, InventoryOwner, Product } from '../types';
import { getStockValuation, selectStockValuationOwner } from './stockValuation';

const owner = (id: string, isPrimary = false): InventoryOwner => ({
  id, name: id, isPrimary, ownerUid: 'account', sortOrder: 0, createdAt: '', updatedAt: '',
});

describe('dashboard valuation wiring', () => {
  const dashboard = readFileSync(resolve(process.cwd(), 'src/pages/Dashboard.tsx'), 'utf8');

  it('loads owner attribution and holdings before showing stock KPIs', () => {
    expect(dashboard).toContain('min_stock,inventory_owner_id');
    expect(dashboard).toContain('holdingsEnabled ? getInventoryHoldings(user.uid)');
    expect(dashboard).toContain("db.list<InventoryOwner>('inventory_owners', user.uid)");
    expect(dashboard).toContain('filterInventoryOwnersByMembership(owners, allowedInventoryOwnerIds)');
    expect(dashboard).toContain('if (!user || inventoryAccessError)');
  });

  it('keeps the selector, financial stock KPIs, category chart and PDF on the same scope', () => {
    expect(dashboard).toContain('selectStockValuationOwner(visibleOwners, selectedOwnerId, defaultInventoryOwnerId)');
    expect(dashboard).toContain('onChange={event => setSelectedOwnerId(event.target.value)}');
    for (const metric of ['stockValue', 'totalInvested', 'potentialProfit']) {
      expect(dashboard).toContain(`value: valuation.${metric}`);
    }
    expect(dashboard).toContain('valuation.stockByCategory');
    expect(dashboard).toContain('k.scope ? `${k.title} — ${k.scope}` : k.title');
  });
});
const owners = [owner('primary', true), owner('other')];
const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'shared', ownerUid: 'account', name: 'Shared product', category: 'Bazar',
  categoryId: 'bazar', salePrice: 100.5, purchasePrice: 999, stock: 100,
  minStock: 0, showInCatalog: true, createdAt: '', updatedAt: '', ...overrides,
});
const holding = (overrides: Partial<InventoryHolding> = {}): InventoryHolding => ({
  id: 'holding', ownerUid: 'account', productId: 'shared', inventoryOwnerId: 'primary',
  stock: 2, purchaseCost: 20, minStock: 0, active: true, createdAt: '', updatedAt: '', ...overrides,
});

describe('stock valuation owner selection', () => {
  it('defaults to the actor default and permits switching to another authorized owner', () => {
    expect(selectStockValuationOwner(owners, null, 'other')?.id).toBe('other');
    expect(selectStockValuationOwner(owners, 'primary', 'other')?.id).toBe('primary');
  });

  it('falls back to the primary or available owner without retaining revoked access', () => {
    expect(selectStockValuationOwner(owners, 'revoked', null)?.id).toBe('primary');
    expect(selectStockValuationOwner([owners[1]], 'primary', 'primary')?.id).toBe('other');
    expect(selectStockValuationOwner([], 'primary', 'primary')).toBeNull();
  });
});

describe('owner-specific stock valuation', () => {
  it('uses each holding quantity and cost, not aggregate product stock or legacy cost', () => {
    const holdings = [holding(), holding({ inventoryOwnerId: 'other', stock: 3, purchaseCost: 40 })];
    expect(getStockValuation([product()], holdings, owners, 'primary', true)).toEqual({
      stockValue: 202, totalInvested: 40, potentialProfit: 162,
      stockByCategory: [{ name: 'Bazar', value: 202 }],
    });
    expect(getStockValuation([product()], holdings, owners, 'other', true)).toEqual({
      stockValue: 303, totalInvested: 120, potentialProfit: 183,
      stockByCategory: [{ name: 'Bazar', value: 303 }],
    });
  });

  it('ignores inactive and unavailable products and never falls back to combined stock', () => {
    const holdings = [holding({ active: false }), holding({ productId: 'missing' })];
    expect(getStockValuation([product()], holdings, owners, 'primary', true).stockValue).toBe(0);
    expect(getStockValuation([product()], [], owners, 'primary', true).totalInvested).toBe(0);
  });

  it('assigns unassigned legacy products only to the actual primary owner', () => {
    const products = [product({ stock: 2, purchasePrice: 20 }), product({
      id: 'other-product', inventoryOwnerId: 'other', stock: 3, purchasePrice: 40,
    })];
    expect(getStockValuation(products, [], owners, 'primary', false).stockValue).toBe(202);
    const other = getStockValuation(products, [], [owners[1]], 'other', false);
    expect(other.stockValue).toBe(303);
    expect(other.totalInvested).toBe(120);
  });

  it('fails closed for owners outside visible memberships', () => {
    for (const enabled of [true, false]) {
      expect(getStockValuation([product()], [holding()], [owners[1]], 'primary', enabled)).toEqual({
        stockValue: 0, totalInvested: 0, potentialProfit: 0, stockByCategory: [],
      });
    }
  });

  it('sums categories consistently and includes zero-cost holdings', () => {
    const result = getStockValuation(
      [product(), product({ id: 'second', salePrice: 50, category: 'Other' })],
      [holding(), holding({ productId: 'second', stock: 3, purchaseCost: 0 })],
      owners, 'primary', true,
    );
    expect(result.stockValue).toBe(352);
    expect(result.totalInvested).toBe(40);
    expect(result.stockByCategory.reduce((sum, category) => sum + category.value, 0)).toBe(result.stockValue);
  });
});
