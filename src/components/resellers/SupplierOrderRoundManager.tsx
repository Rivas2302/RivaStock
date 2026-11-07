import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageCircle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ResellerSupplierOrderRound } from '../../types';
import {
  createResellerSupplierOrderRound,
  loadResellerSupplierRounds,
  setResellerSupplierOrderRoundStatus,
  setResellerSupplierRoundOrderStatus,
} from '../../lib/priceLists';
import { getSupplierRoundState, summarizeSupplierRound } from '../../lib/resellerSupplierRounds';
import { formatCurrency } from '../../lib/utils';
import { loadPdfRuntime } from '../../lib/pdfRuntime';

interface SupplierOrderRoundManagerProps {
  supplierListId: string;
  supplierName: string;
  supplierPhone?: string;
  canWrite: boolean;
}

function defaultCloseInput(): string {
  const local = new Date(Date.now() + 24 * 60 * 60 * 1000 - new Date().getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function buildWhatsAppUrl(phone: string, orderId: string): string | null {
  const number = phone.replace(/\D/g, '');
  if (number.length < 8) return null;
  const text = `Hola, te escribo por tu pedido por encargo #${orderId.slice(0, 8)} para coordinar el pago por WhatsApp.`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function buildSupplierWhatsAppUrl(phone: string, supplierName: string, lines: Array<{ productName: string; quantity: number; supplierTotal: number }>): string | null {
  const number = phone.replace(/\D/g, '');
  if (number.length < 8 || lines.length === 0) return null;
  const total = lines.reduce((sum, line) => sum + line.supplierTotal, 0);
  const products = lines.map(line => `${line.quantity} × ${line.productName} — ${formatCurrency(line.supplierTotal)}`).join('\n');
  const text = `Hola, te envío el pedido consolidado de ${supplierName}:\n${products}\nTotal: ${formatCurrency(total)}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export default function SupplierOrderRoundManager({ supplierListId, supplierName, supplierPhone = '', canWrite }: SupplierOrderRoundManagerProps) {
  const navigate = useNavigate();
  const [rounds, setRounds] = useState<ResellerSupplierOrderRound[]>([]);
  const [closeAt, setCloseAt] = useState(defaultCloseInput);
  const [minimum, setMinimum] = useState('0');
  const [audienceName, setAudienceName] = useState('Todos los revendedores');
  const [audienceCode, setAudienceCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRounds(await loadResellerSupplierRounds(supplierListId));
      setSchemaReady(true);
    } catch {
      setSchemaReady(false);
    } finally {
      setLoading(false);
    }
  }, [supplierListId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const createRound = async () => {
    const closeDate = new Date(closeAt);
    const minimumAmount = Number(minimum);
    if (!Number.isFinite(closeDate.getTime()) || closeDate <= new Date()) {
      setError('Elegí una fecha de cierre futura.');
      return;
    }
    if (!Number.isFinite(minimumAmount) || minimumAmount < 0) {
      setError('El mínimo de compra debe ser válido.');
      return;
    }
    const isDefaultAudience = audienceName.trim().toLocaleLowerCase('es-AR') === 'todos los revendedores';
    if (!audienceName.trim() || (!isDefaultAudience && !audienceCode.trim()) || (audienceCode.trim() && audienceCode.trim().length < 6)) {
      setError('Elegí un nombre y, para limitar la audiencia, ingresá un código de al menos 6 caracteres.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const round = await createResellerSupplierOrderRound({ supplierListId, closesAt: closeDate.toISOString(), minimumOrderAmount: minimumAmount, audienceName, audienceCode });
      await setResellerSupplierOrderRoundStatus(round.id, 'open');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo abrir el pedido.');
    } finally {
      setSaving(false);
    }
  };

  const changeRoundStatus = async (roundId: string, status: 'open' | 'closed') => {
    setSaving(true);
    setError(null);
    try {
      await setResellerSupplierOrderRoundStatus(roundId, status);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar la ronda.');
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async (roundOrderId: string) => {
    setSaving(true);
    setError(null);
    try {
      await setResellerSupplierRoundOrderStatus(roundOrderId, 'paid');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo marcar el pago.');
    } finally {
      setSaving(false);
    }
  };

  const downloadSupplierOrderPdf = async (round: ResellerSupplierOrderRound, lines: Array<{ productName: string; quantity: number; supplierTotal: number }>) => {
    if (lines.length === 0) return;
    const { jsPDF } = await loadPdfRuntime();
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const total = lines.reduce((sum, line) => sum + line.supplierTotal, 0);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(`Pedido a ${supplierName}`, 15, 18);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(`Cierre: ${new Date(round.closesAt).toLocaleString('es-AR')}`, 15, 26);
    let y = 40;
    for (const line of lines) {
      if (y > 270) { pdf.addPage(); y = 18; }
      pdf.text(`${line.quantity} x ${line.productName}`, 15, y);
      pdf.text(formatCurrency(line.supplierTotal), 195, y, { align: 'right' });
      y += 8;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Total: ${formatCurrency(total)}`, 195, Math.min(y + 5, 285), { align: 'right' });
    pdf.save(`pedido-${supplierName.toLocaleLowerCase('es-AR').replace(/[^a-z0-9]+/g, '-')}.pdf`);
  };

  const summaries = useMemo(() => new Map(rounds.map(round => [round.id, summarizeSupplierRound(round.orders.map(order => ({
    id: order.id,
    resellerName: order.resellerName,
    paidAt: order.paidAt,
    items: order.itemsSnapshot,
  })))])), [rounds]);

  if (loading) return <p role="status" className="mt-3 text-xs text-slate-500">Cargando rondas…</p>;
  if (!schemaReady) return <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">Las rondas se habilitan cuando se publique la actualización de pedidos por encargo.</p>;

  return <section aria-label={`Pedidos por encargo de ${supplierName}`} className="mt-4 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
    <header><h5 className="text-sm font-bold text-slate-900 dark:text-white">Pedidos por encargo</h5><p className="text-xs text-slate-600 dark:text-slate-300">El pago se coordina por WhatsApp. No se solicitan comprobantes.</p></header>
    <div className="grid gap-2 sm:grid-cols-[1fr_11rem_1fr]">
      <label className="text-xs font-semibold">Cierra<input aria-label={`Cierre de ronda ${supplierName}`} type="datetime-local" value={closeAt} onChange={event => setCloseAt(event.target.value)} disabled={!canWrite || saving} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"/></label>
      <label className="text-xs font-semibold">Pedido mínimo<input aria-label={`Mínimo de ronda ${supplierName}`} type="number" min="0" value={minimum} onChange={event => setMinimum(event.target.value)} disabled={!canWrite || saving} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"/></label>
      <label className="text-xs font-semibold">Quiénes lo ven<input aria-label={`Audiencia de ronda ${supplierName}`} value={audienceName} maxLength={80} onChange={event => setAudienceName(event.target.value)} disabled={!canWrite || saving} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"/></label>
      <label className="text-xs font-semibold sm:col-span-2">Código del grupo (opcional)<input aria-label={`Código de grupo de ronda ${supplierName}`} type="password" autoComplete="new-password" value={audienceCode} maxLength={120} onChange={event => setAudienceCode(event.target.value)} disabled={!canWrite || saving} placeholder="Vacío: todos los que tienen el código del catálogo" className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"/></label>
      <button type="button" onClick={() => void createRound()} disabled={!canWrite || saving} className="self-end min-h-11 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50">Abrir pedido</button>
    </div>
    {rounds.map(round => {
      const state = getSupplierRoundState(round.status, round.closesAt, now);
      const summary = summaries.get(round.id);
      return <article key={round.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-bold">{state === 'open' ? 'Abierta' : state === 'draft' ? 'Borrador' : 'Cerrada'} · {round.audienceName || 'Todos los revendedores'}</p><p className="text-xs text-slate-500">Cierre: {new Date(round.closesAt).toLocaleString('es-AR')} · Pedido mínimo {formatCurrency(round.minimumOrderAmount)}</p>{round.audienceCodeHash && audienceCode && <button type="button" onClick={() => void navigator.clipboard.writeText(audienceCode).then(() => setError(null)).catch(() => setError('No se pudo copiar el código del grupo.'))} className="mt-1 text-xs font-bold text-emerald-700 underline dark:text-emerald-300">Copiar código del grupo</button>}</div>
          {canWrite && state === 'open' && <button type="button" disabled={saving} onClick={() => void changeRoundStatus(round.id, 'closed')} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold dark:border-slate-700">Cerrar ronda</button>}
          {canWrite && state === 'draft' && <button type="button" disabled={saving} onClick={() => void changeRoundStatus(round.id, 'open')} className="min-h-10 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white">Abrir pedido</button>}
        </div>
        {summary && <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><p>Pagados: <strong>{summary.paidOrderCount}</strong></p><p>Pendientes: <strong>{summary.unpaidOrderCount}</strong></p><p>Al proveedor: <strong>{formatCurrency(summary.supplierTotal)}</strong></p><p>Ganancia: <strong>{formatCurrency(summary.profit)}</strong></p></div>}
        {summary && summary.lines.length > 0 && <div className="space-y-1 border-t border-slate-100 pt-2 text-xs dark:border-slate-800"><p className="font-bold">Pedido consolidado (solo pagos marcados)</p>{summary.lines.map(line => <p key={line.productId}>{line.quantity} × {line.productName} — {formatCurrency(line.supplierTotal)}</p>)}<div className="flex flex-wrap gap-2 pt-2"><button type="button" onClick={() => navigate('/compras', { state: { supplierOrderPrefill: { supplierName, reference: `Ronda ${round.id.slice(0, 8)}`, notes: summary.lines.map(line => `${line.quantity} × ${line.productName} — ${formatCurrency(line.supplierTotal)}`).join('\n') + `\nTotal: ${formatCurrency(summary.supplierTotal)}` } } })} disabled={!canWrite || state !== 'closed'} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold disabled:opacity-50 dark:border-slate-700">Crear compra</button>{buildSupplierWhatsAppUrl(supplierPhone, supplierName, summary.lines) && <a href={buildSupplierWhatsAppUrl(supplierPhone, supplierName, summary.lines) ?? undefined} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-bold dark:border-slate-700"><MessageCircle size={14}/>Enviar por WhatsApp</a>}<button type="button" onClick={() => void downloadSupplierOrderPdf(round, summary.lines).catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo preparar el PDF.'))} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold dark:border-slate-700">Descargar PDF</button></div></div>}
        {round.orders.map(order => <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs dark:border-slate-800"><div><p className="font-semibold">{order.resellerName} · {formatCurrency(order.resellerTotal)}</p><p className="text-slate-500">{order.status === 'ready' ? 'Listo para retirar' : order.status === 'sent_to_supplier' ? 'Pedido enviado al proveedor' : order.paidAt ? 'Pagado' : 'Pago pendiente'} · {order.itemsSnapshot.map(item => `${item.quantity} × ${item.productName}`).join(', ')}</p></div><div className="flex flex-wrap items-center gap-2">{!order.paidAt && canWrite && <button type="button" disabled={saving} onClick={() => void markPaid(order.id)} className="min-h-10 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white">Marcar pagado</button>}{order.paidAt && order.status === 'paid' && canWrite && <button type="button" disabled={saving} onClick={() => void setResellerSupplierRoundOrderStatus(order.id, 'sent_to_supplier').then(refresh).catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el pedido.'))} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold dark:border-slate-700">Marcar enviado</button>}{order.paidAt && order.status !== 'ready' && canWrite && <button type="button" disabled={saving} onClick={() => void setResellerSupplierRoundOrderStatus(order.id, 'ready').then(refresh).catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el pedido.'))} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold dark:border-slate-700">Listo para retirar</button>}{buildWhatsAppUrl(order.resellerPhone, order.orderId) && <a href={buildWhatsAppUrl(order.resellerPhone, order.orderId) ?? undefined} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-bold dark:border-slate-700"><MessageCircle size={14}/>Escribirle</a>}</div></div>)}
      </article>;
    })}
    {rounds.length === 0 && <p className="text-xs text-slate-500">Todavía no abriste una ronda para este proveedor.</p>}
    {error && <p role="alert" className="text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</p>}
    <button type="button" onClick={() => void refresh()} className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><RefreshCw size={14}/>Actualizar</button>
  </section>;
}
