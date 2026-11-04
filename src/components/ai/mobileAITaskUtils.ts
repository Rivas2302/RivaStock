import type { AIJob } from '../../lib/aiBridge';

export type MobileAITaskFilter = 'all' | 'inProgress' | 'failed' | 'review';

function productNameFromInput(input: string): string | null {
  try {
    const value = JSON.parse(input) as { product?: { name?: unknown } };
    return typeof value.product?.name === 'string' && value.product.name.trim()
      ? value.product.name.trim()
      : null;
  } catch {
    return null;
  }
}

function firstWords(value: string, maxWords = 7): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').slice(0, maxWords);
  const result = words.join(' ');
  return cleaned.split(' ').length > maxWords ? `${result}…` : result;
}

export function mobileAITaskTitle(job: AIJob, documentTitle?: string | null): string {
  if (job.task_type === 'knowledge_organize') return `Organizar: ${documentTitle || 'Documento'}`;
  if (job.task_type === 'fb_copywriting') return `Publicación: ${productNameFromInput(job.input) ?? firstWords(job.input, 5)}`;
  if (job.task_type === 'fb_photo_review') return `Revisión de fotos: ${productNameFromInput(job.input) ?? 'Producto'}`;
  return `Texto: ${firstWords(job.input)}`;
}

export function isMobileAITaskInProgress(job: AIJob): boolean {
  return job.status === 'pending' || job.status === 'processing';
}

export function filterMobileAITasks(
  jobs: AIJob[],
  filter: MobileAITaskFilter,
  reviewJobIds: ReadonlySet<string>,
): AIJob[] {
  if (filter === 'inProgress') return jobs.filter(isMobileAITaskInProgress);
  if (filter === 'failed') return jobs.filter((job) => job.status === 'failed');
  if (filter === 'review') return jobs.filter((job) => reviewJobIds.has(job.id));
  return jobs;
}

function dateKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function groupMobileAITasks(jobs: AIJob[], now = new Date()): Array<{ label: string; jobs: AIJob[] }> {
  const today = dateKey(now.toISOString());
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dateKey(yesterdayDate.toISOString());
  const labels = new Map<string, string>();
  const groups = new Map<string, AIJob[]>();

  for (const job of [...jobs].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))) {
    const key = dateKey(job.created_at);
    if (!labels.has(key)) {
      const date = new Date(job.created_at);
      const label = key === today ? 'Hoy'
        : key === yesterday ? 'Ayer'
          : new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
      labels.set(key, label);
      groups.set(key, []);
    }
    groups.get(key)?.push(job);
  }

  return [...groups.entries()].map(([key, groupedJobs]) => ({ label: labels.get(key) ?? key, jobs: groupedJobs }));
}

export function mobileAITaskTime(value: string, now = new Date()): string {
  if (dateKey(value) === dateKey(now.toISOString())) {
    return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(new Date(value));
}
