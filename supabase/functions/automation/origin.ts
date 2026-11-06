const ALLOWED_ORIGINS = new Set([
  'https://rivastock.vercel.app',
  'http://localhost:5173',
  'chrome-extension://iplfoimfiigmoaihampblmibohekbbkj',
]);

export function isAllowedAutomationOrigin(origin: string | null): boolean {
  return !origin || ALLOWED_ORIGINS.has(origin);
}
