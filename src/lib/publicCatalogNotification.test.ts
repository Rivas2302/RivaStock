import { describe, expect, it } from 'vitest';
import { shouldNotifyPublicOrderOwner } from './publicCatalogNotification';

describe('public catalog order email notification', () => {
  it('runs only from the production catalog host', () => {
    expect(shouldNotifyPublicOrderOwner('rivastock.vercel.app')).toBe(true);
    expect(shouldNotifyPublicOrderOwner('RivaStock.Vercel.App')).toBe(true);
    expect(shouldNotifyPublicOrderOwner('preview-rivastock.vercel.app')).toBe(false);
    expect(shouldNotifyPublicOrderOwner('localhost')).toBe(false);
  });
});
