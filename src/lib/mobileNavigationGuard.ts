type PopNavigationGuard = (event: PopStateEvent) => boolean;

const guards = new Set<PopNavigationGuard>();

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => {
    for (const guard of guards) {
      if (!guard(event)) continue;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }, true);
}

export function registerPopNavigationGuard(guard: PopNavigationGuard): () => void {
  guards.add(guard);
  return () => guards.delete(guard);
}
