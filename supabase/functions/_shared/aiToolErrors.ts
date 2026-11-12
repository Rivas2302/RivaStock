const GENERIC_TOOL_ERROR = 'No se pudo completar la consulta.';

export function safeAiToolError(code: unknown, message: unknown): string {
  if (code !== 'AI001' || typeof message !== 'string' || !message.trim()) return GENERIC_TOOL_ERROR;
  return message.slice(0, 400);
}
