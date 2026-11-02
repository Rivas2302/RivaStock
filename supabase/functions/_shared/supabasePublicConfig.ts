export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rLNMPLLmbrjyFcmyiF3ikw_opZf3oeI';

export function headersWithoutOpaqueApiKeyBearer(headers: HeadersInit | undefined, apiKey: string): Headers {
  const result = new Headers(headers);
  if ((apiKey.startsWith('sb_publishable_') || apiKey.startsWith('sb_secret_'))
    && result.get('Authorization') === `Bearer ${apiKey}`) {
    result.delete('Authorization');
  }
  return result;
}
