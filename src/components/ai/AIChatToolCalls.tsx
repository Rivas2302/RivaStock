import type { AIChatToolCall } from '../../lib/aiBridge';

const TOOL_LABELS: Record<string, { label: string; group: string }> = {
  negocio_resumen: { label: 'Resumen del negocio', group: 'RivaStock' },
  productos_buscar: { label: 'Búsqueda de productos', group: 'productos' },
  producto_ver: { label: 'Ficha de producto', group: 'productos' },
  categorias_listar: { label: 'Categorías', group: 'productos' },
  ventas_resumen: { label: 'Resumen de ventas', group: 'ventas' },
  ventas_listar: { label: 'Lista de ventas', group: 'ventas' },
  productos_mas_vendidos: { label: 'Productos más vendidos', group: 'ventas' },
  pedidos_listar: { label: 'Lista de pedidos', group: 'pedidos' },
  pedido_ver: { label: 'Detalle de pedido', group: 'pedidos' },
  clientes_buscar: { label: 'Búsqueda de clientes', group: 'clientes' },
  catalogo_config: { label: 'Configuración del catálogo', group: 'RivaStock' },
  lista_revendedores_buscar: { label: 'Lista de revendedores', group: 'revendedores' },
  stock_movimientos: { label: 'Movimientos de stock', group: 'productos' },
  conocimiento_buscar: { label: 'Búsqueda en Conocimientos', group: 'Conocimientos' },
};

export default function AIChatToolCalls({ calls }: { calls: AIChatToolCall[] }) {
  if (calls.length === 0) return null;
  const grouped = new Map<string, number>();
  for (const call of calls) {
    if (!call.ok) continue;
    const label = TOOL_LABELS[call.tool]?.group ?? 'RivaStock';
    grouped.set(label, (grouped.get(label) ?? 0) + (call.row_count ?? 0));
  }
  const summary = grouped.size
    ? [...grouped].map(([label, count]) => `${label} (${count})`).join(', ')
    : `${calls.length} ${calls.length === 1 ? 'consulta' : 'consultas'}`;
  return <details className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--ink-muted)]">
    <summary className="cursor-pointer select-none font-semibold">Consultó: {summary}</summary>
    <ul className="mt-2 space-y-1.5">
      {calls.map((call, index) => {
        const label = TOOL_LABELS[call.tool]?.label ?? 'Consulta de RivaStock';
        return <li key={`${call.tool}-${call.created_at}-${index}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span>{label}</span>
          <span className={call.ok ? '' : 'text-[var(--danger-ink)]'}>
            {call.ok ? `${call.row_count ?? 0} ${call.row_count === 1 ? 'resultado' : 'resultados'}` : call.error ?? 'No se pudo completar'}
          </span>
        </li>;
      })}
    </ul>
  </details>;
}
