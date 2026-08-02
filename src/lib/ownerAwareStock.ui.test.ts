import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stock = readFileSync(resolve(process.cwd(), 'src/pages/Stock.tsx'), 'utf8');
const intake = readFileSync(resolve(process.cwd(), 'src/pages/Intake.tsx'), 'utf8');
const auth = readFileSync(resolve(process.cwd(), 'src/AuthContext.tsx'), 'utf8');

describe('owner-aware stock UI safety contract', () => {
  it('does not expose holdings activation before sales and returns are adapted', () => {
    expect(stock).not.toContain('setInventoryHoldingsEnabled');
    expect(stock).not.toContain('Activar stock compartido');
    expect(stock).toContain('ventas y devoluciones');
  });

  it('blocks stock and intake when inventory authorization could not be verified', () => {
    expect(stock).toContain('inventoryAccessError');
    expect(intake).toContain('inventoryAccessError');
    expect(stock).toContain('role="alert"');
    expect(intake).toContain('role="alert"');
  });

  it('fails the full auth bootstrap when collaborator lookup errors', () => {
    expect(auth).toContain('collaboratorResult.error');
    expect(auth).toContain('resolveAccountActor');
  });

  it('derives recommendations and table economics from visible holdings', () => {
    expect(stock).toContain('getHoldingRestockRecommendations');
    expect(stock).toContain('getVisibleHoldingEconomics');
    expect(stock).toContain('visibleHoldings');
  });

  it('uses stable intent keys instead of regenerating keys inside RPC calls', () => {
    expect(stock).toContain('resolveIdempotencyIntent');
    expect(intake).toContain('resolveIdempotencyIntent');
    expect(stock).not.toContain('idempotencyKey: `product:${crypto.randomUUID()}`');
    expect(stock).not.toContain('idempotencyKey: `transfer:${crypto.randomUUID()}`');
    expect(intake).not.toContain('idempotencyKey: `intake:${crypto.randomUUID()}`');
  });

  it('deletes the database row before attempting image cleanup and reports failures', () => {
    const deleteHandler = stock.slice(
      stock.indexOf('const handleDelete'),
      stock.indexOf('const autoCalculatePrice'),
    );
    expect(deleteHandler.indexOf("await db.delete('products', id)")).toBeGreaterThan(-1);
    expect(deleteHandler.indexOf("await db.delete('products', id)"))
      .toBeLessThan(deleteHandler.indexOf('deleteFromStorage(url)'));
    expect(deleteHandler).toContain('No se pudo eliminar el producto');
  });

  it('keeps failed image paths in session and exposes an actionable retry', () => {
    expect(stock).toContain('failedStorageCleanupPaths');
    expect(stock).toContain('pendingImageCleanup');
    expect(stock).toContain('Reintentar limpieza');
    expect(stock).toContain('No se pudieron eliminar');
  });
});
