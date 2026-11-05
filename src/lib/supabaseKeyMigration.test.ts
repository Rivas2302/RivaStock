import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { headersWithoutOpaqueApiKeyBearer, resolveSupabasePublicKey } from './supabasePublicConfig';
import { createSupabaseApiKeyFetch, parseSecretKeys, resolveSupabaseAdminKey, withSupabaseAdminKeyMode } from '../../supabase/functions/_shared/supabaseAdminKey';
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

describe('Supabase key migration', () => {
  it('selects the named default secret key before any legacy fallback', () => {
    expect(resolveSupabaseAdminKey(
      JSON.stringify({ other: 'secret-other', default: 'secret-default' }),
      'legacy-service-role',
    )).toEqual({ key: 'secret-default', mode: 'secret' });
  });

  it('uses the first configured secret when the default name is absent', () => {
    expect(resolveSupabaseAdminKey(
      JSON.stringify({ first: 'secret-first', empty: '' }),
      'legacy-service-role',
    )).toEqual({ key: 'secret-first', mode: 'secret' });
  });

  it('uses legacy service role only when no new secret is configured', () => {
    expect(resolveSupabaseAdminKey('{"default":""}', 'legacy-service-role'))
      .toEqual({ key: 'legacy-service-role', mode: 'legacy' });
  });

  it('rejects malformed secrets JSON and missing admin credentials', () => {
    expect(parseSecretKeys('{')).toEqual({});
    expect(() => resolveSupabaseAdminKey('{', '')).toThrow('Supabase admin key is not configured.');
  });

  it('prefers publishable environment key, then bundled key, then the legacy fallback', () => {
    expect(resolveSupabasePublicKey(' sb_publishable_env ', 'sb_publishable_bundled', 'legacy-anon'))
      .toBe('sb_publishable_env');
    expect(resolveSupabasePublicKey('', 'sb_publishable_bundled', 'legacy-anon'))
      .toBe('sb_publishable_bundled');
    expect(resolveSupabasePublicKey('', '', 'legacy-anon')).toBe('legacy-anon');
  });

  it('removes only the opaque API-key bearer while preserving user JWT authorization', () => {
    const publishable = new Headers({ apikey: 'sb_publishable_test', Authorization: 'Bearer sb_publishable_test' });
    expect(headersWithoutOpaqueApiKeyBearer(publishable, 'sb_publishable_test').has('Authorization')).toBe(false);
    expect(headersWithoutOpaqueApiKeyBearer(new Headers({ Authorization: 'Bearer user-jwt' }), 'sb_publishable_test').get('Authorization'))
      .toBe('Bearer user-jwt');
    expect(headersWithoutOpaqueApiKeyBearer(new Headers({ Authorization: 'Bearer legacy-anon-jwt' }), 'ey.anon').get('Authorization'))
      .toBe('Bearer legacy-anon-jwt');
  });

  it('keeps new secret keys on apikey only without dropping another authorization token', async () => {
    const seen: RequestInit[] = [];
    const fetcher = createSupabaseApiKeyFetch('sb_secret_test', async (_input, init) => {
      seen.push(init ?? {});
      return new Response(null, { status: 204 });
    });
    await fetcher('https://test.supabase.co/rest/v1/', {
      headers: { apikey: 'sb_secret_test', Authorization: 'Bearer sb_secret_test' },
    });
    await fetcher('https://test.supabase.co/rest/v1/', {
      headers: { apikey: 'sb_secret_test', Authorization: 'Bearer user-jwt' },
    });
    expect(new Headers(seen[0].headers).has('Authorization')).toBe(false);
    expect(new Headers(seen[1].headers).get('Authorization')).toBe('Bearer user-jwt');
  });

  it('uses the legacy JWT only for same-project Storage requests while retaining the secret API key', async () => {
    const seen: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = createSupabaseApiKeyFetch('sb_secret_test', async (input, init) => {
      seen.push({ input, init });
      return new Response(null, { status: 200 });
    }, { supabaseUrl: 'https://test.supabase.co', legacyServiceRoleJwt: 'legacy-service-role-jwt' });

    await fetcher('https://test.supabase.co/storage/v1/object/sign/private/file', {
      headers: { apikey: 'sb_secret_test', Authorization: 'Bearer sb_secret_test' },
    });
    await fetcher('https://test.supabase.co/rest/v1/products', {
      headers: { apikey: 'sb_secret_test', Authorization: 'Bearer sb_secret_test' },
    });
    await fetcher('https://other.supabase.co/storage/v1/bucket', {
      headers: { apikey: 'sb_secret_test', Authorization: 'Bearer sb_secret_test' },
    });

    const storageHeaders = new Headers(seen[0].init?.headers);
    expect(storageHeaders.get('apikey')).toBe('sb_secret_test');
    expect(storageHeaders.get('Authorization')).toBe('Bearer legacy-service-role-jwt');
    expect(new Headers(seen[1].init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(seen[2].init?.headers).has('Authorization')).toBe(false);
  });

  it.each(['ai-bridge', 'automation', 'knowledge', 'invite-collaborator', 'delete-collaborator', 'platform-admin', 'account-purge'])(
    '%s uses the shared secret selector and exposes key_mode without logging it',
    (functionName) => {
      const source = readFileSync(resolve(process.cwd(), `supabase/functions/${functionName}/index.ts`), 'utf8');
      expect(source).toContain("Deno.env.get('SUPABASE_SECRET_KEYS')");
      expect(source).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
      expect(source).toContain('withSupabaseAdminKeyMode(');
      expect(source).not.toContain('logSupabaseAdminKeyMode');
      expect(source).not.toMatch(/createClient\(SUPABASE_URL,\s*SUPABASE_SERVICE_ROLE_KEY/);
    },
  );
  it('exposes the selected key mode as a response header without emitting a log', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const handler = withSupabaseAdminKeyMode(() => new Response('ok', {
      headers: { 'Access-Control-Expose-Headers': 'x-request-id' },
    }), 'secret');

    try {
      const response = await handler(new Request('https://example.test'));
      expect(response.headers.get('x-rivastock-key-mode')).toBe('secret');
      expect(response.headers.get('Access-Control-Expose-Headers')).toBe('x-request-id, x-rivastock-key-mode');
      expect(await response.text()).toBe('ok');
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });

  it('preserves the Realtime WebSocket upgrade response', async () => {
    const upgradeResponse = new Response(null);
    Object.defineProperty(upgradeResponse, 'status', { value: 101 });
    const handler = withSupabaseAdminKeyMode(() => upgradeResponse, 'secret');

    expect(await handler(new Request('https://example.test'))).toBe(upgradeResponse);
  });
  it('keeps routine Edge Function and worker polling logs out of production', () => {
    const directories = [
      resolve(process.cwd(), 'supabase/functions'),
      resolve(process.cwd(), 'tools/rivastock-ai-bridge/src'),
    ];
    const routineLogCalls = directories.flatMap(sourceFiles).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /console\.(?:log|info|debug)\s*\(/.test(source);
    });

    expect(routineLogCalls).toEqual([]);
  });
});
