import { Node, mergeAttributes } from '@tiptap/core';

export type CalloutVariant = 'warning' | 'tip' | 'info' | 'danger';

export const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  warning: 'Advertencia',
  tip: 'Recomendación',
  info: 'Importante',
  danger: 'Peligro',
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (variant: CalloutVariant) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (element) => (element.getAttribute('data-variant') as CalloutVariant) ?? 'info',
        renderHTML: (attributes) => ({ 'data-variant': attributes.variant }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'kb-callout' }), 0];
  },
  addCommands() {
    return {
      setCallout: (variant) => ({ commands }) => commands.wrapIn(this.name, { variant }),
      unsetCallout: () => ({ commands }) => commands.lift(this.name),
    };
  },
});
