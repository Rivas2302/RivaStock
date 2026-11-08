export function calculateTotalWithShipping(baseTotal: number, enabled: boolean, amount: number): number {
  const shipping = enabled && Number.isFinite(amount) ? Math.max(0, amount) : 0;
  return Math.round((Math.max(0, baseTotal) + shipping) * 100) / 100;
}
