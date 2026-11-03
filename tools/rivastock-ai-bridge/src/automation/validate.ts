export type SupervisorAction = 'click' | 'type' | 'select_option' | 'scroll_container' | 'wait' | 'reload' | 'skip_destination' | 'abort';

export interface SupervisorControl {
  index: number;
  role: string;
  name: string;
  text?: string;
  links?: string[];
  type?: string;
  placeholder?: string;
  state?: { disabled?: boolean };
}

export interface SupervisorDomSummary {
  scope: 'dialog' | 'form' | 'page';
  controls: SupervisorControl[];
  headings?: string[];
  alerts?: string[];
}

export interface SupervisorIntent {
  target?: { element_index: number; role: string; name: string };
  [key: string]: unknown;
}

export interface SupervisorDecision {
  action: SupervisorAction;
  element_index?: number;
  text?: string;
  wait_ms?: number;
  confidence: number;
  observation: string;
  reason: string;
}

export type SupervisedResultState = 'published' | 'pending_approval' | 'not_approved' | 'unknown';

export interface SupervisedResultAssessment {
  found: boolean;
  element_index: number | null;
  state: SupervisedResultState;
  observation: string;
  confidence: number;
}

export interface WarningClassification {
  warning:boolean;
  category:'none'|'checkpoint'|'rate_limit'|'restriction'|'unusual_activity'|'uncertain';
  observation:string;
  confidence:number;
}

const ACTIONS = new Set<SupervisorAction>(['click', 'type', 'select_option', 'scroll_container', 'wait', 'reload', 'skip_destination', 'abort']);
const ELEMENT_ACTIONS = new Set<SupervisorAction>(['click', 'type', 'select_option', 'scroll_container']);
const BLOCKED = /\b(?:publicar(?: ahora)?|compartir ahora|publish(?: now)?|share now|send now|enviar ahora|cerrar sesi[oó]n|log\s*out|sign\s*out|settings|configuraci[oó]n|account settings)\b/i;

export function validateSupervisorDecision(value: unknown, dom: SupervisorDomSummary, intent: SupervisorIntent): value is SupervisorDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const decision = value as Record<string, unknown>;
  if (Object.keys(decision).some(key => !['action', 'element_index', 'text', 'wait_ms', 'confidence', 'observation', 'reason'].includes(key))) return false;
  if (typeof decision.action !== 'string' || !ACTIONS.has(decision.action as SupervisorAction)) return false;
  if (typeof decision.confidence !== 'number' || !Number.isFinite(decision.confidence) || decision.confidence < 0.6 || decision.confidence > 1) return false;
  if (typeof decision.observation !== 'string' || !decision.observation.trim() || decision.observation.length > 300 || typeof decision.reason !== 'string' || !decision.reason.trim() || decision.reason.length > 300) return false;

  const action = decision.action as SupervisorAction;
  if (ELEMENT_ACTIONS.has(action)) {
    if (!Number.isInteger(decision.element_index) || (decision.element_index as number) < 0 || (decision.element_index as number) > 79) return false;
    if (dom.scope !== 'dialog' && dom.scope !== 'form') return false;
    const control = dom.controls.find(candidate => candidate.index === decision.element_index);
    if (!control || control.state?.disabled === true) return false;
    if (BLOCKED.test(`${control.name} ${control.text ?? ''}`)) return false;
    if (action === 'click' && /^(?:submit|formsubmit)$/i.test(control.role)) return false;
    if (action === 'type' || action === 'select_option') {
      const target = intent.target;
      if (!target || !Number.isInteger(target.element_index) || target.element_index !== control.index || target.role !== control.role || target.name !== control.name || !target.name.trim()) return false;
      if (typeof decision.text !== 'string' || decision.text.length > 200) return false;
      if (action === 'type' && !['input', 'textarea', 'textbox'].includes(control.role)) return false;
      if (action === 'select_option' && !['select', 'combobox'].includes(control.role)) return false;
    } else if ('text' in decision) return false;
  } else if ('element_index' in decision || 'text' in decision) return false;

  if (action === 'wait') {
    if (!Number.isInteger(decision.wait_ms) || (decision.wait_ms as number) < 500 || (decision.wait_ms as number) > 10000) return false;
  } else if ('wait_ms' in decision) return false;
  return true;
}

export function validateSupervisedResultAssessment(
  value: unknown,
  dom: SupervisorDomSummary,
): value is SupervisedResultAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const assessment = value as Record<string, unknown>;
  if (Object.keys(assessment).length !== 5
    || Object.keys(assessment).some(key => !['found', 'element_index', 'state', 'observation', 'confidence'].includes(key))
    || typeof assessment.found !== 'boolean'
    || !['published', 'pending_approval', 'not_approved', 'unknown'].includes(String(assessment.state))
    || typeof assessment.observation !== 'string' || !assessment.observation.trim() || assessment.observation.length > 300
    || typeof assessment.confidence !== 'number' || !Number.isFinite(assessment.confidence)
    || assessment.confidence < 0 || assessment.confidence > 1) return false;

  if (!assessment.found) return assessment.element_index === null && assessment.state === 'unknown';
  if (!Number.isSafeInteger(assessment.element_index) || (assessment.element_index as number) < 0 || (assessment.element_index as number) > 79
    || dom.scope !== 'page') return false;
  const candidate = dom.controls.find(control => control.index === assessment.element_index);
  return candidate?.role === 'article' && Array.isArray(candidate.links) && candidate.links.length > 0;
}

export function parseSupervisorOutput(
  output: string,
  dom: SupervisorDomSummary,
  intent: SupervisorIntent,
  kind: 'recover_step' | 'verify_result' | 'review_content' | 'review_photos' | 'classify_warning' = 'recover_step',
): { decision: SupervisorDecision | SupervisedResultAssessment | WarningClassification } | { error: string } {
  const trimmed = output.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const json = fenced?.[1] ?? trimmed;
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch { return { error: 'La respuesta no era un objeto JSON válido.' }; }
  if (kind === 'verify_result') {
    if (validateSupervisedResultAssessment(parsed, dom)) return { decision: parsed };
  } else if (kind === 'classify_warning') {
    if (validateWarningClassification(parsed)) return { decision: parsed };
  } else if (validateSupervisorDecision(parsed, dom, intent)) {
    return { decision: parsed };
  }
  return { error: 'La respuesta no cumple el contrato de decisión supervisada.' };
}

export function validateWarningClassification(value:unknown):value is WarningClassification{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const classification=value as Record<string,unknown>;
  if(Object.keys(classification).length!==4||Object.keys(classification).some(key=>!['warning','category','observation','confidence'].includes(key)))return false;
  if(typeof classification.warning!=='boolean'||!['none','checkpoint','rate_limit','restriction','unusual_activity','uncertain'].includes(String(classification.category))
    ||typeof classification.observation!=='string'||!classification.observation.trim()||classification.observation.length>300
    ||typeof classification.confidence!=='number'||!Number.isFinite(classification.confidence)||classification.confidence<0||classification.confidence>1)return false;
  return classification.warning?classification.category!=='none':classification.category==='none';
}
