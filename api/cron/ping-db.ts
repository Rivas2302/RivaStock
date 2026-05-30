// api/cron/ping-db.ts
// Vercel Cron endpoint. Runs once per day to keep the Supabase Free-tier
// project from pausing after 7 days of inactivity.
//
// Configure schedule in vercel.json -> "crons".
// Auth: Vercel adds an Authorization: Bearer <CRON_SECRET> header to scheduled
// invocations when CRON_SECRET is set in the project env.

import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

export default async function handler(
  req: { method?: string; headers: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void; end: () => void };
    setHeader: (k: string, v: string) => void;
  },
) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const expected = process.env.CRON_SECRET;
  if (expected) {
    const header = req.headers['authorization'];
    const auth = Array.isArray(header) ? header[0] : header;
    if (auth !== `Bearer ${expected}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    res.status(500).json({ error: 'missing_supabase_env' });
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const startedAt = Date.now();
  // `count: 'exact', head: true` issues a HEAD request — no rows transferred,
  // just enough activity to mark the project as in use. The profiles table
  // exists in every Supabase project from migration 0001.
  const { error, count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true });

  const tookMs = Date.now() - startedAt;

  if (error) {
    res.status(500).json({ ok: false, error: error.message, tookMs });
    return;
  }
  res.status(200).json({ ok: true, count: count ?? 0, tookMs });
}
