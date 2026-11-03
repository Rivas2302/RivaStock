import { describe, expect, it } from 'vitest';
import {
  readFacebookGroupPublicationMode,
  resolveFacebookGroupPublicationMode,
  saveFacebookGroupPublicationMode,
  shouldShowFacebookGroupPublicationMode,
  type FacebookGroupPublicationMode,
} from './facebookPublicationMode';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('Facebook Marketplace group publication mode', () => {
  it('shows the selector only when the feature, Marketplace, and at least one group are selected', () => {
    expect(shouldShowFacebookGroupPublicationMode(false, true, 2)).toBe(false);
    expect(shouldShowFacebookGroupPublicationMode(true, false, 2)).toBe(false);
    expect(shouldShowFacebookGroupPublicationMode(true, true, 0)).toBe(false);
    expect(shouldShowFacebookGroupPublicationMode(true, true, 1)).toBe(true);
  });

  it('falls back to separate posts when the selector prerequisites are not met', () => {
    const requested: FacebookGroupPublicationMode = 'marketplace_groups';
    expect(resolveFacebookGroupPublicationMode(false, requested, true, 2)).toBe('separate');
    expect(resolveFacebookGroupPublicationMode(true, requested, false, 2)).toBe('separate');
    expect(resolveFacebookGroupPublicationMode(true, requested, true, 0)).toBe('separate');
    expect(resolveFacebookGroupPublicationMode(true, requested, true, 2)).toBe('marketplace_groups');
  });

  it('stores a group-mode preference separately for each business owner', () => {
    const storage = memoryStorage();
    saveFacebookGroupPublicationMode('owner-a', 'marketplace_groups', storage);

    expect(readFacebookGroupPublicationMode('owner-a', storage)).toBe('marketplace_groups');
    expect(readFacebookGroupPublicationMode('owner-b', storage)).toBe('separate');
    expect(readFacebookGroupPublicationMode(null, storage)).toBe('separate');
  });

  it('uses the safe default when browser storage is unavailable or throws', () => {
    const throwingStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };

    expect(readFacebookGroupPublicationMode('owner-a', null)).toBe('separate');
    expect(readFacebookGroupPublicationMode('owner-a', throwingStorage)).toBe('separate');
    expect(() => saveFacebookGroupPublicationMode('owner-a', 'marketplace_groups', throwingStorage)).not.toThrow();
  });
});
