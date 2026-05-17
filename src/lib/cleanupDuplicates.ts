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
import { DUPLICATE_DETECTION_WINDOW_MS as WINDOW_MS } from './constants';

// ─── helpers ──────────────────────────────────────────────────────────────────

function saleDupeKey(s: Sale): string {
  return `${s.ownerUid}|${s.productId}|${s.quantity}|${s.total}|${s.date}`;
}

function cashFlowDupeKey(c: CashFlowEntry): string {
  return `${c.ownerUid}|${c.type}|${c.amount}|${c.description}|${c.date}`;
}

function groupByKey<T extends { id: string; createdAt?: string }>(
  items: T[],
  keyFn: (item: T) => string,
  windowMs: number,
): T[][] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  const groups: T[][] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort(
      (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
    );
    let current: T[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const lastTime = new Date(current[current.length - 1].createdAt || 0).getTime();
      const thisTime = new Date(sorted[i].createdAt || 0).getTime();
      if (Math.abs(thisTime - lastTime) <= windowMs) {
        current.push(sorted[i]);
      } else {
        if (current.length > 1) groups.push(current);
        current = [sorted[i]];
      }
    }
    if (current.length > 1) groups.push(current);
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
  const salesGroups: DuplicateGroup<Sale>[] = groupByKey(sales, saleDupeKey, WINDOW_MS)
    .map(group => {
      const sorted = sortOldestFirst(group);
      return { keep: sorted[0], toDelete: sorted.slice(1) };
    });

  // --- cash_flow duplicates by field match ---
  const cfFieldGroups: DuplicateGroup<CashFlowEntry>[] = groupByKey(cashFlow, cashFlowDupeKey, WINDOW_MS)
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
