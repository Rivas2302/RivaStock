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
  const lastTwoDigits = price % 100;
  if (lastTwoDigits >= 50) {
    return Math.ceil(price / 100) * 100;
  } else {
    return Math.floor(price / 100) * 100;
  }
}

// Parses a YYYY-MM-DD string as local date to avoid UTC-3 offset shifting the day
export function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('es-AR');
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
