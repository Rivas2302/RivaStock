import { useEffect, useState } from 'react';
import { Download, Loader2, LockKeyhole, Mail, ShieldAlert, Trash2, X } from 'lucide-react';
import { platformAdminRequest } from '../../lib/platformAdmin';
import { buildBusinessExportArchive, fetchBusinessExportObject, type BusinessExportManifest } from '../../lib/businessExport';
import type { PlatformBusiness } from '../../lib/platformAdmin';

export default function BusinessAccountActions({ business, onChange }: { business: PlatformBusiness; onChange: () => void }) {
  const [password, setPassword] = useState('');
  const [temporaryPasswordToShow, setTemporaryPasswordToShow] = useState('');
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [backupBeforeDelete, setBackupBeforeDelete] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [exportAcknowledged, setExportAcknowledged] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportSummary, setExportSummary] = useState('');
  const [confirmedName, setConfirmedName] = useState('');

  useEffect(() => () => { if (exportUrl) URL.revokeObjectURL(exportUrl); }, [exportUrl]);

  const sendRecovery = async () => run('recovery', async () => {
    await platformAdminRequest({ action: 'send_password_recovery', owner_uid: business.owner_uid });
    setFeedback('Se envió el enlace de recuperación.');
  }, 'No se pudo enviar el enlace de recuperación.');

  const setTemporaryPassword = async () => {
    if (password.length < 10 || password.length > 128) {
      setError('La contraseña temporal debe tener entre 10 y 128 caracteres.');
      return;
    }
    const temporaryPassword = password;
    await run('password', async () => {
      await platformAdminRequest({ action: 'set_temporary_password', owner_uid: business.owner_uid, password: temporaryPassword });
      setPassword('');
      setTemporaryPasswordToShow(temporaryPassword);
      setFeedback('La contraseña se muestra una sola vez. Compartila con la persona; deberá cambiarla al entrar.');
    }, 'No se pudo establecer la contraseña temporal.');
  };

  const prepareExport = async () => run('export', async () => {
    const manifest = await platformAdminRequest<BusinessExportManifest>({ action: 'export_business_manifest', owner_uid: business.owner_uid });
    const archive = await buildBusinessExportArchive(
      manifest,
      async (tableName, offset, limit) => platformAdminRequest<Record<string, unknown>[]>({
        action: 'export_business_table', owner_uid: business.owner_uid, table_name: tableName, offset, limit,
      }),
      fetchBusinessExportObject,
    );
    const blob = new Blob([archive.bytes.buffer as ArrayBuffer], { type: 'application/zip' });
    const nextUrl = URL.createObjectURL(blob);
    setExportUrl((current) => { if (current) URL.revokeObjectURL(current); return nextUrl; });
    setExportSummary(`${archive.rowCount} registros y ${archive.objectCount} archivos`);
    setExportReady(true);
    setFeedback('La copia está lista. Descargala antes de programar la baja.');
  }, 'No se pudo preparar una copia completa. No se programó la baja.');

  const requestDeletion = async (deleteNow = false) => run(deleteNow ? 'delete-now' : 'delete', async () => {
    await platformAdminRequest({
      action: deleteNow ? 'delete_business_now' : 'request_business_deletion',
      owner_uid: business.owner_uid,
      confirm_business_name: confirmedName,
    });
    closeDeleteDialog();
    setFeedback(deleteNow
      ? 'La cuenta, sus datos y archivos se eliminaron de forma definitiva.'
      : 'La baja quedó programada para dentro de 30 días.');
    onChange();
  }, deleteNow ? 'No se pudo completar la eliminación definitiva.' : 'No se pudo programar la baja.');

  const cancelDeletion = async () => run('cancel', async () => {
    await platformAdminRequest({ action: 'cancel_business_deletion', owner_uid: business.owner_uid });
    setFeedback('Se canceló la baja y la cuenta volvió a su estado anterior.');
    onChange();
  }, 'No se pudo cancelar la baja.');

  async function run(action: string, operation: () => Promise<void>, fallback: string) {
    if (busy) return;
    setBusy(action);
    setError('');
    setFeedback('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : fallback); }
    finally { setBusy(''); }
  }

  function closeDeleteDialog() {
    setDeleteDialog(false);
    setBackupBeforeDelete(false);
    setExportReady(false);
    setExportAcknowledged(false);
    setConfirmedName('');
    setExportSummary('');
    setExportUrl((current) => { if (current) URL.revokeObjectURL(current); return null; });
  }

  const deletionPending = Boolean(business.deletion_scheduled_for);
  const deleteStarted = Boolean(business.deletion_purge_started_at);
  const fileName = `RivaStock-copia-${business.business_name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'negocio'}.zip`;

  return <section className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800" aria-label={`Gestión de cuenta: ${business.business_name}`}>
    <h5 className="text-sm font-bold text-slate-800 dark:text-slate-100">Gestión de cuenta</h5>
    {deletionPending ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <div><strong>Baja programada</strong><span className="ml-2">{new Date(business.deletion_scheduled_for!).toLocaleString('es-AR')}</span>{business.deletion_failure && <span className="ml-2">La limpieza se reintentará automáticamente.</span>}</div>
      {!deleteStarted && <button type="button" disabled={Boolean(busy)} onClick={() => void cancelDeletion()} className="rounded-lg border border-amber-600 px-3 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'cancel' ? 'Cancelando…' : 'Cancelar baja'}</button>}
      {deleteStarted && <span className="font-semibold">La eliminación está en curso.</span>}
    </div> : <>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(busy)} onClick={() => void sendRecovery()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700"><Mail size={15}/>{busy === 'recovery' ? 'Enviando…' : 'Enviar enlace para cambiar contraseña'}</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => { setDeleteDialog(true); setError(''); setFeedback(''); setBackupBeforeDelete(false); setExportReady(false); setExportAcknowledged(false); }} className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800 disabled:opacity-50 dark:border-rose-900 dark:text-rose-200"><Trash2 size={15}/>Eliminar cuenta</button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/50">
        <label className="min-w-64 flex-1 text-xs font-semibold">Contraseña temporal
          <input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => { setPassword(event.target.value); setTemporaryPasswordToShow(''); }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
        </label>
        <button type="button" disabled={Boolean(busy) || password.length < 10} onClick={() => void setTemporaryPassword()} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-700"><LockKeyhole size={15}/>{busy === 'password' ? 'Guardando…' : 'Establecer contraseña temporal'}</button>
        <p className="basis-full text-xs text-slate-500 dark:text-slate-400">Se envía solo para actualizar Auth; se borra del formulario al guardar y no queda registrada. Al entrar, la persona debe cambiarla.</p>
        {temporaryPasswordToShow && <div className="basis-full flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><code className="select-all font-semibold">{temporaryPasswordToShow}</code><button type="button" onClick={() => setTemporaryPasswordToShow('')} className="shrink-0 font-semibold underline">Ocultar y borrar</button></div>}
      </div>
    </>}
    {feedback && <p role="status" className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{feedback}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>}

    {deleteDialog && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="business-deletion-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3"><div><h3 id="business-deletion-title" className="text-lg font-bold">Eliminar {business.business_name}</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">La cuenta quedará bloqueada y suspendida por 30 días. Después se borrarán los archivos y el usuario con sus datos. Podés cancelar antes de que empiece la eliminación.</p></div><button type="button" aria-label="Cerrar" onClick={closeDeleteDialog}><X size={18}/></button></div>
        <label className="mt-4 flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-700">
          <input type="checkbox" checked={backupBeforeDelete} onChange={(event) => {
            const checked = event.target.checked;
            setBackupBeforeDelete(checked);
            setExportReady(false);
            setExportAcknowledged(false);
            setExportSummary('');
            setExportUrl((current) => { if (current) URL.revokeObjectURL(current); return null; });
          }} />
          Descargar copia antes (recomendado)
        </label>
        {backupBeforeDelete && <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
          <h4 className="font-bold">Copia completa de datos y archivos</h4>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Incluye los registros del negocio y los archivos de Storage.</p>
          <button type="button" disabled={Boolean(busy)} onClick={() => void prepareExport()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === 'export' ? <Loader2 className="animate-spin" size={15}/> : <Download size={15}/>}Preparar copia</button>
          {exportReady && exportUrl && <div className="mt-3 rounded-lg bg-white p-3 text-sm dark:bg-slate-900"><p>Incluye {exportSummary}.</p><a className="mt-2 inline-flex font-bold text-indigo-700 underline dark:text-indigo-300" href={exportUrl} download={fileName} onClick={() => setExportAcknowledged(false)}>Descargar copia de datos</a><button type="button" className="ml-3 text-sm underline" onClick={() => setExportAcknowledged(true)}>Ya la descargué</button></div>}
        </div>}
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/20">
          <h4 className="font-bold">Confirmá el negocio</h4>
          <label className="mt-2 block text-sm">Escribí exactamente <strong>{business.business_name}</strong>
            <input value={confirmedName} onChange={(event) => setConfirmedName(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={(backupBeforeDelete && !exportAcknowledged) || confirmedName.trim() !== business.business_name || Boolean(busy)} onClick={() => void requestDeletion()} className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy === 'delete' ? 'Programando…' : 'Dar de baja en 30 días'}</button>
            <button type="button" disabled={(backupBeforeDelete && !exportAcknowledged) || confirmedName.trim() !== business.business_name || Boolean(busy)} onClick={() => void requestDeletion(true)} className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy === 'delete-now' ? 'Eliminando…' : <><ShieldAlert size={15}/>Eliminar ahora</>}</button>
          </div>
          <p className="mt-2 text-xs text-rose-800 dark:text-rose-200">«Eliminar ahora» borra la cuenta, sus datos y archivos de forma definitiva. No se puede deshacer.</p>
          {backupBeforeDelete && !exportAcknowledged && <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Descargá y confirmá la copia para habilitar cualquiera de las dos opciones.</p>}
        </div>
      </section>
    </div>}
  </section>;
}
