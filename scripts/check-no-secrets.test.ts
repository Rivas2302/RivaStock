import { describe, expect, it } from 'vitest';
import { findSecretPatterns } from './check-no-secrets.mjs';

describe('secret pattern scanner', () => {
  it('detects secret keys, service-role JWTs, populated env values, and private keys', () => {
    const secretKey = ['sb', '_', 'secret', '_', 'x'.repeat(24)].join('');
    const envName = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
    const jwtPayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
    const privateKeyMarker = ['-----BEGIN', ' PRIVATE KEY-----'].join('');
    const findings = findSecretPatterns([
      secretKey,
      `eyJheaderpayload.${jwtPayload}.signature`,
      `${envName}=${'sensitive-value'.repeat(2)}`,
      privateKeyMarker,
    ].join('\n'));

    expect(findings).toEqual([
      'secret-api-key', 'service-role-jwt', 'service-role-env-assignment', 'private-key',
    ]);
  });

  it('allows public examples and empty assignments', () => {
    const envName = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
    expect(findSecretPatterns(`sb_publishable_public-example\n${envName}=\n`)).toEqual([]);
  });
});
