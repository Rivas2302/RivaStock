import { describe, expect, it } from 'vitest';
import {
  calculateSuperOfferPrice,
  calculateSuperOfferShipping,
  estimateHabitualMarkup,
  getSuperOfferCountdown,
  suggestedSuperOfferPercent,
} from './superOffers';

describe('super offer pricing', () => {
  it('uses rounded median markup and falls back to a 100 percent markup', () => {
    expect(estimateHabitualMarkup([300, 400, 100], [100, 100, 100])).toBe(2);
    expect(estimateHabitualMarkup([], [])).toBe(1);
    expect(suggestedSuperOfferPercent(1)).toBe(20);
    expect(suggestedSuperOfferPercent(0.23)).toBe(10);
  });

  it('calculates offer, client savings, and owner gain with catalog-price strike-through', () => {
    expect(calculateSuperOfferPrice({ resellerPrice: 1000, extraPercent: 20, catalogSalePrice: 1800, habitualMarkup: 1 }))
      .toEqual({ resellerPrice: 1000, offerPrice: 1200, strikePrice: 1800, discountPercent: 33, ownerGain: 200, customerSavings: 600 });
  });

  it('uses habitual markup when the product is not in the owner catalog and hides discounts under five percent', () => {
    expect(calculateSuperOfferPrice({ resellerPrice: 1000, extraPercent: 20, habitualMarkup: 1 }).strikePrice).toBe(2000);
    expect(calculateSuperOfferPrice({ resellerPrice: 1000, extraPercent: 98, catalogSalePrice: 2000, habitualMarkup: 1 }))
      .toMatchObject({ strikePrice: null, discountPercent: 0, customerSavings: 0 });
  });

  it('calculates fixed shipping once per order or percent of subtotal', () => {
    expect(calculateSuperOfferShipping(8000, 'fixed', 5000)).toBe(5000);
    expect(calculateSuperOfferShipping(8000, 'percent', 10)).toBe(800);
  });

  it('counts down and marks expiry', () => {
    expect(getSuperOfferCountdown('2026-11-11T03:05:00Z', Date.parse('2026-11-10T00:00:00Z')))
      .toMatchObject({ days: 1, hours: 3, minutes: 5, expired: false });
    expect(getSuperOfferCountdown('2026-11-10T00:00:00Z', Date.parse('2026-11-10T00:00:00Z')).expired).toBe(true);
  });
});
