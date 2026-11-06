import { describe, expect, it } from 'vitest';
import { isAllowedAutomationOrigin } from '../../supabase/functions/automation/origin';

describe('automation function allowed origins', () => {
  it('allows requests without an Origin header and the app origin', () => {
    expect(isAllowedAutomationOrigin(null)).toBe(true);
    expect(isAllowedAutomationOrigin('https://rivastock.vercel.app')).toBe(true);
  });

  it('allows only the installed Facebook extension origin for extension trace uploads', () => {
    expect(isAllowedAutomationOrigin('chrome-extension://iplfoimfiigmoaihampblmibohekbbkj')).toBe(true);
    expect(isAllowedAutomationOrigin('chrome-extension://arbitrary-extension')).toBe(false);
  });

  it('rejects unrelated origins', () => {
    expect(isAllowedAutomationOrigin('https://untrusted.example')).toBe(false);
  });
});
