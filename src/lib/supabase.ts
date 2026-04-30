/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
