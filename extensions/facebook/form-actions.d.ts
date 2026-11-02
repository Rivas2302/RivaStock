export interface SupervisorControl {
  index: number;
  role: string;
  name: string;
  text?: string;
  state?: { disabled?: boolean };
}

export interface SupervisorDomSummary {
  scope: 'dialog' | 'form' | 'page';
  controls: SupervisorControl[];
  headings?: string[];
  alerts?: string[];
}

export function domSummary(root?: Element | null): SupervisorDomSummary;
export function validateSupervisorDecision(value: unknown, dom: SupervisorDomSummary, intent: Record<string, unknown>): boolean;
