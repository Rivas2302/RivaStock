import { describe, expect, it } from 'vitest';
import { isResultListUrl, isSupervisedResultAssessment, resolveSupervisedResult } from '../../extensions/facebook/result-verification.js';

const marketplaceJob = {
  content: { title: 'Perfume floral', price: 43000 },
  destination: { mechanism: 'marketplace', url: 'https://www.facebook.com/marketplace/create/item' },
};
const marketplaceSnapshot = {
  complete: true,
  items: [{ id: '987654321', title: 'Perfume floral', text: 'Perfume floral · $43.000', state: 'published',
    authorMatches: true, titleMatches: true, links: ['https://www.facebook.com/marketplace/item/987654321/'] }],
  dom_summary: { scope: 'page', controls: [{ index: 0, role: 'article', links: ['https://www.facebook.com/marketplace/item/987654321/'] }] },
};
const published = { found: true, element_index: 0, state: 'published', observation: 'La tarjeta coincide.', confidence: 0.93 };

describe('Facebook supervised result verification', () => {
  it('allows trace screenshots only from the exact owner result list for the active destination', () => {
    const groupJob = { ...marketplaceJob, destination: { mechanism: 'group_direct', url: 'https://www.facebook.com/groups/12345' } };
    expect(isResultListUrl(groupJob, 'https://www.facebook.com/groups/12345/my_posted_content')).toBe(true);
    expect(isResultListUrl(groupJob, 'https://www.facebook.com/groups/98765/my_posted_content')).toBe(false);
    expect(isResultListUrl(groupJob, 'https://www.facebook.com/groups/12345/feed')).toBe(false);
    expect(isResultListUrl(marketplaceJob, 'https://www.facebook.com/marketplace/you/selling?title_search=Perfume+floral')).toBe(true);
    expect(isResultListUrl(marketplaceJob, 'https://www.facebook.com/marketplace/you/selling?title_search=Other')).toBe(false);
    expect(isResultListUrl(marketplaceJob, 'https://evil.example/marketplace/you/selling?title_search=Perfume+floral')).toBe(false);
  });

  it('accepts only a numbered article with a Facebook link and saves the extracted Marketplace ID', () => {
    expect(isSupervisedResultAssessment(published, marketplaceSnapshot.dom_summary)).toBe(true);
    expect(resolveSupervisedResult(marketplaceJob, [], marketplaceSnapshot, published)).toMatchObject({
      result: { status: 'submitted', url: 'https://www.facebook.com/marketplace/item/987654321/', message: 'Verificado con ayuda de la IA. La tarjeta coincide.' },
      reason: 'verified',
    });
  });

  it('rejects a card whose ID is already in the deterministic baseline', () => {
    expect(resolveSupervisedResult(marketplaceJob, ['own:987654321'], marketplaceSnapshot, published))
      .toMatchObject({ result: null, candidateUrl: null, reason: 'candidate_in_baseline' });
  });

  it('keeps a historical match as a candidate until a person confirms it', () => {
    const reviewed = resolveSupervisedResult(marketplaceJob, [], marketplaceSnapshot, published, { requireHumanConfirmation: true });
    expect(reviewed).toEqual({ result: null, candidateUrl: 'https://www.facebook.com/marketplace/item/987654321/', reason: 'historical_confirmation_required' });
  });

  it('does not expose a historical candidate without an exact title or a live approved state', () => {
    expect(resolveSupervisedResult(marketplaceJob, [], { ...marketplaceSnapshot, items: [{ ...marketplaceSnapshot.items[0], titleMatches: false }] }, published,
      { requireHumanConfirmation: true })).toMatchObject({ result: null, candidateUrl: null });
    expect(resolveSupervisedResult(marketplaceJob, [], { ...marketplaceSnapshot, items: [{ ...marketplaceSnapshot.items[0], authorMatches: false }] }, published,
      { requireHumanConfirmation: true })).toMatchObject({ result: null, candidateUrl: null });
    expect(resolveSupervisedResult(marketplaceJob, [], { ...marketplaceSnapshot, items: [{ ...marketplaceSnapshot.items[0], state: 'pending_approval' }] }, published,
      { requireHumanConfirmation: true })).toMatchObject({ result: null, candidateUrl: null });
    expect(resolveSupervisedResult(marketplaceJob, [], marketplaceSnapshot, { ...published, state: 'not_approved' },
      { requireHumanConfirmation: true })).toMatchObject({ result: null, candidateUrl: null });
  });

  it('maps pending group evidence and preserves a candidate for human confirmation when confidence is low', () => {
    const groupJob = { ...marketplaceJob, destination: { mechanism: 'group_direct', url: 'https://www.facebook.com/groups/12345' } };
    const groupSnapshot = { ...marketplaceSnapshot, items: [{ ...marketplaceSnapshot.items[0],
      links: ['https://www.facebook.com/groups/12345/posts/987654321'], state: 'pending_approval' }],
    dom_summary: { scope: 'page', controls: [{ index: 0, role: 'article', links: ['https://www.facebook.com/groups/12345/posts/987654321'] }] } };
    expect(resolveSupervisedResult(groupJob, [], groupSnapshot, { ...published, state: 'pending_approval' }))
      .toMatchObject({ result: { status: 'pending_approval', url: null, pendingPostId: '987654321' } });
    expect(resolveSupervisedResult(groupJob, [], groupSnapshot, { ...published, confidence: 0.7 }))
      .toMatchObject({ result: null, candidateUrl: 'https://www.facebook.com/groups/12345/permalink/987654321/' });
  });

  it('does not convert a rejected or contradictory assessment into a successful result', () => {
    expect(resolveSupervisedResult(marketplaceJob, [], marketplaceSnapshot, {
      ...published, state: 'not_approved',
    })).toMatchObject({ result: null, candidateUrl: 'https://www.facebook.com/marketplace/item/987654321/', reason: 'candidate_requires_confirmation' });
    expect(resolveSupervisedResult(marketplaceJob, [], marketplaceSnapshot, {
      ...published, state: 'pending_approval',
    })).toMatchObject({ result: null, candidateUrl: 'https://www.facebook.com/marketplace/item/987654321/', reason: 'candidate_requires_confirmation' });
  });

  it('rejects external, multiple, and invented candidate links', () => {
    const external = structuredClone(marketplaceSnapshot);
    external.items[0].links = ['https://example.com/marketplace/item/987654321/'];
    expect(resolveSupervisedResult(marketplaceJob, [], external, published).result).toBeNull();
    const multiple = structuredClone(marketplaceSnapshot);
    multiple.items[0].links.push('https://www.facebook.com/marketplace/item/123456789/');
    expect(resolveSupervisedResult(marketplaceJob, [], multiple, published).result).toBeNull();
    expect(isSupervisedResultAssessment({ ...published, url: 'https://www.facebook.com/marketplace/item/123' }, marketplaceSnapshot.dom_summary)).toBe(false);
  });
});
