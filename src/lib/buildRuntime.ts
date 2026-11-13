export interface BuildVersion {
  buildId: string;
}

export type DirtyCheck = () => boolean;

const dirtyChecks = new Map<string, DirtyCheck>();
const beforeReloadHandlers = new Set<() => void>();
const interactionBaselines = new WeakMap<Element, string>();

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('input, textarea, select, [contenteditable="true"]') && !interactionBaselines.has(target)) {
      interactionBaselines.set(target, readControlValue(target));
    }
  }, true);
}

function readControlValue(control: HTMLElement): string {
  if (control instanceof HTMLInputElement) {
    if (['checkbox', 'radio'].includes(control.type)) return `${control.checked}`;
    if (control.type === 'file') return `${control.files?.length ?? 0}`;
    return control.value;
  }
  if (control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
    if (control instanceof HTMLSelectElement && control.multiple) {
      return Array.from(control.selectedOptions).map((option) => option.value).join('\u0000');
    }
    return control.value;
  }
  return control.textContent ?? '';
}

export async function fetchBuildVersion(fetcher: typeof fetch = fetch): Promise<BuildVersion | null> {
  try {
    const response = await fetcher(`/version.json?check=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) return null;
    const value = await response.json() as Partial<BuildVersion>;
    return typeof value.buildId === 'string' && value.buildId.length > 0
      ? { buildId: value.buildId }
      : null;
  } catch {
    return null;
  }
}

export function registerDirtyCheck(key: string, check: DirtyCheck): () => void {
  dirtyChecks.set(key, check);
  return () => {
    if (dirtyChecks.get(key) === check) dirtyChecks.delete(key);
  };
}

function hasChangedFormControls(): boolean {
  if (typeof document === 'undefined') return false;
  const controls = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select',
  );
  for (const control of controls) {
    if (control.disabled) continue;
    const interactionBaseline = interactionBaselines.get(control);
    if (interactionBaseline !== undefined) {
      if (readControlValue(control) !== interactionBaseline) return true;
      continue;
    }
    if (control instanceof HTMLInputElement) {
      if (control.type === 'hidden' || ['button', 'submit', 'reset'].includes(control.type)) continue;
      if (control.type === 'file' && control.files?.length) return true;
      if (['checkbox', 'radio'].includes(control.type) && control.checked !== control.defaultChecked) return true;
      if (control.value !== control.defaultValue) return true;
    } else if (control instanceof HTMLTextAreaElement) {
      if (control.value !== control.defaultValue) return true;
    } else if (control.multiple) {
      if (Array.from(control.options).some((option) => option.selected !== option.defaultSelected)) return true;
    } else {
      const defaultIndex = Array.from(control.options).findIndex((option) => option.defaultSelected);
      if (defaultIndex >= 0 && control.selectedIndex !== defaultIndex) return true;
    }
  }
  return Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"]'))
    .some((element) => {
      const baseline = interactionBaselines.get(element) ?? element.dataset.initialValue;
      return baseline !== undefined && readControlValue(element) !== baseline;
    });
}

export function hasUnsavedAppChanges(): boolean {
  return hasChangedFormControls() || Array.from(dirtyChecks.values()).some((check) => {
    try { return check(); } catch { return true; }
  });
}

export function registerBeforeAppReload(handler: () => void): () => void {
  beforeReloadHandlers.add(handler);
  return () => beforeReloadHandlers.delete(handler);
}

export function persistAppDrafts(): void {
  for (const handler of beforeReloadHandlers) {
    try { handler(); } catch { /* A draft failure must not block recovery. */ }
  }
}

export function prepareAppReload(): boolean {
  if (hasUnsavedAppChanges()) return false;
  persistAppDrafts();
  return true;
}

export function reloadCurrentPage(): boolean {
  if (!prepareAppReload()) return false;
  window.location.reload();
  return true;
}
