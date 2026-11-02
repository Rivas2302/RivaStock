const EXPECTED_SAMPLE_OFFSETS = [0, 3000, 8000] as const;
const OBSERVATION_KEYS = ['sample_offset_ms', 'elapsed_ms', 'capture_status', 'trace_seq', 'alerts', 'new_urls'];

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: RecordValue, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

function isSafeFacebookUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 300 || /[?#\u0000-\u0020]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && /(^|\.)facebook\.com$/i.test(url.hostname)
      && !url.username && !url.password && !url.port
      && !url.search && !url.hash
      && `${url.origin}${url.pathname}` === value;
  } catch {
    return false;
  }
}

export function isPostSubmitObservations(value: unknown): value is {
  post_submit_observations: Array<{
    sample_offset_ms: number;
    elapsed_ms: number;
    capture_status: 'captured' | 'unavailable';
    trace_seq: number | null;
    alerts: string[];
    new_urls: string[];
  }>;
} {
  if (!isRecord(value) || !hasExactKeys(value, ['post_submit_observations'])) return false;
  const observations = value.post_submit_observations;
  if (!Array.isArray(observations) || observations.length !== EXPECTED_SAMPLE_OFFSETS.length
    || new TextEncoder().encode(JSON.stringify(value)).byteLength > 8192) return false;

  return observations.every((item, index) => {
    if (!isRecord(item) || !hasExactKeys(item, OBSERVATION_KEYS)
      || item.sample_offset_ms !== EXPECTED_SAMPLE_OFFSETS[index]
      || !Number.isSafeInteger(item.elapsed_ms) || (item.elapsed_ms as number) < 0 || (item.elapsed_ms as number) > 120000
      || !['captured', 'unavailable'].includes(String(item.capture_status))) return false;
    if (item.trace_seq !== null && (!Number.isSafeInteger(item.trace_seq) || (item.trace_seq as number) < 1 || (item.trace_seq as number) > 10000)) return false;
    if (item.capture_status === 'captured' && item.trace_seq === null) return false;
    if (item.capture_status === 'unavailable' && item.trace_seq !== null) return false;
    if (!Array.isArray(item.alerts) || item.alerts.length > 3
      || item.alerts.some(alert => typeof alert !== 'string' || alert.trim().length === 0 || alert.length > 160)) return false;
    if (!Array.isArray(item.new_urls) || item.new_urls.length > 5
      || item.new_urls.some(url => !isSafeFacebookUrl(url))) return false;
    return new Set(item.new_urls).size === item.new_urls.length;
  });
}
