const LAST_SHIPPING_AMOUNT_PREFIX = 'rivastock:last-shipping-amount:';

export function readLastShippingAmount(ownerUid: string | null | undefined): number {
  if (!ownerUid || typeof window === 'undefined') return 0;
  try {
    const amount = Number(window.localStorage.getItem(`${LAST_SHIPPING_AMOUNT_PREFIX}${ownerUid}`));
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

export function rememberLastShippingAmount(ownerUid: string | null | undefined, amount: number): void {
  if (!ownerUid || typeof window === 'undefined' || !Number.isFinite(amount) || amount <= 0) return;
  try {
    window.localStorage.setItem(`${LAST_SHIPPING_AMOUNT_PREFIX}${ownerUid}`, String(Math.round(amount * 100) / 100));
  } catch {
    // A blocked browser storage must not prevent a sale from being recorded.
  }
}
