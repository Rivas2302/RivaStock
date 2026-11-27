import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fromDb, supabase } from '../lib/db';
import { Quote } from '../types';
import QuoteDocument from '../components/quotes/QuoteDocument';

interface PublicOwner {
  businessName: string;
  phone?: string;
  email_contact?: string;
  currencySymbol?: string;
  logoUrl?: string;
}

type PublicQuote = Pick<Quote,
  'id' | 'number' | 'clientName' | 'clientPhone' | 'clientEmail' | 'items'
  | 'subtotal' | 'discount' | 'shippingAmount' | 'total' | 'expiresAt' | 'notes' | 'createdAt'
>;
import { AlertTriangle, Clock, CheckCircle2, FileText } from 'lucide-react';

export default function QuotePublic() {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const { id } = useParams<{ id: string }>();
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [owner, setOwner] = useState<PublicOwner | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    // If offline from the start, skip network requests for this page
    if (!online) {
      setLoading(false);
      setNotFound(false);
      return;
    }
    if (!id) { setNotFound(true); setLoading(false); return; }
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_public_quote_with_shipping', { p_quote_id: id }).maybeSingle();
        if (error) throw error;
        if (!data) { setNotFound(true); setLoading(false); return; }
        const row = data as Record<string, unknown>;
        setQuote(fromDb<PublicQuote>(row));
        if (row.business_name) {
          setOwner({
            businessName: String(row.business_name),
            phone: row.business_phone ? String(row.business_phone) : undefined,
            email_contact: row.email_contact ? String(row.email_contact) : undefined,
            currencySymbol: row.currency_symbol ? String(row.currency_symbol) : undefined,
            logoUrl: row.logo_url ? String(row.logo_url) : undefined,
          });
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="public-quote-page min-h-[100dvh] flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }
  if (notFound || !quote) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Offline fallback for direct URL access
      return (
        <div className="public-quote-page min-h-[100dvh] flex items-center justify-center bg-slate-50 px-4">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText size={28} className="text-slate-400" />
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-2">Sin conexión</h1>
            <p className="text-slate-500 text-sm">No hay conexión a Internet. Conéctate para ver el presupuesto.</p>
            <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white">Reintentar</button>
          </div>
        </div>
      );
    }
    return (
      <div className="public-quote-page min-h-[100dvh] flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText size={28} className="text-slate-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Presupuesto no encontrado</h1>
          <p className="text-slate-500 text-sm">El link puede haber vencido o el presupuesto fue eliminado.</p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const expiresAt = new Date(quote.expiresAt);
  const isExpired = expiresAt < now;
  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000);
  const isNearExpiry = !isExpired && daysLeft <= 3;
  const expiresDate = expiresAt.toLocaleDateString('es-AR');
  const businessName = owner?.businessName || 'RivaTech';

  return (
    <div className="public-quote-page min-h-[100dvh] bg-slate-50 px-3 py-6 sm:px-4 sm:py-10">
      {isExpired && <div className="mx-auto mb-4 max-w-3xl rounded-xl bg-rose-600 px-4 py-3 text-center text-sm font-bold text-white"><AlertTriangle size={16} className="mr-2 inline" />Este presupuesto venció el {expiresDate}</div>}
      <main className="mx-auto max-w-3xl">
        {isNearExpiry && <div className="mb-3 rounded-xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900"><Clock size={15} className="mr-2 inline" />Vence en {daysLeft} día{daysLeft !== 1 ? 's' : ''}</div>}
        {!isExpired && !isNearExpiry && <div className="mb-3 rounded-xl bg-emerald-100 px-4 py-3 text-sm font-semibold text-emerald-900"><CheckCircle2 size={15} className="mr-2 inline" />Presupuesto vigente</div>}
        <QuoteDocument quote={quote} businessName={businessName} currencySymbol={owner?.currencySymbol || '$'} logoUrl={owner?.logoUrl} />
        {owner && (owner.phone || owner.email_contact) && <section className="mt-4 rounded-2xl border border-slate-200 bg-white px-5 py-5 sm:px-8">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">Contacto</h2>
          <p className="mt-2 font-bold text-slate-900">{businessName}</p>
          {owner.phone && <a href={'tel:' + owner.phone} className="mt-1 block text-sm text-indigo-600 hover:underline">{owner.phone}</a>}
          {owner.email_contact && <a href={'mailto:' + owner.email_contact} className="mt-1 block text-sm text-indigo-600 hover:underline">{owner.email_contact}</a>}
        </section>}
        <p className="mt-6 text-center text-xs text-slate-400">Generado con RivaStock</p>
      </main>
    </div>
  );

}
