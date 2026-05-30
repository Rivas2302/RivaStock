// api/health.ts
// Public health check. Returns 200 only if the Supabase project responded in
// under 5 seconds. Suitable for uptime monitors.

import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
};

export default async function handler(
  _req: unknown,
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
) {
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    res.status(500).json({ ok: false, error: 'missing_supabase_env' });
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const { error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .abortSignal(controller.signal);
    clearTimeout(timer);

    const tookMs = Date.now() - startedAt;
    if (error) {
      res.status(503).json({ ok: false, error: error.message, tookMs });
      return;
    }
    res.status(200).json({ ok: true, tookMs });
  } catch (err) {
    const tookMs = Date.now() - startedAt;
    res.status(503).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      tookMs,
    });
  }
}
