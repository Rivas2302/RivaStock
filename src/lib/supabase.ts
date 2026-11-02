/// <reference types="vite/client" />
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { fetchWithDeadline } from './readRecovery';
import { headersWithoutOpaqueApiKeyBearer, resolveSupabasePublicKey, SUPABASE_PUBLISHABLE_KEY } from './supabasePublicConfig';

function normalizeSupabaseUrl(value: string | undefined): string {
  const trimmedValue = value?.trim() ?? '';
  if (!trimmedValue) return '';
  if (/^https?:\/\//i.test(trimmedValue)) return trimmedValue;
  return `https://${trimmedValue}`;
}

export const supabaseProjectUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
export const supabasePublicApiKey = resolveSupabasePublicKey(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
  SUPABASE_PUBLISHABLE_KEY,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
);

if (!supabaseProjectUrl || !supabasePublicApiKey) {
  console.warn('[Supabase] Credentials missing or invalid; set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local');
}

// Module-level singleton — guard against accidental re-instantiation (HMR, tests).
declare global {
  // eslint-disable-next-line no-var
  var __rivastock_supabase__: SupabaseClient | undefined;
}

export const supabase: SupabaseClient =
  globalThis.__rivastock_supabase__ ??
  createClient(supabaseProjectUrl, supabasePublicApiKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      storageKey: 'rivastock-auth',
      // implicit flow: email links (invite/recovery) work without a client-side
      // code_verifier. PKCE breaks invitations (server-initiated) and breaks
      // password reset across devices.
      flowType: 'implicit',
    },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        return fetchWithDeadline(input, {
          ...init,
          headers: headersWithoutOpaqueApiKeyBearer(headers, supabasePublicApiKey),
        });
      },
    },
  });

if (typeof window !== 'undefined') {
  globalThis.__rivastock_supabase__ = supabase;
}
