import type { Quote } from '../../types';
import { formatCurrency } from '../../lib/utils';

interface QuoteDocumentProps {
  quote: Pick<Quote, 'number' | 'clientName' | 'clientPhone' | 'clientEmail' | 'items' | 'subtotal' | 'discount' | 'shippingAmount' | 'total' | 'expiresAt' | 'notes' | 'createdAt'>;
  businessName: string;
  currencySymbol: string;
  logoUrl?: string;
}

const availabilityLabels = {
  immediate: 'Entrega inmediata',
  on_order: 'Bajo pedido',
  confirm: 'Disponibilidad a confirmar',
} as const;

export default function QuoteDocument({ quote, businessName, currencySymbol, logoUrl }: QuoteDocumentProps) {
  const format = (amount: number) => formatCurrency(amount, currencySymbol);
  const date = (value: string) => new Date(value).toLocaleDateString('es-AR');
  const discountAmount = quote.subtotal * quote.discount / 100;

  return (
    <article className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm">
      <header className="bg-slate-950 px-5 py-5 text-white sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl
              ? <img src={logoUrl} alt={businessName} className="size-12 shrink-0 rounded-xl bg-white object-contain p-1" />
              : <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-400 text-xl font-black text-slate-950">{businessName.trim().charAt(0).toUpperCase() || 'R'}</span>}
            <div className="min-w-0">
              <p className="truncate text-lg font-black">{businessName || 'Mi negocio'}</p>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-300">Presupuesto</p>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-xl font-black">{quote.number}</p>
            <p className="mt-1 text-xs text-slate-300">Emitido {date(quote.createdAt)}</p>
          </div>
        </div>
      </header>

      <section className="grid gap-4 border-b border-slate-100 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-8">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Presupuesto para</p>
          <p className="mt-1 break-words text-lg font-bold">{quote.clientName}</p>
          {quote.clientPhone && <p className="text-sm text-slate-500">{quote.clientPhone}</p>}
          {quote.clientEmail && <p className="break-all text-sm text-slate-500">{quote.clientEmail}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Válido hasta</p>
          <p className="mt-1 font-bold">{date(quote.expiresAt)}</p>
        </div>
      </section>

      <section className="space-y-3 px-5 py-5 sm:px-8">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">Productos incluidos</h2>
        {quote.items.length === 0
          ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Todavía no agregaste productos.</p>
          : <div className="divide-y divide-slate-100">
            {quote.items.map((item, index) => {
              const availability = item.availability ?? 'confirm';
              return <div key={item.productId + '-' + index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_64px_120px_120px] sm:items-center">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{item.productName}</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-800">{availabilityLabels[availability]}</p>
                  {item.leadTime && <p className="mt-0.5 text-xs text-slate-500">Plazo estimado: {item.leadTime}</p>}
                </div>
                <span className="text-right text-sm text-slate-600 sm:text-center">{item.quantity}</span>
                <span className="text-right text-sm text-slate-600">{format(item.unitPrice)} c/u</span>
                <strong className="text-right text-sm">{format(item.subtotal)}</strong>
              </div>;
            })}
          </div>}
      </section>

      <section className="bg-slate-50 px-5 py-5 sm:px-8">
        <div className="ml-auto max-w-sm space-y-2">
          <div className="flex justify-between gap-4 text-sm text-slate-600"><span>Subtotal productos</span><span>{format(quote.subtotal)}</span></div>
          {quote.discount > 0 && <div className="flex justify-between gap-4 text-sm font-medium text-emerald-700"><span>Descuento ({quote.discount}%)</span><span>−{format(discountAmount)}</span></div>}
          {Number(quote.shippingAmount) > 0 && <div className="flex justify-between gap-4 text-sm text-slate-600"><span>Envío</span><span>{format(Number(quote.shippingAmount))}</span></div>}
          <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-xl font-black"><span>Total con envío</span><span className="text-emerald-700">{format(quote.total)}</span></div>
        </div>
      </section>

      {quote.notes?.trim() && <section className="border-t border-slate-100 px-5 py-5 sm:px-8">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Condiciones para el cliente</h2>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{quote.notes}</p>
      </section>}
    </article>
  );
}
