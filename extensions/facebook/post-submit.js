export const POST_SUBMIT_SAMPLE_OFFSETS = Object.freeze([0, 3000, 8000]);

export async function collectPostSubmitObservations({
  sample,
  persist,
  startedAt,
  now = () => performance.now(),
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
}) {
  if (typeof sample !== 'function' || typeof persist !== 'function' || !Number.isFinite(startedAt)) {
    throw new TypeError('Post-submit observation dependencies are invalid.');
  }

  const observations = [];
  for (const sampleOffsetMs of POST_SUBMIT_SAMPLE_OFFSETS) {
    const remaining = startedAt + sampleOffsetMs - now();
    if (remaining > 0) await sleep(remaining);

    const elapsedMs = Math.max(0, Math.round(now() - startedAt));
    let captured = null;
    try {
      captured = await sample({ sampleOffsetMs, elapsedMs });
    } catch {
      captured = null;
    }

    observations.push({
      sample_offset_ms: sampleOffsetMs,
      elapsed_ms: Math.min(elapsedMs, 120000),
      capture_status: captured?.capture_status === 'captured' && Number.isSafeInteger(captured?.trace_seq)
        ? 'captured' : 'unavailable',
      trace_seq: Number.isSafeInteger(captured?.trace_seq) ? captured.trace_seq : null,
      alerts: Array.isArray(captured?.alerts) ? captured.alerts.slice(0, 3) : [],
      new_urls: Array.isArray(captured?.new_urls) ? captured.new_urls.slice(0, 5) : [],
    });
    await persist(observations.map(item => ({ ...item, alerts: [...item.alerts], new_urls: [...item.new_urls] })));
  }

  return observations;
}
