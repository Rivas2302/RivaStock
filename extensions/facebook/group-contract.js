// Inspected in an authenticated session on 2026-10-14. This group offers
// ordinary text/photo posts, not a structured Marketplace sale composer.
export const inspectedFacebookGroup = {
  name: 'Vende de todo - Gral. Pico',
  url: 'https://www.facebook.com/groups/PicoVendedeTodo',
  canonicalId: '710102875717376',
  mechanism: 'group_direct',
  composer: 'text_photos',
  approvalVerified: false,
};

// Read-only. Scope to the dialog containing the observed editor so Messenger
// and comment inputs cannot be confused with a public group post.
export function inspectGroupComposer() {
  const editors = Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"][aria-label="Crea una publicación pública..."]'));
  const editor = editors.length === 1 ? editors[0] : null;
  const dialog = editor?.closest('[role="dialog"]');
  const text = element => (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  const publish = dialog ? Array.from(dialog.querySelectorAll('[role="button"],button')).filter(element => text(element) === 'Publicar') : [];
  const photoInputs = dialog ? Array.from(dialog.querySelectorAll('input[type="file"][multiple]')).filter(element => (element.getAttribute('accept') ?? '').split(',').includes('image/*')) : [];
  return {
    compatibleTextComposer: editors.length === 1 && Boolean(dialog) && publish.length === 1,
    editorCount: editors.length,
    publishCount: publish.length,
    publishEnabled: publish.length === 1 && publish[0].getAttribute('aria-disabled') !== 'true' && !publish[0].hasAttribute('disabled'),
    // Two identical image inputs were observed. Do not pick one arbitrarily;
    // actual upload behavior must distinguish them before enabling execution.
    photoInputCount: photoInputs.length,
    uploadVerified: false,
    approvalVerified: false,
  };
}
