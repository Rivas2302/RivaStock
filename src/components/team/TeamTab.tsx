import { useState } from 'react';
import { useTeam } from '../../hooks/useTeam';
import { showToast } from '../../lib/toast';
import { inviteCollaborator } from '../../lib/inviteCollaborator';
import { supabase } from '../../lib/supabase';
import CollaboratorRow from './CollaboratorRow';
import InviteForm from './InviteForm';
import type { Collaborator, Invitation } from '../../types';
import { UserCheck, Users } from 'lucide-react';

export default function TeamTab() {
  const { collaborators, invitations, loading, refetch } = useTeam();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Collaborator | Invitation | null>(null);

  const handleEdit = (c: Collaborator | Invitation) => {
    setEditTarget(c);
    setIsInviteOpen(true);
  };

  const handleRevoke = async (c: Collaborator | Invitation) => {
    if (!confirm('¿Revocar este acceso?')) return;
    try {
      if ('invitedAt' in c) {
        await supabase.rpc('revoke_invitation', { p_invitation_id: c.id });
      } else {
        await supabase.rpc('revoke_collaborator', { p_collab_id: c.id });
      }
      showToast('Acceso revocado', 'success');
      refetch();
    } catch {
      showToast('Error al revocar', 'error');
    }
  };

  const handleResend = async (inv: Invitation) => {
    try {
      const result = await inviteCollaborator({
        email:        inv.email,
        permissions:  inv.permissions,
        role_preset:  inv.rolePreset ?? 'custom',
      });
      showToast(
        result.status === 'sent'
          ? `Invitación reenviada a ${inv.email}`
          : result.status === 'reactivated'
            ? `Colaborador reactivado: ${inv.email}`
            : result.status === 'already_active'
              ? `El colaborador ya está activo: ${inv.email}`
              : `El usuario ya existe. Pedile que use recuperar contraseña: ${inv.email}`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al reenviar', 'error');
    }
  };

  const handleInviteSuccess = () => {
    refetch();
    setIsInviteOpen(false);
    setEditTarget(null);
    showToast('Invitación enviada', 'success');
  };

  const handleModalClose = () => {
    setIsInviteOpen(false);
    setEditTarget(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-slate-500 dark:text-slate-400">Cargando equipo...</span>
      </div>
    );
  }

  const activeCollaborators = collaborators.filter(c => !c.revokedAt);
  const revokedCollaborators = collaborators.filter(c => c.revokedAt);
  const pendingInvitations = invitations.filter(i => !i.acceptedAt && !i.revokedAt);
  const pastInvitations = invitations.filter(i => i.acceptedAt || i.revokedAt);

  const totalCount = activeCollaborators.length + pendingInvitations.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Equipo</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {totalCount === 0 ? 'Sin colaboradores aún' : `${totalCount} miembro${totalCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setIsInviteOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/20"
        >
          <UserCheck size={18} />
          Invitar colaborador
        </button>
      </div>

      {totalCount === 0 ? (
        <div className="text-center py-12 px-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700">
          <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center mx-auto mb-3">
            <Users size={24} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <p className="font-bold text-slate-700 dark:text-slate-300">Sin colaboradores todavía</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Invita a alguien para colaborar en tu negocio</p>
        </div>
      ) : (
        <div className="space-y-8">
          {pendingInvitations.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Invitaciones pendientes</h4>
              {pendingInvitations.map(inv => (
                <CollaboratorRow
                  key={inv.id}
                  collaborator={inv}
                  onEdit={handleEdit}
                  onRevoke={handleRevoke}
                  onResend={handleResend}
                  refetch={refetch}
                />
              ))}
            </div>
          )}

          {activeCollaborators.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Miembros activos</h4>
              {activeCollaborators.map(collab => (
                <CollaboratorRow
                  key={collab.id}
                  collaborator={collab}
                  onEdit={handleEdit}
                  onRevoke={handleRevoke}
                  refetch={refetch}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <InviteForm
        isOpen={isInviteOpen}
        onClose={handleModalClose}
        onSuccess={handleInviteSuccess}
        editTarget={editTarget}
      />
    </div>
  );
}
