import { describe, expect, it } from 'vitest';
import { buildAuthConfirmationUrl, type HookPayload } from './handler';

function payload(type: 'invite' | 'recovery'): Pick<HookPayload, 'email_data'> {
  return {
    email_data: {
      token: 'opaque-token',
      token_hash: 'opaque-token-hash',
      redirect_to: 'https://rivastock.example/auth/confirm?type=' + type,
      email_action_type: type,
      site_url: 'https://rivastock.example',
    },
  };
}

describe('email auth links', () => {
  it.each(['invite', 'recovery'] as const)('sends %s links to the app confirmation flow', (type) => {
    const url = new URL(buildAuthConfirmationUrl(payload(type)));
    expect(url.origin).toBe('https://rivastock.example');
    expect(url.pathname).toBe('/auth/confirm');
    expect(url.searchParams.get('token_hash')).toBe('opaque-token-hash');
    expect(url.searchParams.get('type')).toBe(type);
  });
});
