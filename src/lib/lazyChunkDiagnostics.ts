import { supabase } from './supabase';

export interface LazyChunkDiagnostic {
  moduleId: string;
  clientBuildId: string;
  currentBuildId: string | null;
  recovered: boolean;
  failureKind: 'network' | 'preload' | 'offline';
}

export function sanitizeLazyChunkDiagnostic(input: LazyChunkDiagnostic): LazyChunkDiagnostic {
  return {
    moduleId: /^[a-z0-9_./-]{1,120}$/i.test(input.moduleId) ? input.moduleId : 'unknown',
    clientBuildId: /^[a-z0-9._-]{1,80}$/i.test(input.clientBuildId) ? input.clientBuildId : 'unknown',
    currentBuildId: input.currentBuildId === null ? null : /^[a-z0-9._-]{1,80}$/i.test(input.currentBuildId) ? input.currentBuildId : 'unknown',
    recovered: Boolean(input.recovered),
    failureKind: input.failureKind === 'preload' || input.failureKind === 'offline' ? input.failureKind : 'network',
  };
}

export function reportLazyChunkFailure(input: LazyChunkDiagnostic): Promise<void> {
  const diagnostic = sanitizeLazyChunkDiagnostic(input);
  console.warn('[lazy-chunk]', diagnostic);
  return supabase.functions.invoke('client-runtime-diagnostics', {
    body: {
      event: 'lazy_chunk_failure',
      moduleId: diagnostic.moduleId,
      clientBuildId: diagnostic.clientBuildId,
      currentBuildId: diagnostic.currentBuildId,
      recovered: diagnostic.recovered,
      failureKind: diagnostic.failureKind,
    },
  }).then(() => undefined).catch(() => undefined);
}
