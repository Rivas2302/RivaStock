import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { fromDb } from '../../lib/db';
import type { Collaborator, Invitation, PermissionMatrix, StaffRole } from '../../types';
import { ROLE_PRESETS, ROLE_PRESET_LABELS, presetForMatrix } from '../../lib/rolePresets';
import { inviteCollaborator } from '../../lib/inviteCollaborator';
import PermissionsEditor from './PermissionsEditor';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editTarget?: Collaborator | Invitation | null;
}

export default function InviteForm({ isOpen, onClose, onSuccess, editTarget }: Props) {
  const [email, setEmail] = useState('');
  const [rolePreset, setRolePreset] = useState<StaffRole>('employee');
  const [permissions, setPermissions] = useState<PermissionMatrix>(() => ({ ...ROLE_PRESETS.employee }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alert, setAlert] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const isEditing = Boolean(editTarget);

  useEffect(() => {
    if (!isOpen) return;
    if (editTarget) {
      setEmail(editTarget.email);
      setRolePreset(editTarget.rolePreset ?? 'custom');
      setPermissions(editTarget.permissions);
    } else {
      setEmail('');
      setRolePreset('employee');
      setPermissions({ ...ROLE_PRESETS.employee });
    }
    setAlert(null);
  }, [isOpen, editTarget]);

  const handlePresetChange = useCallback((preset: StaffRole) => {
    setRolePreset(preset);
    if (preset !== 'custom' && ROLE_PRESETS[preset]) {
      setPermissions({ ...ROLE_PRESETS[preset] });
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setAlert({ text: 'El email es obligatorio', type: 'error' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setAlert({ text: 'Email inválido', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setAlert(null);

    try {
      if (isEditing && editTarget) {
        const { error } = await supabase.rpc('update_collaborator_permissions', {
          p_collab_id:    editTarget.id,
          p_permissions:   permissions,
          p_role_preset:  rolePreset,
        });
        if (error) throw error;
        setAlert({ text: 'Permisos actualizados', type: 'success' });
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1200);
        return;
      }

      const result = await inviteCollaborator({
        email: email.trim(),
        permissions,
        role_preset: rolePreset,
      });
      const successMessage = result.status === 'sent'
        ? `Invitación enviada a ${email.trim()}`
        : result.status === 'reactivated'
          ? `Colaborador reactivado: ${email.trim()}`
          : result.status === 'already_active'
            ? `El colaborador ya está activo: ${email.trim()}`
            : `${email.trim()} ya tiene cuenta y fue agregado como colaborador. Puede iniciar sesión normalmente.`;

      setAlert({ text: successMessage, type: 'success' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      setAlert({ text: err instanceof Error ? err.message : 'Error al enviar invitación', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="invite-dialog relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl z-[70] border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">
            {isEditing ? 'Editar permisos' : 'Invitar colaborador'}
          </h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {!isEditing && (
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="colaborador@ejemplo.com"
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                disabled={isSubmitting}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">Rol</label>
            <select
              value={rolePreset}
              onChange={e => handlePresetChange(e.target.value as StaffRole)}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              disabled={isSubmitting}
            >
              {(Object.keys(ROLE_PRESET_LABELS) as StaffRole[]).map(role => (
                <option key={role} value={role}>{ROLE_PRESET_LABELS[role]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Permisos</label>
            <PermissionsEditor
              value={permissions}
              onChange={setPermissions}
            />
          </div>

          {alert && (
            <div className={`px-4 py-3 rounded-xl text-sm font-bold ${
              alert.type === 'success'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
            }`}>
              {alert.text}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              disabled={isSubmitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isSubmitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {isEditing ? 'Guardar' : 'Enviar invitación'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
