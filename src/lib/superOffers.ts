import { roundPrice } from './utils';

export type SuperOfferShippingMode = 'fixed' | 'percent';
export type SuperOfferNoticeColor = 'red' | 'orange' | 'violet' | 'blue';

export interface SuperOfferPricePreview {
  resellerPrice: number;
  offerPrice: number;
  strikePrice: number | null;
  discountPercent: number;
  ownerGain: number;
  customerSavings: number;
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function estimateHabitualMarkup(catalogPrices: number[], resellerPrices: number[]): number {
  const ratios = catalogPrices.flatMap((catalogPrice, index) => {
    const resellerPrice = resellerPrices[index];
    if (!Number.isFinite(catalogPrice) || !Number.isFinite(resellerPrice) || catalogPrice <= 0 || resellerPrice <= 0) return [];
    return [catalogPrice / resellerPrice - 1];
  });
  return Math.max(0, median(ratios) ?? 1);
}

export function suggestedSuperOfferPercent(habitualMarkup: number): number {
  const percentage = Math.max(0, Number.isFinite(habitualMarkup) ? habitualMarkup * 100 : 100);
  return Math.max(10, Math.round((percentage / 5) / 5) * 5);
}

export function calculateSuperOfferPrice(input: {
  resellerPrice: number;
  extraPercent: number;
  catalogSalePrice?: number | null;
  habitualMarkup: number;
}): SuperOfferPricePreview {
  const resellerPrice = Math.max(0, roundPrice(input.resellerPrice));
  const offerPrice = roundPrice(resellerPrice * (1 + Math.max(0, input.extraPercent) / 100));
  const inferredCatalogPrice = roundPrice(resellerPrice * (1 + Math.max(0, input.habitualMarkup)));
  const candidateStrike = input.catalogSalePrice != null && input.catalogSalePrice > 0
    ? input.catalogSalePrice
    : inferredCatalogPrice;
  const customerSavings = Math.max(0, roundPrice(candidateStrike - offerPrice));
  const discountRatio = candidateStrike > 0 ? customerSavings / candidateStrike : 0;
  const discountPercent = discountRatio >= 0.05 ? Math.round(discountRatio * 100) : 0;
  const strikePrice = discountPercent >= 5 ? roundPrice(candidateStrike) : null;

  return {
    resellerPrice,
    offerPrice,
    strikePrice,
    discountPercent,
    ownerGain: roundPrice(offerPrice - resellerPrice),
    customerSavings: strikePrice === null ? 0 : roundPrice(strikePrice - offerPrice),
  };
}

export function calculateSuperOfferShipping(
  subtotal: number,
  mode: SuperOfferShippingMode,
  value: number,
): number {
  const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
  return roundPrice(mode === 'fixed' ? safeValue : Math.max(0, subtotal) * safeValue / 100);
}

export function getSuperOfferCountdown(endsAt: string | number, now = Date.now()): {
  days: number;
  hours: number;
  minutes: number;
  expired: boolean;
} {
  const remainingMinutes = Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 60_000));
  const days = Math.floor(remainingMinutes / (24 * 60));
  const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
  const minutes = remainingMinutes % 60;
  return { days, hours, minutes, expired: remainingMinutes <= 0 };
}
