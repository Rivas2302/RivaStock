export interface IdempotencyIntent {
  fingerprint: string;
  key: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function resolveIdempotencyIntent(
  prefix: string,
  payload: unknown,
  current: IdempotencyIntent | null,
  generateId: () => string = () => crypto.randomUUID(),
): IdempotencyIntent {
  const fingerprint = JSON.stringify(canonicalize(payload));
  if (current?.fingerprint === fingerprint) return current;
  return { fingerprint, key: `${prefix}:${generateId()}` };
}
