import { db } from './db';
import { todayString } from './utils';
import type { Sale } from '../types';

export function getRecentRestockSales(ownerUid: string, now = new Date()): Promise<Sale[]> {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 30);
  return db.recentPaidSales<Sale>(ownerUid, todayString(cutoff), todayString(now));
}
