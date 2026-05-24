import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL               = Deno.env.get('APP_URL') ?? 'https://rivastock.vercel.app';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  email: string;
  permissions: Record<string, Record<string, boolean>>;
  role_preset?: 'admin' | 'employee' | 'viewer' | 'custom';
}

function isValidEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isValidPermissions(p: unknown): p is Body['permissions'] {
  if (!p || typeof p !== 'object') return false;
  for (const mod of Object.values(p as Record<string, unknown>)) {
    if (!mod || typeof mod !== 'object') return false;
    for (const v of Object.values(mod as Record<string, unknown>)) {
      if (typeof v !== 'boolean') return false;
    }
  }
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'No autenticado' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Sesión inválida' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const { data: collabRows } = await admin
    .from('collaborators')
    .select('id')
    .eq('user_uid', user.id)
    .is('revoked_at', null)
    .limit(1);
  if (collabRows && collabRows.length > 0) {
    return new Response(JSON.stringify({ error: 'Solo el propietario puede invitar' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  let body: Body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'JSON inválido' }),
    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  if (!isValidEmail(body.email)) {
    return new Response(JSON.stringify({ error: 'Email inválido' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  if (!isValidPermissions(body.permissions)) {
    return new Response(JSON.stringify({ error: 'Permisos inválidos' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const normalizedEmail = body.email.trim().toLowerCase();
  let shouldSendInvite = true;
  let status = 'sent';

  const { data: existing, error: existingErr } = await admin
    .from('invitations')
    .select('id, accepted_at, revoked_at')
    .eq('owner_uid', user.id)
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (existingErr) {
    return new Response(JSON.stringify({ error: `Error al buscar invitación: ${existingErr.message}` }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  let invitationId: string;
  if (existing) {
    if (!existing.accepted_at && !existing.revoked_at) {
      invitationId = existing.id;
      const { error: updateErr } = await admin.from('invitations').update({
        permissions: body.permissions,
        role_preset: body.role_preset ?? null,
      }).eq('id', invitationId);
      if (updateErr) {
        return new Response(JSON.stringify({ error: `Error al actualizar invitación: ${updateErr.message}` }),
          { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    } else {
      const { data: collaborator, error: collabErr } = await admin
        .from('collaborators')
        .select('id, revoked_at')
        .eq('invitation_id', existing.id)
        .maybeSingle();
      if (collabErr) {
        return new Response(JSON.stringify({ error: `Error al buscar colaborador: ${collabErr.message}` }),
          { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      invitationId = existing.id;
      if (collaborator) {
        const { error: updateCollabErr } = await admin
          .from('collaborators')
          .update({
            permissions: body.permissions,
            role_preset: body.role_preset ?? null,
            revoked_at: null,
          })
          .eq('id', collaborator.id);
        if (updateCollabErr) {
          return new Response(JSON.stringify({ error: `Error al actualizar colaborador: ${updateCollabErr.message}` }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        shouldSendInvite = false;
        status = collaborator.revoked_at ? 'reactivated' : 'already_active';
      }

      const { error: updateInviteErr } = await admin
        .from('invitations')
        .update({
          permissions: body.permissions,
          role_preset: body.role_preset ?? null,
          invited_at: new Date().toISOString(),
          accepted_at: collaborator ? new Date().toISOString() : null,
          revoked_at: null,
        })
        .eq('id', existing.id);
      if (updateInviteErr) {
        return new Response(JSON.stringify({ error: `Error al reutilizar invitación: ${updateInviteErr.message}` }),
          { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

    }
  } else {
    const { data: inserted, error: insErr } = await admin
      .from('invitations')
      .insert({
        owner_uid:   user.id,
        email:       normalizedEmail,
        permissions: body.permissions,
        role_preset: body.role_preset ?? null,
      })
      .select('id')
      .single();
    if (insErr) {
      return new Response(JSON.stringify({ error: `Error al crear invitación: ${insErr.message}` }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    invitationId = inserted.id;
  }

  if (shouldSendInvite) {
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      normalizedEmail,
      { redirectTo: `${APP_URL}/reset-password` },
    );
    if (inviteErr) {
      if (inviteErr.message.toLowerCase().includes('already been registered')) {
        // User already has a confirmed Supabase account. The handle_new_user trigger
        // won't fire for existing users, so we must create the collaborator row manually.
        const { data: existingProfile } = await admin
          .from('profiles')
          .select('id')
          .eq('email', normalizedEmail)
          .maybeSingle();

        if (existingProfile?.id) {
          await admin.from('collaborators').upsert({
            owner_uid:     user.id,
            user_uid:      existingProfile.id,
            email:         normalizedEmail,
            permissions:   body.permissions,
            role_preset:   body.role_preset ?? null,
            invitation_id: invitationId,
            revoked_at:    null,
          }, { onConflict: 'owner_uid,user_uid' });

          await admin.from('invitations').update({
            accepted_at: new Date().toISOString(),
          }).eq('id', invitationId);
        }

        return new Response(JSON.stringify({ invitation_id: invitationId, status: 'already_registered' }),
          { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        error: `Error al enviar email: ${inviteErr.message}`,
        invitation_id: invitationId,
      }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  }

  return new Response(JSON.stringify({ invitation_id: invitationId, status }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
