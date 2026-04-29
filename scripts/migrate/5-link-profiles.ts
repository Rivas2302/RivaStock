/**
 * Step 5 — Link profiles.id → auth.users.id
 *
 * After running steps 1-3, profile rows in `profiles` have the Firestore UID as their `id`.
 * Supabase auth users (created by the human via Supabase Dashboard → Auth → Users)
 * have a different UUID assigned by Supabase.
 *
 * This script:
 *   1. Reads auth.users (via service role) to get email → auth_uid mapping
 *   2. For each profile, finds the matching auth user by email
 *   3. Updates profiles.id to the auth_uid AND updates all FK references
 *      (sales.user_id, products.user_id, etc.)
 *
 * Run AFTER all auth users have been created in Supabase Dashboard.
 *
 * NOTE: This is a destructive rewrite of the `id` column on profiles.
 * Run only once, after step 3 and before going live.
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Tables that have user_id referencing profiles.id
const USER_ID_TABLES = [
  'categories',
  'price_ranges',
  'products',
  'sales',
  'cash_flow',
  'stock_intakes',
  'customers',
  'customer_transactions',
  'orders',
  'quotes',
  'catalog_config',
];

async function getAuthUsers(): Promise<{ id: string; email: string }[]> {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  return (data?.users ?? []).map(u => ({ id: u.id, email: u.email ?? '' }));
}

async function getProfiles(): Promise<{ id: string; email: string }[]> {
  // profiles.email comes from the Firestore `email` field (login email)
  const { data, error } = await supabase.from('profiles').select('id, email');
  if (error) throw new Error(`profiles select: ${error.message}`);
  return data ?? [];
}

(async () => {
  console.log('=== RivaStock: Link Profiles to Auth ===\n');

  const authUsers = await getAuthUsers();
  const profiles  = await getProfiles();

  console.log(`Auth users: ${authUsers.length}, Profiles: ${profiles.length}\n`);

  const emailToAuth = new Map(authUsers.map(u => [u.email.toLowerCase(), u.id]));

  let linked = 0;
  let skipped = 0;

  for (const profile of profiles) {
    const authUid = emailToAuth.get(profile.email?.toLowerCase() ?? '');
    if (!authUid) {
      console.warn(`  SKIP profile ${profile.id}: no auth user for email "${profile.email}"`);
      skipped++;
      continue;
    }

    if (authUid === profile.id) {
      // Already linked (e.g. handle_new_user trigger ran)
      linked++;
      continue;
    }

    console.log(`  Linking ${profile.email}: ${profile.id} → ${authUid}`);

    // Update FK references first (to avoid FK violations)
    for (const table of USER_ID_TABLES) {
      const { error } = await supabase
        .from(table)
        .update({ user_id: authUid })
        .eq('user_id', profile.id);
      if (error) console.warn(`    ${table}: ${error.message}`);
    }

    // Then update the profile id itself
    const { error } = await supabase
      .from('profiles')
      .update({ id: authUid })
      .eq('id', profile.id);
    if (error) {
      console.error(`  ERROR updating profile id: ${error.message}`);
    } else {
      linked++;
    }
  }

  console.log(`\nLinked: ${linked}, Skipped: ${skipped}`);
  if (skipped > 0) {
    console.log('\nCreate the missing auth users in Supabase Dashboard → Auth → Users, then re-run.');
  } else {
    console.log('All profiles linked. Migration complete.');
  }
})();
