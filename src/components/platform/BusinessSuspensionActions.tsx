import { useState } from 'react';
import { MessageCircle, RotateCcw, ShieldAlert } from 'lucide-react';
import { platformAdminRequest } from '../../lib/platformAdmin';
import type { PlatformBusiness } from '../../lib/platformAdmin';

function localDateAfterDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalMidnightIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

export default function BusinessSuspensionActions({ business, onChange }: { business: PlatformBusiness; onChange: () => void }) {
  const [date, setDate] = useState(() => localDateAfterDays(7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [emailSent, setEmailSent] = useState(Boolean(business.suspension_notice_sent_at));
  const deletionPending = Boolean(business.deletion_scheduled_for);
  const actionDisabled = busy || Boolean(business.business_action_disabled_reason);

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la suspensión.');
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => run(async () => {
    const response = await platformAdminRequest<{ scheduled_for: string; email_sent: boolean }>({
      action: 'schedule_business_suspension', owner_uid: business.owner_uid, scheduled_for: toLocalMidnightIso(date),
    });
    setEmailSent(response.email_sent);
    setNotice(response.email_sent
      ? `Suspensión programada para ${new Date(response.scheduled_for).toLocaleDateString('es-AR')}. Se envió el email de aviso.`
      : `Suspensión programada para ${new Date(response.scheduled_for).toLocaleDateString('es-AR')}. El email quedó pendiente de configurar el remitente y el WhatsApp de RivaTech.`);
  });

  const cancel = async () => run(async () => {
    await platformAdminRequest({ action: 'cancel_business_suspension', owner_uid: business.owner_uid });
    setNotice('Se canceló la suspensión programada. La cuenta y sus datos siguen activos.');
  });

  const reactivate = async () => run(async () => {
    await platformAdminRequest({ action: 'reactivate_business', owner_uid: business.owner_uid });
    setNotice('La cuenta se reactivó con su estado anterior y conserva sus datos.');
  });

  const retryEmail = async () => run(async () => {
    const response = await platformAdminRequest<{ email_sent: boolean }>({ action: 'send_business_suspension_notice', owner_uid: business.owner_uid });
    setEmailSent(response.email_sent);
    setNotice(response.email_sent ? 'Se envió el email de aviso.' : 'El email sigue pendiente de configurar el remitente y el WhatsApp de RivaTech.');
  });

  return <section aria-label={`Suspensión de ${business.business_name?.trim() || business.email}`} className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h5 className="inline-flex items-center gap-2 text-sm font-bold"><ShieldAlert size={15}/>Suspensión</h5>
        {business.suspension_scheduled_for
          ? <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Programada para {new Date(business.suspension_scheduled_for).toLocaleString('es-AR')} · email {emailSent ? 'enviado' : 'pendiente'}</p>
          : business.status === 'suspended'
            ? <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Acceso bloqueado; los datos se conservan.</p>
            : <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">El cliente recibe un aviso antes del bloqueo.</p>}
      </div>
      {!deletionPending && business.status === 'suspended' && <button type="button" disabled={actionDisabled} onClick={() => void reactivate()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><RotateCcw size={15}/>{busy ? 'Reactivando…' : 'Reactivar cuenta'}</button>}
      {!deletionPending && business.status !== 'suspended' && business.suspension_scheduled_for && <div className="flex flex-wrap gap-2">
        {!emailSent && <button type="button" disabled={actionDisabled} onClick={() => void retryEmail()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-700 px-3 py-2 text-sm font-semibold disabled:opacity-50"><MessageCircle size={15}/>Reintentar email</button>}
        <button type="button" disabled={actionDisabled} onClick={() => void cancel()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-700 px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancelar programación</button>
      </div>}
      {!deletionPending && business.status !== 'suspended' && !business.suspension_scheduled_for && <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold">Fecha de suspensión<input type="date" disabled={actionDisabled} value={date} min={localDateAfterDays(1)} max={localDateAfterDays(90)} onChange={(event) => setDate(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-amber-300 bg-white px-2 text-sm text-slate-900 disabled:opacity-50 dark:border-amber-800 dark:bg-slate-950 dark:text-white" /></label>
        <button type="button" disabled={actionDisabled || !date} onClick={() => void schedule()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><ShieldAlert size={15}/>{busy ? 'Programando…' : 'Programar suspensión'}</button>
      </div>}
    </div>
    {business.business_action_disabled_reason && business.business_action_disabled_reason !== business.account_action_disabled_reason && <p role="note" className="mt-2 text-xs font-medium text-amber-900 dark:text-amber-200">{business.business_action_disabled_reason}</p>}
    {notice && <p role="status" className="mt-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-xs font-semibold text-rose-800 dark:text-rose-300">{error}</p>}
    {business.suspension_notice_error && <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">El email no llegó a salir: falta configurar un remitente verificado y el WhatsApp de RivaTech.</p>}
  </section>;
}
