import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../lib/db';
import { Quote, UserProfile } from '../types';
import { formatCurrency } from '../lib/utils';
import { AlertTriangle, Clock, CheckCircle2, FileText } from 'lucide-react';

export default function QuotePublic() {
  const { id } = useParams<{ id: string }>();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [owner, setOwner] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    (async () => {
      try {
        const q = await db.get<Quote>('quotes', id);
        if (!q) { setNotFound(true); setLoading(false); return; }
        setQuote(q);
        const ownerProfile = await db.get<UserProfile>('users', q.ownerUid);
        setOwner(ownerProfile);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (notFound || !quote) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
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

  const createdDate = new Date(quote.createdAt).toLocaleDateString('es-AR');
  const expiresDate = expiresAt.toLocaleDateString('es-AR');

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Expired banner */}
      {isExpired && (
        <div className="bg-rose-600 text-white text-center py-3 px-4 text-sm font-bold">
          <AlertTriangle size={16} className="inline mr-2" />
          Este presupuesto ha vencido el {expiresDate}
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-4">
          <div className="bg-indigo-600 px-8 py-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-indigo-200 text-sm font-medium">Presupuesto</p>
                <h1 className="text-2xl font-black mt-0.5">{quote.number}</h1>
              </div>
              <div className="text-right">
                {owner && <p className="font-bold text-lg">{owner.businessName}</p>}
                <p className="text-indigo-200 text-sm mt-0.5">Fecha: {createdDate}</p>
              </div>
            </div>
          </div>

          {/* Client + validity */}
          <div className="px-8 py-5 border-b border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-0.5">Para</p>
                <p className="font-bold text-slate-900 text-lg">{quote.clientName}</p>
                {quote.clientPhone && <p className="text-slate-500 text-sm">{quote.clientPhone}</p>}
                {quote.clientEmail && <p className="text-slate-500 text-sm">{quote.clientEmail}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-0.5">Válido hasta</p>
                <p className={`font-bold text-sm ${isExpired ? 'text-rose-600' : 'text-slate-900'}`}>{expiresDate}</p>
                {isNearExpiry && (
                  <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-bold">
                    <Clock size={12} />
                    Vence en {daysLeft} día{daysLeft !== 1 ? 's' : ''}
                  </div>
                )}
                {!isExpired && !isNearExpiry && (
                  <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">
                    <CheckCircle2 size={12} />
                    Vigente
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Items table */}
          <div className="px-8 py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-400 font-semibold border-b border-slate-100">
                  <th className="py-2 text-left">Descripción</th>
                  <th className="py-2 text-center">Cant.</th>
                  <th className="py-2 text-right">Precio U.</th>
                  <th className="py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {quote.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-3 font-medium text-slate-900">{item.productName}</td>
                    <td className="py-3 text-center text-slate-600">{item.quantity}</td>
                    <td className="py-3 text-right text-slate-600">{formatCurrency(item.unitPrice)}</td>
                    <td className="py-3 text-right font-semibold text-slate-900">{formatCurrency(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="px-8 py-5 bg-slate-50 border-t border-slate-100">
            <div className="max-w-xs ml-auto space-y-1.5">
              <div className="flex justify-between text-sm text-slate-500">
                <span>Subtotal</span>
                <span>{formatCurrency(quote.subtotal)}</span>
              </div>
              {quote.discount > 0 && (
                <div className="flex justify-between text-sm text-emerald-600 font-medium">
                  <span>Descuento ({quote.discount}%)</span>
                  <span>-{formatCurrency(quote.subtotal - quote.total)}</span>
                </div>
              )}
              <div className="flex justify-between text-xl font-black text-slate-900 pt-2 border-t border-slate-200">
                <span>Total</span>
                <span className="text-indigo-600">{formatCurrency(quote.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        {quote.notes && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-8 py-5 mb-4">
            <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-2">Observaciones</p>
            <p className="text-slate-700 text-sm whitespace-pre-wrap">{quote.notes}</p>
          </div>
        )}

        {/* Contact */}
        {owner && (owner.phone || owner.email_contact) && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-8 py-5 mb-4">
            <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-3">Contacto</p>
            <p className="font-bold text-slate-900 mb-1">{owner.businessName}</p>
            {owner.phone && (
              <a href={`tel:${owner.phone}`} className="block text-sm text-indigo-600 hover:underline">{owner.phone}</a>
            )}
            {owner.email_contact && (
              <a href={`mailto:${owner.email_contact}`} className="block text-sm text-indigo-600 hover:underline">{owner.email_contact}</a>
            )}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">Generado con RivaStock</p>
      </div>
    </div>
  );
}
