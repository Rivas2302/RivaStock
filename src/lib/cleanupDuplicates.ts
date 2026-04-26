/**
 * Duplicate detection and cleanup utility for RivaStock Firestore data.
 *
 * Detection criteria:
 *   Sales:     same ownerUid + productId + quantity + total + date, createdAt within 5 s
 *   CashFlow:  same ownerUid + type + amount + description + date, createdAt within 5 s
 *              OR multiple entries sharing the same non-null saleId
 *
 * Cleanup strategy: keep the OLDEST record (smallest createdAt), delete the rest.
 *
 * Usage:
 *   const result = await diagnoseDuplicates(user.uid);
 *   console.log(result);                         // inspect counts
 *   const deleted = await cleanupDuplicates(user.uid);  // execute cleanup
 */

import { db } from './db';
import { Sale, CashFlowEntry } from '../types';

const WINDOW_MS = 5000;

// ─── helpers ──────────────────────────────────────────────────────────────────

function timeDiff(a?: string, b?: string): number {
  if (!a || !b) return Infinity;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime());
}

function areDuplicateSales(a: Sale, b: Sale): boolean {
  return (
    a.ownerUid === b.ownerUid &&
    a.productId === b.productId &&
    a.quantity === b.quantity &&
    a.total === b.total &&
    a.date === b.date &&
    timeDiff(a.createdAt, b.createdAt) <= WINDOW_MS
  );
}

function areDuplicateCashFlow(a: CashFlowEntry, b: CashFlowEntry): boolean {
  return (
    a.ownerUid === b.ownerUid &&
    a.type === b.type &&
    a.amount === b.amount &&
    a.description === b.description &&
    a.date === b.date &&
    timeDiff(a.createdAt, b.createdAt) <= WINDOW_MS
  );
}

function groupDuplicates<T extends { id: string }>(
  items: T[],
  isDuplicate: (a: T, b: T) => boolean
): T[][] {
  const groups: T[][] = [];
  const used = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    if (used.has(items[i].id)) continue;
    const group: T[] = [items[i]];
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(items[j].id)) continue;
      if (isDuplicate(items[i], items[j])) {
        group.push(items[j]);
        used.add(items[j].id);
      }
    }
    if (group.length > 1) {
      groups.push(group);
      used.add(items[i].id);
    }
  }
  return groups;
}

function sortOldestFirst<T extends { createdAt?: string }>(group: T[]): T[] {
  return [...group].sort(
    (a, b) =>
      new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime()
  );
}

// ─── public API ───────────────────────────────────────────────────────────────

export interface DuplicateGroup<T> {
  keep: T;
  toDelete: T[];
}

export interface DiagnosticReport {
  salesGroups: DuplicateGroup<Sale>[];
  cashFlowFieldGroups: DuplicateGroup<CashFlowEntry>[];
  cashFlowSaleIdGroups: DuplicateGroup<CashFlowEntry>[];
  totalSalesToDelete: number;
  totalCashFlowToDelete: number;
}

export async function diagnoseDuplicates(ownerUid: string): Promise<DiagnosticReport> {
  const [sales, cashFlow] = await Promise.all([
    db.list<Sale>('sales', ownerUid),
    db.list<CashFlowEntry>('cash_flow', ownerUid)
  ]);

  // --- sales duplicates by field match ---
  const salesGroups: DuplicateGroup<Sale>[] = groupDuplicates(sales, areDuplicateSales)
    .map(group => {
      const sorted = sortOldestFirst(group);
      return { keep: sorted[0], toDelete: sorted.slice(1) };
    });

  // --- cash_flow duplicates by field match ---
  const cfFieldGroups: DuplicateGroup<CashFlowEntry>[] = groupDuplicates(cashFlow, areDuplicateCashFlow)
    .map(group => {
      const sorted = sortOldestFirst(group);
      return { keep: sorted[0], toDelete: sorted.slice(1) };
    });

  // --- cash_flow duplicates by saleId ---
  const saleIdMap = new Map<string, CashFlowEntry[]>();
  for (const entry of cashFlow) {
    if (entry.saleId) {
      const arr = saleIdMap.get(entry.saleId) ?? [];
      arr.push(entry);
      saleIdMap.set(entry.saleId, arr);
    }
  }
  const cfSaleIdGroups: DuplicateGroup<CashFlowEntry>[] = [];
  for (const group of saleIdMap.values()) {
    if (group.length > 1) {
      const sorted = sortOldestFirst(group);
      cfSaleIdGroups.push({ keep: sorted[0], toDelete: sorted.slice(1) });
    }
  }

  // Collect unique IDs to delete to avoid double-counting overlaps
  const cfIdsToDelete = new Set<string>([
    ...cfFieldGroups.flatMap(g => g.toDelete.map(e => e.id)),
    ...cfSaleIdGroups.flatMap(g => g.toDelete.map(e => e.id))
  ]);

  return {
    salesGroups,
    cashFlowFieldGroups: cfFieldGroups,
    cashFlowSaleIdGroups: cfSaleIdGroups,
    totalSalesToDelete: salesGroups.reduce((n, g) => n + g.toDelete.length, 0),
    totalCashFlowToDelete: cfIdsToDelete.size
  };
}

export async function cleanupDuplicates(
  ownerUid: string,
  report?: DiagnosticReport
): Promise<{ salesDeleted: number; cashFlowDeleted: number }> {
  const r = report ?? await diagnoseDuplicates(ownerUid);

  let salesDeleted = 0;
  let cashFlowDeleted = 0;

  for (const group of r.salesGroups) {
    for (const sale of group.toDelete) {
      await db.delete('sales', sale.id);
      salesDeleted++;
    }
  }

  // Collect unique cash_flow IDs to avoid double-deleting
  const cfIdsToDelete = new Set<string>([
    ...r.cashFlowFieldGroups.flatMap(g => g.toDelete.map(e => e.id)),
    ...r.cashFlowSaleIdGroups.flatMap(g => g.toDelete.map(e => e.id))
  ]);

  for (const id of cfIdsToDelete) {
    try {
      await db.delete('cash_flow', id);
      cashFlowDeleted++;
    } catch {
      // Already deleted — ignore
    }
  }

  return { salesDeleted, cashFlowDeleted };
}
