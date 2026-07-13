import { useState } from 'react';
import type { Collaborator, Invitation, PermissionMatrix } from '../../types';
import { ROLE_PRESET_LABELS } from '../../lib/rolePresets';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/toast';
import { cn } from '../../lib/utils';
import { Pencil, Trash2, Mail } from 'lucide-react';

interface Props {
  collaborator: Collaborator | Invitation;
  onEdit: (c: Collaborator | Invitation) => void;
  onRevoke: (c: Collaborator | Invitation) => void;
  onResend?: (c: Invitation) => void;
  refetch: () => void;
}

function isInvitation(c: Collaborator | Invitation): c is Invitation {
  return 'invitedAt' in c;
}

function getStatus(c: Collaborator | Invitation): 'active' | 'pending' | 'revoked' {
  if (isInvitation(c)) {
    if (c.revokedAt) return 'revoked';
    if (c.acceptedAt) return 'active';
    return 'pending';
  }
  if (c.revokedAt) return 'revoked';
  // Collaborator exists but user hasn't confirmed email / set password yet.
  if (c.isPending) return 'pending';
  return 'active';
}

export default function CollaboratorRow({ collaborator, onEdit, onRevoke, onResend, refetch }: Props) {
  const [isRevoking, setIsRevoking] = useState(false);

  const status = getStatus(collaborator);
  const roleLabel = ROLE_PRESET_LABELS[collaborator.rolePreset ?? 'custom'];

  const handleRevoke = async () => {
    if (!confirm('¿Eliminar este colaborador?')) return;
    setIsRevoking(true);
    try {
      if (isInvitation(collaborator)) {
        await supabase.rpc('revoke_invitation', { p_invitation_id: collaborator.id });
      } else {
        const { error } = await supabase.functions.invoke('delete-collaborator', {
          body: { collaborator_id: collaborator.id },
        });
        if (error) throw error;
      }
      showToast('Colaborador eliminado', 'success');
      refetch();
    } catch {
      showToast('Error al eliminar colaborador', 'error');
    } finally {
      setIsRevoking(false);
    }
  };

  const handleResend = async () => {
    if (!onResend) return;
    setIsRevoking(true);
    try {
      await onResend(collaborator as Invitation);
      refetch();
    } finally {
      setIsRevoking(false);
    }
  };

  const STATUS_STYLES = {
    active:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    revoked: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500',
  };

  const STATUS_LABELS = {
    active:  'Activo',
    pending: 'Pendiente',
    revoked: 'Revocado',
  };

  return (
    <div className={cn(
      "team-row flex items-center justify-between p-4 rounded-2xl border transition-all",
      status === 'revoked'
        ? "bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800 opacity-60"
        : "bg-white dark:bg-slate-800/50 border-slate-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-700"
    )}>
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
          <Mail size={18} className="text-indigo-600 dark:text-indigo-400" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-slate-900 dark:text-white truncate">{collaborator.email}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{roleLabel}</span>
            <span className={cn("text-[10px] font-black uppercase px-2 py-0.5 rounded-full", STATUS_STYLES[status])}>
              {STATUS_LABELS[status]}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {status === 'active' && (
          <>
            <button
              onClick={() => onEdit(collaborator)}
              className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-all"
              title="Editar permisos"
              disabled={isRevoking}
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={handleRevoke}
              disabled={isRevoking}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-xl transition-all"
              title="Revocar"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
        {status === 'pending' && (
          <>
            {onResend && (
              <button
                onClick={handleResend}
                disabled={isRevoking}
                className="px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-all border border-indigo-200 dark:border-indigo-800"
              >
                Reenviar
              </button>
            )}
            <button
              onClick={handleRevoke}
              disabled={isRevoking}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-xl transition-all"
              title="Revocar"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
