import { describe, expect, it } from 'vitest';
import { isPostSubmitObservations } from '../../supabase/functions/_shared/facebookPostSubmit.ts';
import { collectPostSubmitObservations } from '../../extensions/facebook/post-submit.js';

const validObservations = {
  post_submit_observations: [0, 3000, 8000].map((sample_offset_ms, index) => ({
    sample_offset_ms,
    elapsed_ms: sample_offset_ms,
    capture_status: 'captured',
    trace_seq: index + 1,
    alerts: index === 0 ? ['Tu publicación se creó'] : [],
    new_urls: index === 0 ? ['https://www.facebook.com/marketplace/item/12345'] : [],
  })),
};

describe('post-submit observation contract', () => {
  it('accepts the fixed samples and bounded Facebook evidence fields', () => {
    expect(isPostSubmitObservations(validObservations)).toBe(true);
  });

  it('rejects missing samples, reordered offsets, external URLs, and unlinked captures', () => {
    expect(isPostSubmitObservations({ post_submit_observations: validObservations.post_submit_observations.slice(0, 2) })).toBe(false);
    expect(isPostSubmitObservations({ post_submit_observations: [validObservations.post_submit_observations[1], validObservations.post_submit_observations[0], validObservations.post_submit_observations[2]] })).toBe(false);
    const external = structuredClone(validObservations);
    external.post_submit_observations[0].new_urls = ['https://example.com/marketplace/item/12345'];
    expect(isPostSubmitObservations(external)).toBe(false);
    const unlinked = structuredClone(validObservations);
    unlinked.post_submit_observations[0].trace_seq = null;
    expect(isPostSubmitObservations(unlinked)).toBe(false);
  });

  it('captures at 0, 3, and 8 seconds and persists each sample before continuing', async () => {
    let current = 0;
    const samples: number[] = [];
    const persisted: number[] = [];
    const observations = await collectPostSubmitObservations({
      startedAt: 0,
      now: () => current,
      sleep: async milliseconds => { current += milliseconds; },
      sample: async ({ sampleOffsetMs }) => {
        samples.push(sampleOffsetMs);
        current += 10;
        return { capture_status: 'captured', trace_seq: samples.length, alerts: [], new_urls: [] };
      },
      persist: async value => { persisted.push(value.length); },
    });

    expect(samples).toEqual([0, 3000, 8000]);
    expect(persisted).toEqual([1, 2, 3]);
    expect(observations.map(item => item.elapsed_ms)).toEqual([0, 3000, 8000]);
  });

  it('records an unavailable sample if the Facebook tab cannot be inspected', async () => {
    const observations = await collectPostSubmitObservations({
      startedAt: 0,
      now: () => 0,
      sleep: async () => {},
      sample: async () => { throw new Error('tab lost'); },
      persist: async () => {},
    });

    expect(observations).toHaveLength(3);
    expect(observations.every(item => item.capture_status === 'unavailable' && item.trace_seq === null)).toBe(true);
  });
});
