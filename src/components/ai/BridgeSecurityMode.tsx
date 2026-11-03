import type { CodexSandboxMode } from '../../lib/aiBridge';

export default function BridgeSecurityMode({ mode }: { mode: CodexSandboxMode }) {
  const label = mode === 'danger-full-access'
    ? 'completo'
    : mode === 'workspace-write'
      ? 'protegido (escritura limitada al espacio de trabajo)'
      : 'protegido (solo lectura)';
  return <p className="mt-2 text-xs text-[var(--ink-muted)]">Modo de seguridad de la IA: {label}</p>;
}
