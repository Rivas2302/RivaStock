import Image from '@tiptap/extension-image';

export const KbImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetPath: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-asset-path'),
        renderHTML: (attributes) => (attributes.assetPath ? { 'data-asset-path': attributes.assetPath } : {}),
      },
    };
  },
}).configure({ inline: false, allowBase64: false });
