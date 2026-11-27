export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Use the selection-based fallback when clipboard permissions are unavailable.
    }
  }

  if (typeof document === 'undefined') return false;
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  let copied = false;
  try {
    input.select();
    input.setSelectionRange(0, input.value.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    input.remove();
  }
  return copied;
}
