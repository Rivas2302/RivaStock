import { supabase } from './supabase';
import type { PermissionMatrix, StaffRole } from '../types';

export async function inviteCollaborator(args: {
  email: string;
  permissions: PermissionMatrix;
  role_preset: StaffRole;
}): Promise<{
  invitation_id: string;
  status: 'sent' | 'reactivated' | 'already_active' | 'already_registered';
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sesión expirada');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-collaborator`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(args),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Error al enviar invitación');
  return body;
}
