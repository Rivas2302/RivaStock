import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createSupabaseApiKeyFetch, resolveSupabaseAdminKey, withSupabaseAdminKeyMode } from '../_shared/supabaseAdminKey.ts';
import { createAccountPurgeHandler } from '../_shared/accountPurgeHandler.ts';
import { createProductionSupabaseS3Storage } from '../_shared/supabaseS3Storage.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const storageAdmin = createProductionSupabaseS3Storage(SUPABASE_URL);
const STORAGE_PAGE_SIZE = 500;
const { key: SUPABASE_ADMIN_KEY, mode: SUPABASE_ADMIN_KEY_MODE } = resolveSupabaseAdminKey(
  Deno.env.get('SUPABASE_SECRET_KEYS'),
);
const admin = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: createSupabaseApiKeyFetch(SUPABASE_ADMIN_KEY) },
});

serve(withSupabaseAdminKeyMode(createAccountPurgeHandler({
  async authorize(token) {
    const { data, error } = await admin.rpc('platform_validate_business_purge_token', { p_token: token });
    return !error && data === true;
  },
  async claimDue() {
    const { data, error } = await admin.rpc('platform_claim_due_business_deletions', { p_limit: 5 });
    if (error) throw error;
    return Array.isArray(data)
      ? data.map((row: { owner_uid?: unknown }) => typeof row.owner_uid === 'string' ? row.owner_uid : '').filter(Boolean)
      : [];
  },
  async listStorage(ownerUid) {
    const { data, error } = await admin.rpc('platform_business_storage_inventory', {
      p_owner_uid: ownerUid,
      p_offset: 0,
      p_limit: STORAGE_PAGE_SIZE,
    });
    if (error) throw error;
    return Array.isArray(data) ? data as Array<{ bucket_id: string; object_name: string }> : [];
  },
  async removeStorage(bucketId, paths) {
    const { error } = await storageAdmin.from(bucketId).remove(paths);
    if (error) throw error;
  },
  async purgeDatabase(ownerUid) {
    const { error } = await admin.rpc('platform_purge_business_rows', { p_owner_uid: ownerUid });
    if (error) throw error;
  },
  async deleteAuthUser(ownerUid) {
    const { error } = await admin.auth.admin.deleteUser(ownerUid);
    if (error) throw error;
  },
  async recordFailure(ownerUid, failureCode) {
    await admin.rpc('platform_record_business_purge_failure', { p_owner_uid: ownerUid, p_failure_code: failureCode });
  },
}), SUPABASE_ADMIN_KEY_MODE));
