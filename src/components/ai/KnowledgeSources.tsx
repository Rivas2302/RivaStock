import { Link } from 'react-router-dom';
import type { KnowledgeJobSource } from '../../lib/knowledge/api';

export default function KnowledgeSources({ sources }: { sources: KnowledgeJobSource[] }) {
  if (!sources.length) return null;
  return <div className="mt-3 border-t border-[var(--line)] pt-2">
    <p className="mb-2 text-[11px] font-bold text-[var(--ink-muted)]">Fuentes</p>
    <ul className="flex flex-wrap gap-1.5">
      {sources.map((source) => {
        const pages = source.page_from === null && source.page_to === null ? ''
          : source.page_from !== null && source.page_to !== null && source.page_from !== source.page_to
            ? ` · págs. ${source.page_from}–${source.page_to}`
            : ` · pág. ${source.page_from ?? source.page_to}`;
        const label = `${source.label} · ${source.title}${source.section_path ? ` · ${source.section_path}` : ''}${pages}${source.deleted ? ' (eliminado)' : ''}`;
        return <li key={`${source.job_id}-${source.rank}`}>
          {source.deleted
            ? <span className="inline-flex max-w-full rounded-lg border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--ink-muted)]">{label}</span>
            : <Link to={`/ia/conocimientos/doc/${source.document_id}`} className="inline-flex max-w-full rounded-lg border border-[var(--line)] px-2 py-1 text-[11px] font-semibold text-[var(--brand)] hover:bg-[var(--brand-soft)]">{label}</Link>}
        </li>;
      })}
    </ul>
  </div>;
}
