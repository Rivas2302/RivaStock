import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createSupabaseApiKeyFetch, logSupabaseAdminKeyMode, resolveSupabaseAdminKey, SUPABASE_PUBLISHABLE_KEY } from '../_shared/supabaseAdminKey.ts';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const { key: SUPABASE_ADMIN_KEY, mode: SUPABASE_ADMIN_KEY_MODE } = resolveSupabaseAdminKey(
  Deno.env.get('SUPABASE_SECRET_KEYS'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
);
logSupabaseAdminKeyMode('delete-collaborator', SUPABASE_ADMIN_KEY_MODE);

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'No autenticado' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: 'Sesión inválida' }, 401);

  let body: { collaborator_id: string };
  try { body = await req.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }

  if (!body.collaborator_id) return json({ error: 'collaborator_id requerido' }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, {
    global: { fetch: createSupabaseApiKeyFetch(SUPABASE_ADMIN_KEY) },
  });

  const { data: collab, error: collabErr } = await admin
    .from('collaborators')
    .select('user_uid')
    .eq('id', body.collaborator_id)
    .eq('owner_uid', user.id)
    .is('revoked_at', null)
    .maybeSingle();

  if (collabErr) return json({ error: `Error al buscar colaborador: ${collabErr.message}` }, 500);
  if (!collab)   return json({ error: 'Colaborador no encontrado o sin permisos' }, 404);

  const { error: deleteErr } = await admin.auth.admin.deleteUser(collab.user_uid);
  if (deleteErr) return json({ error: `Error al eliminar usuario: ${deleteErr.message}` }, 500);

  return json({ success: true });
});
