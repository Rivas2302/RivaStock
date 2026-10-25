/** Removes values that could expose local credentials, paths, or signed file URLs. */
export function reportError(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9._-]{16,})/g, '[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/file:\/\/[^\s"'<>]+/gi, '[path redacted]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|\/(?:Users|home|tmp|var|mnt|opt|workspace|root|app)\/)[^\s"'<>]*/gi, '[path redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
}
