import { describe, expect, it } from 'vitest';
import { BUSINESS_MODULE_KEYS } from './businessModules';
import {
  parseBusinessLimitOverrides,
  PLATFORM_BUSINESS_MODULE_KEYS,
} from '../../supabase/functions/_shared/platformAdminRules';

describe('platform business module overrides', () => {
  it('keeps every module flag, including explicit false values', () => {
    const modules = Object.fromEntries(BUSINESS_MODULE_KEYS.map(key => [key, key === 'sales' || key === 'stock']));
    const parsed = parseBusinessLimitOverrides({ modules });

    expect([...PLATFORM_BUSINESS_MODULE_KEYS].sort()).toEqual([...BUSINESS_MODULE_KEYS].sort());
    expect(parsed?.modules).toEqual(modules);
  });

  it('accepts legacy module templates but rejects unknown and non-boolean flags', () => {
    expect(parseBusinessLimitOverrides({ modules: { ai: false, knowledge: false, automation: false } })?.modules)
      .toEqual({ ai: false, knowledge: false, automation: false });
    expect(parseBusinessLimitOverrides({ modules: { ai: false, knowledge: false, automation: false, unknown: true } }))
      .toBeNull();
    expect(parseBusinessLimitOverrides({ modules: { ai: false, knowledge: false, automation: false, sales: 'false' } }))
      .toBeNull();
  });
});
