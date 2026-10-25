import type { KnowledgeFormat, KnowledgeIndexStatus, KnowledgeStatus } from './types';

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  draft: 'Borrador',
  in_review: 'Pendiente de revisión',
  published: 'Publicado',
  archived: 'Archivado',
  deleting: 'Eliminando',
};

export const KNOWLEDGE_STATUS_CLASSES: Record<KnowledgeStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  in_review: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  archived: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  deleting: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
};

export const KNOWLEDGE_INDEX_STATUS_LABELS: Record<KnowledgeIndexStatus, string> = {
  not_indexed: 'Sin indexar',
  queued: 'En cola',
  processing: 'Procesando',
  ready: 'Disponible para la IA',
  error: 'Error',
  excluded: 'Excluido de la IA',
};

export const KNOWLEDGE_INDEX_STATUS_CLASSES: Record<KnowledgeIndexStatus, string> = {
  not_indexed: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  queued: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  processing: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  error: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  excluded: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

export const KNOWLEDGE_FORMAT_LABELS: Record<KnowledgeFormat, string> = {
  pdf: 'PDF',
  docx: 'Word',
  txt: 'Texto',
  md: 'Markdown',
  image: 'Imagen',
  editor: 'Documento',
};

export const KNOWLEDGE_FORMAT_CLASSES: Record<KnowledgeFormat, string> = {
  pdf: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  docx: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  txt: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  md: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  image: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  editor: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
