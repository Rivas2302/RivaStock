import { safeFacebookGroupUrl, safeFacebookPostUrl, type FacebookDelivery } from '../../lib/facebookPublications';

const groupStatusLabels: Record<string, string> = {
  pending: 'Pendiente',
  selected: 'Seleccionado',
  not_found_in_list: 'No apareció en la lista',
  published: 'Publicado',
  pending_approval: 'Pendiente de aprobación',
  not_approved: 'No aprobado',
  unknown: 'Resultado sin verificar',
};

export default function FacebookGroupResults({ delivery }: { delivery: FacebookDelivery }) {
  if (delivery.destination.mechanism !== 'marketplace_groups') return null;

  return <section aria-label="Resultados por grupo" className="space-y-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
    <h5 className="text-xs font-bold">Anuncio de Marketplace compartido</h5>
    {delivery.target_groups?.length ? <ul className="space-y-2">
      {delivery.target_groups.map((group) => {
        const result = delivery.fb_delivery_group_results?.find((item) => item.group_id === group.group_id);
        const publicationUrl = safeFacebookPostUrl(result?.url);
        const groupUrl = safeFacebookGroupUrl(group.url);
        const status = result ? groupStatusLabels[result.status] ?? 'Resultado sin verificar' : groupStatusLabels.pending;
        return <li key={group.group_id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-t border-slate-100 pt-2 first:border-0 first:pt-0 dark:border-slate-700">
          <div className="min-w-0">
            <p className="break-words text-xs font-semibold">{group.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{status}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 text-xs">
            {publicationUrl&&<a className="font-semibold text-indigo-600 underline dark:text-indigo-300" href={publicationUrl} target="_blank" rel="noopener noreferrer">Ver publicación del grupo</a>}
            {groupUrl&&<a className="font-semibold text-slate-600 underline dark:text-slate-300" href={groupUrl} target="_blank" rel="noopener noreferrer">Abrir grupo</a>}
          </div>
        </li>;
      })}
    </ul> : <p className="text-xs text-slate-500">Todavía no hay grupos guardados para esta entrega.</p>}
  </section>;
}
