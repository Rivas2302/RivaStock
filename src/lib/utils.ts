import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount).replace('ARS', '$');
}

export function roundPrice(price: number): number {
  // Integer math to avoid float precision issues (e.g. 199.999... % 100)
  const cents = Math.round(price * 100);
  const lastTwo = cents % 100;
  const rounded = lastTwo >= 50 ? cents - lastTwo + 100 : cents - lastTwo;
  return rounded / 100;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for Safari < 15.4 / older iOS
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Parses a YYYY-MM-DD string as local date to avoid UTC-3 offset shifting the day
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const formatter: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  if (dateOnlyMatch) {
    const [year, month, day] = dateStr.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return new Date(year, month - 1, day).toLocaleDateString('es-AR', formatter);
  }
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('es-AR', formatter);
}

// Returns today's date as YYYY-MM-DD in local timezone (avoids UTC offset issues)
export function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}
