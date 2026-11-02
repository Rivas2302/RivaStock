export interface AutomationTrace {
  id: string;
  delivery_id: string | null;
  attempt_id: string | null;
  mode: 'real' | 'rehearsal';
  mechanism: string;
  extension_version: string;
  started_at: string;
  finished_at: string | null;
  outcome: string | null;
  summary: Record<string, unknown>;
}

export interface AutomationTraceStep {
  id: string;
  trace_id: string;
  seq: number;
  step: string;
  status: 'ok' | 'retry' | 'failed' | 'supervised';
  elapsed_ms: number;
  dom_summary: Record<string, unknown>;
  screenshot_path: string | null;
  note: string | null;
  created_at: string;
}

export interface AutomationTraceScreenshot {
  seq: number;
  url: string;
}

const stepStatusLabels: Record<AutomationTraceStep['status'], string> = {
  ok: 'Correcto',
  retry: 'Reintento',
  failed: 'Falló',
  supervised: 'Asistido por IA',
};

const outcomeLabels: Record<string, string> = {
  completed: 'Completada',
  aborted: 'Interrumpida',
  failed: 'Fallida',
  rehearsal_ok: 'Ensayo completado',
};

export function traceStepLabel(step: string): string {
  const words = step.replace(/[._-]+/g, ' ').trim();
  return words ? words[0].toLocaleUpperCase('es') + words.slice(1) : 'Paso';
}

export function traceStepStatusLabel(status: AutomationTraceStep['status']): string {
  return stepStatusLabels[status] ?? 'Estado desconocido';
}

export function traceOutcomeLabel(outcome: string | null): string {
  return outcome ? outcomeLabels[outcome] ?? outcome : 'En curso';
}

export function traceStepDecision(step: AutomationTraceStep): unknown {
  return step.dom_summary.ai_decision ?? step.dom_summary.decision ?? null;
}
