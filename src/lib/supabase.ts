/// <reference types="vite/client" />
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function normalizeSupabaseUrl(value: string | undefined): string {
  const trimmedValue = value?.trim() ?? '';
  if (!trimmedValue) return '';
  if (/^https?:\/\//i.test(trimmedValue)) return trimmedValue;
  return `https://${trimmedValue}`;
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Credentials missing or invalid; set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local');
}

// Module-level singleton — guard against accidental re-instantiation (HMR, tests).
declare global {
  // eslint-disable-next-line no-var
  var __rivastock_supabase__: SupabaseClient | undefined;
}

export const supabase: SupabaseClient =
  globalThis.__rivastock_supabase__ ??
  createClient(supabaseUrl, supabaseAnonKey, {
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
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }),
    },
  });

if (typeof window !== 'undefined') {
  globalThis.__rivastock_supabase__ = supabase;
}
