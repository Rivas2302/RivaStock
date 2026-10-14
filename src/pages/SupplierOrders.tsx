import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Package, FileText, Truck, Check, Pencil, Search, ExternalLink } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
import { useSuppliers } from '../hooks/useSuppliers';
import { supabase } from '../lib/supabase';
import { todayString, formatDate } from '../lib/utils';
import { showToast } from '../lib/toast';
import Modal from '../components/Modal';
import { SUPPLIER_ORDER_STATUSES, isPendingOrder, sortSupplierOrders, trackingUrl, validateOrderPdf, type SupplierOrder, type SupplierOrderStatus } from '../lib/supplierOrders';

const BUCKET = 'supplier-order-documents';
const inputClass = 'w-full rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-900';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700';
const errorMessage = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  if (e?.code === '23505') return 'Este pedido o número de guía ya está registrado. Actualiza el listado antes de volver a guardar.';
  return e?.message || 'No se pudo completar la operación. Intenta nuevamente.';
};

export default function SupplierOrders() {
  const { user, refetchToken } = useAuth();
  const canWrite = usePermission('proveedores', 'write');
  const { suppliers } = useSuppliers();
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('pending');
  const [editing, setEditing] = useState<SupplierOrder | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ supplier_name: '', ordered_on: todayString(), reference: '', tracking_number: '', status: 'pending' as SupplierOrderStatus, notes: '' });
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const draftId = useRef('');
  const [tracking, setTracking] = useState<SupplierOrder | null>(null);
  const [document, setDocument] = useState<{ url: string; name: string } | null>(null);
  const loadSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!user) { setOrders([]); setLoading(false); return; }
    setLoading(true);
    setLoadError('');
    try {
      const rows: SupplierOrder[] = [];
      let cursor: string | undefined;
      while (true) {
        let query = supabase.from('supplier_orders').select('*').eq('user_id', user.uid).order('id').limit(500);
        if (cursor) query = query.gt('id', cursor);
        const { data, error } = await query;
        if (sequence !== loadSequence.current) return;
        if (error) throw error;
        rows.push(...data as SupplierOrder[]);
        if (data.length < 500) break;
        cursor = data[data.length - 1].id;
      }
      setOrders(rows);
    } catch {
      if (sequence === loadSequence.current) setLoadError('No se pudieron cargar los pedidos. Verifica la conexión y que el módulo esté habilitado en la base de datos.');
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [user?.uid]);
  useEffect(() => { void refresh(); return () => { loadSequence.current++; }; }, [refresh, refetchToken]);

  function openForm(order?: SupplierOrder) {
    setEditing(order ?? null);
    draftId.current = order?.id ?? crypto.randomUUID();
    setForm(order ? { supplier_name: order.supplier_name, ordered_on: order.ordered_on, reference: order.reference, tracking_number: order.tracking_number ?? '', status: order.status, notes: order.notes }
      : { supplier_name: '', ordered_on: todayString(), reference: '', tracking_number: '', status: 'pending', notes: '' });
    setFile(null); setFormError(''); setFormOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !canWrite || busyRef.current) return;
    busyRef.current = true; setBusy(true); setFormError('');
    let uploadedPath: string | null = null;
    let committed = false;
    try {
      const guide = form.tracking_number.replace(/\s/g, '');
      if (guide) trackingUrl(guide);
      if (!form.supplier_name.trim()) throw new Error('Ingresa el proveedor.');
      let path = editing?.document_path ?? null;
      let name = editing?.document_name ?? null;
      if (file) {
        await validateOrderPdf(file);
        uploadedPath = `${user.uid}/${draftId.current}/${crypto.randomUUID()}.pdf`;
        const { error } = await supabase.storage.from(BUCKET).upload(uploadedPath, file, { contentType: 'application/pdf', upsert: false });
        if (error) throw error;
        path = uploadedPath; name = file.name;
      }
      const values = { ...form, supplier_name: form.supplier_name.trim(), reference: form.reference.trim(), tracking_number: guide || null, document_path: path, document_name: name };
      const query = editing
        ? supabase.from('supplier_orders').update(values).eq('id', editing.id).eq('updated_at', editing.updated_at)
        : supabase.from('supplier_orders').insert({ ...values, id: draftId.current, user_id: user.uid });
      const { data, error } = await query.select().single();
      if (error) {
        if (error.code === 'PGRST116') throw new Error('Otro usuario modificó este pedido. Cierra el formulario, actualiza y vuelve a editar.');
        throw error;
      }
      committed = true;
      loadSequence.current++; setLoading(false);
      setOrders(current => [data as SupplierOrder, ...current.filter(o => o.id !== data.id)]);
      if (uploadedPath && editing?.document_path) {
        await supabase.storage.from(BUCKET).remove([editing.document_path]);
      }
      setFormOpen(false); showToast('Pedido guardado', 'success');
    } catch (error) {
      // The storage policy keeps files referenced by a successfully committed order,
      // including when its response was lost in transit.
      if (uploadedPath && !committed) await supabase.storage.from(BUCKET).remove([uploadedPath]);
      setFormError(errorMessage(error));
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function markReceived(order: SupplierOrder) {
    if (!canWrite || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const { data, error } = await supabase.from('supplier_orders').update({ status: 'received' }).eq('id', order.id).eq('updated_at', order.updated_at).select().single();
      if (error) throw new Error('No se pudo confirmar la recepción. Actualiza el listado y vuelve a intentar.');
      loadSequence.current++; setLoading(false);
      setOrders(current => current.map(o => o.id === order.id ? data as SupplierOrder : o));
      showToast('Pedido marcado como recibido. Puedes reabrirlo desde el historial.', 'success');
    } catch (error) { showToast(errorMessage(error), 'error'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function openDocument(order: SupplierOrder) {
    if (!order.document_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(order.document_path, 600);
    if (error) { showToast('No se pudo abrir el PDF. Intenta nuevamente.', 'error'); return; }
    setDocument({ url: data.signedUrl, name: order.document_name || 'Pedido.pdf' });
  }

  const pending = orders.filter(isPendingOrder);
  const ready = pending.filter(o => o.status === 'ready');
  const term = search.trim().toLocaleLowerCase('es');
  const visible = sortSupplierOrders(orders.filter(o => {
    const matchesFilter = filter === 'all' || (filter === 'pending' ? isPendingOrder(o) : filter === 'history' ? !isPendingOrder(o) : o.status === 'ready');
    return matchesFilter && `${o.supplier_name} ${o.reference} ${o.tracking_number ?? ''} ${o.notes}`.toLocaleLowerCase('es').includes(term);
  }));

  return <div className="mx-auto max-w-6xl space-y-6 text-slate-900 dark:text-slate-100">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-bold">Compras a proveedores</h1><p className="mt-1 text-sm text-slate-500">Tus pedidos, comprobantes y envíos en un solo lugar.</p></div>
      {canWrite && <button className={`${buttonClass} bg-indigo-600 text-white`} onClick={() => openForm()}><Plus size={18} /> Nuevo pedido</button>}
    </header>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {[['Pendientes', pending.length], ['Para retirar', ready.length], ['Sin guía', pending.filter(o => !o.tracking_number).length]].map(([label, count]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold">{count}</p></div>)}
    </div>
    <div className="flex flex-wrap gap-3">
      <label className="relative min-w-48 flex-1"><Search size={18} className="absolute left-3 top-3.5 text-slate-400" /><span className="sr-only">Buscar pedidos</span><input className={`${inputClass} pl-10`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Proveedor, guía o referencia" /></label>
      <select aria-label="Filtrar pedidos" className={`${inputClass} sm:w-auto`} value={filter} onChange={e => setFilter(e.target.value)}><option value="pending">Pendientes</option><option value="ready">Para retirar</option><option value="history">Historial</option><option value="all">Todos</option></select>
      <button className={buttonClass} disabled={loading || busy} onClick={() => void refresh()}>Actualizar listado</button>
    </div>
    {loadError ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{loadError}</p> : loading ? <p role="status">Cargando pedidos…</p> : <>
      {!visible.length && <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center"><Package className="mx-auto mb-3 text-slate-400" /><p className="font-semibold">{orders.length ? 'No hay pedidos con este filtro.' : 'Registra tu primer pedido'}</p><p className="mt-2 text-sm text-slate-500">Solo necesitas el proveedor y la fecha. Puedes agregar el PDF y la guía después.</p></div>}
      <div className="space-y-3">{visible.map(order => <article key={order.id} className={`rounded-2xl border bg-white p-4 sm:p-5 dark:bg-slate-900 ${order.status === 'ready' ? 'border-amber-400' : 'border-slate-200 dark:border-slate-800'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-bold">{order.supplier_name}</h2><p className="text-sm text-slate-500">Pedido del {formatDate(order.ordered_on)}{order.reference ? ` · ${order.reference}` : ''}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${order.status === 'ready' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{SUPPLIER_ORDER_STATUSES[order.status]}</span></div>
        <p className="mt-3 text-sm">{order.tracking_number ? `Vía Cargo · ${order.tracking_number}` : 'Sin guía de envío todavía'}</p>
        {order.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-500">{order.notes}</p>}
        {order.received_at && <p className="mt-2 text-sm text-slate-500">Recibido el {formatDate(order.received_at.slice(0, 10))}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {order.document_path && <button className={buttonClass} onClick={() => void openDocument(order)}><FileText size={16} /> Ver PDF</button>}
          {order.tracking_number && <button className={buttonClass} onClick={() => setTracking(order)}><Truck size={16} /> Seguir envío</button>}
          {canWrite && <button className={buttonClass} disabled={busy} onClick={() => openForm(order)}><Pencil size={16} /> Editar</button>}
          {canWrite && isPendingOrder(order) && <button className={`${buttonClass} bg-emerald-700 text-white`} disabled={busy} onClick={() => void markReceived(order)}><Check size={16} /> Marcar recibido</button>}
        </div>
      </article>)}</div>
    </>}
    <Modal isOpen={formOpen} onClose={() => { if (!busy) setFormOpen(false); }} title={editing ? 'Editar pedido' : 'Nuevo pedido'}>
      <form onSubmit={save} className="space-y-4">
        <label className="block">Proveedor<input autoFocus required maxLength={160} list="order-suppliers" className={`${inputClass} mt-1`} value={form.supplier_name} onChange={e => setForm({ ...form, supplier_name: e.target.value })} placeholder="Selecciona o escribe el nombre" /></label>
        <datalist id="order-suppliers">{suppliers.map(s => <option key={s.id} value={s.name} />)}</datalist>
        <div className="grid gap-4 sm:grid-cols-2"><label>Fecha del pedido<input required type="date" className={`${inputClass} mt-1`} value={form.ordered_on} onChange={e => setForm({ ...form, ordered_on: e.target.value })} /></label><label>Referencia (opcional)<input maxLength={160} className={`${inputClass} mt-1`} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="Número de pedido o descripción" /></label></div>
        <label className="block">Guía de Vía Cargo (opcional)<input inputMode="numeric" className={`${inputClass} mt-1`} value={form.tracking_number} onChange={e => setForm({ ...form, tracking_number: e.target.value })} placeholder="12 dígitos" maxLength={24} /></label>
        <label className="block" htmlFor="supplier-order-status">Estado del pedido</label>
        <select id="supplier-order-status" className={inputClass} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as SupplierOrderStatus })}>{Object.entries(SUPPLIER_ORDER_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <p className="text-xs text-slate-500">El estado lo actualiza tu equipo después de consultar el envío.</p>
        <label className="block">PDF del pedido (opcional)<input key={draftId.current} type="file" accept="application/pdf,.pdf" className={`${inputClass} mt-1 text-sm`} onChange={e => setFile(e.target.files?.[0] ?? null)} /><span className="text-xs text-slate-500">Hasta 10 MB.{editing?.document_name ? ` Actual: ${editing.document_name}. Adjuntar otro lo reemplaza.` : ''}</span></label>
        <label className="block">Notas (opcional)<textarea maxLength={4000} rows={3} className={`${inputClass} mt-1`} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Sucursal de retiro, bultos o aclaraciones" /></label>
        {formError && <p role="alert" className="text-sm text-rose-600">{formError}</p>}
        <button type="submit" disabled={busy} className={`${buttonClass} w-full bg-indigo-600 text-white`}>{busy ? 'Guardando…' : 'Guardar pedido'}</button>
      </form>
    </Modal>
    <Modal isOpen={!!tracking} onClose={() => setTracking(null)} title={`Seguimiento · ${tracking?.supplier_name ?? ''}`} className="max-w-4xl">
      {tracking?.tracking_number && <div className="space-y-3"><p className="text-sm text-slate-500">Consulta oficial de Vía Cargo con tu guía cargada. Si solicita una verificación, complétala aquí. El estado del pedido se actualiza desde Editar.</p><a className={buttonClass} href={trackingUrl(tracking.tracking_number)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Abrir en Vía Cargo</a><iframe title="Seguimiento oficial de Vía Cargo" src={trackingUrl(tracking.tracking_number)} className="h-[60vh] min-h-80 w-full rounded-xl border bg-white" referrerPolicy="no-referrer" /></div>}
    </Modal>
    <Modal isOpen={!!document} onClose={() => setDocument(null)} title={document?.name ?? 'PDF del pedido'} className="max-w-4xl">{document && <div className="space-y-3"><a className={buttonClass} href={document.url} target="_blank" rel="noopener noreferrer">Abrir PDF en otra pestaña</a><iframe title="PDF del pedido" src={document.url} className="h-[65vh] w-full rounded-xl border" /></div>}</Modal>
  </div>;
}
