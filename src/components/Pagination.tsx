interface Props {
  page: number;
  pages: number;
  start: number;
  end: number;
  total: number;
  setPage: (page: number) => void;
}

export default function Pagination({ page, pages, start, end, total, setPage }: Props) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-slate-600 dark:text-slate-300">
      <span aria-live="polite">{start + 1}–{end} de {total}</span>
      <div className="flex items-center gap-3">
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40 dark:border-slate-600">Anterior</button>
        <span>{page + 1} / {pages}</span>
        <button type="button" disabled={page + 1 === pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40 dark:border-slate-600">Siguiente</button>
      </div>
    </nav>
  );
}
