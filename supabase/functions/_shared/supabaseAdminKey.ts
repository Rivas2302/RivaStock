import { headersWithoutOpaqueApiKeyBearer, SUPABASE_PUBLISHABLE_KEY } from './supabasePublicConfig.ts';

export type SupabaseAdminKeyMode = 'secret' | 'legacy';

export interface SupabaseAdminKeySelection {
  key: string;
  mode: SupabaseAdminKeyMode;
}

export function resolveSupabaseAdminKey(
  secretKeysJson: string | null | undefined,
  legacyServiceRoleKey: string | null | undefined,
): SupabaseAdminKeySelection {
  const configuredSecrets = parseSecretKeys(secretKeysJson);
  const secretKey = configuredSecrets.default
    ?? Object.values(configuredSecrets).find((value) => typeof value === 'string' && value.trim())
    ?? '';

  if (secretKey) return { key: secretKey, mode: 'secret' };

  const legacyKey = legacyServiceRoleKey?.trim() ?? '';
  if (legacyKey) return { key: legacyKey, mode: 'legacy' };

  throw new Error('Supabase admin key is not configured.');
}

export function parseSecretKeys(value: string | null | undefined): Record<string, string> {
  if (!value?.trim()) return {};

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim())));
  } catch {
    return {};
  }
}

export function withSupabaseAdminKeyMode(
  handler: (request: Request) => Response | Promise<Response>,
  keyMode: SupabaseAdminKeyMode,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = await handler(request);
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    headers.set('x-rivastock-key-mode', keyMode);
    const exposedHeaders = new Set((headers.get('Access-Control-Expose-Headers') ?? '').split(',').map((header) => header.trim()).filter(Boolean));
    exposedHeaders.add('x-rivastock-key-mode');
    headers.set('Access-Control-Expose-Headers', [...exposedHeaders].join(', '));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

export function createSupabaseApiKeyFetch(
  apiKey: string,
  fetcher: typeof fetch = fetch,
  storageAuth?: { supabaseUrl: string; legacyServiceRoleJwt: string },
): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (storageAuth?.legacyServiceRoleJwt) {
      try {
        const requestUrl = new URL(input instanceof Request ? input.url : String(input));
        const supabaseOrigin = new URL(storageAuth.supabaseUrl).origin;
        if (requestUrl.origin === supabaseOrigin && requestUrl.pathname.startsWith('/storage/v1/')) {
          headers.set('apikey', apiKey);
          headers.set('Authorization', `Bearer ${storageAuth.legacyServiceRoleJwt}`);
          return fetcher(input, { ...init, headers });
        }
      } catch {
        // Fall through to opaque API key handling for invalid or relative URLs.
      }
    }
    return fetcher(input, {
      ...init,
      headers: headersWithoutOpaqueApiKeyBearer(headers, apiKey),
    });
  };
}

export { SUPABASE_PUBLISHABLE_KEY };
