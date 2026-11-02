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

export function logSupabaseAdminKeyMode(functionName: string, keyMode: SupabaseAdminKeyMode): void {
  console.info(JSON.stringify({ event: 'supabase_admin_key_mode', function: functionName, key_mode: keyMode }));
}

export function createSupabaseApiKeyFetch(apiKey: string, fetcher: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    return fetcher(input, {
      ...init,
      headers: headersWithoutOpaqueApiKeyBearer(headers, apiKey),
    });
  };
}

export { SUPABASE_PUBLISHABLE_KEY };
