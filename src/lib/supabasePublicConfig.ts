import { headersWithoutOpaqueApiKeyBearer, SUPABASE_PUBLISHABLE_KEY } from '../../supabase/functions/_shared/supabasePublicConfig.ts';

export { headersWithoutOpaqueApiKeyBearer, SUPABASE_PUBLISHABLE_KEY };

export function resolveSupabasePublicKey(
  publishableEnv: string | undefined,
  bundledKey: string,
  legacyAnonEnv: string | undefined,
): string {
  return publishableEnv?.trim() || bundledKey.trim() || legacyAnonEnv?.trim() || '';
}
