export type CalloutVariant = 'warning' | 'tip' | 'info' | 'danger';

export const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  warning: 'Advertencia',
  tip: 'Recomendación',
  info: 'Importante',
  danger: 'Peligro',
};
