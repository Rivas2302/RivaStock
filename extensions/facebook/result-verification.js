const RESULT_STATES = new Set(['published', 'pending_approval', 'not_approved', 'unknown']);

export function isResultListUrl(job, value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://www.facebook.com') return false;
    if (job?.destination?.mechanism === 'marketplace') {
      return url.pathname.replace(/\/$/, '') === '/marketplace/you/selling'
        && url.searchParams.get('title_search') === job.content?.title;
    }
    if (job?.destination?.mechanism !== 'group_direct') return false;
    const destination = new URL(job.destination.url);
    if (destination.origin !== 'https://www.facebook.com') return false;
    const groupId = destination.pathname.match(/^\/groups\/([A-Za-z0-9._-]+)\/?$/)?.[1];
    return Boolean(groupId && new RegExp(`^/groups/${escapeRegExp(groupId)}/my_(?:pending|posted)_content$`).test(url.pathname));
  } catch { return false; }
}

export function isSupervisedResultAssessment(value, domSummary) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 5 || keys.some(key => !['found', 'element_index', 'state', 'observation', 'confidence'].includes(key))
    || typeof value.found !== 'boolean' || !RESULT_STATES.has(value.state)
    || typeof value.observation !== 'string' || !value.observation.trim() || value.observation.length > 300
    || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1) return false;
  if (!value.found) return value.element_index === null && value.state === 'unknown';
  if (!Number.isSafeInteger(value.element_index) || value.element_index < 0 || value.element_index > 79
    || domSummary?.scope !== 'page') return false;
  const control = domSummary.controls?.find(item => item.index === value.element_index);
  return control?.role === 'article' && Array.isArray(control.links) && control.links.length > 0;
}

export function resolveSupervisedResult(job, baseline, snapshot, assessment, { requireHumanConfirmation = false } = {}) {
  const domSummary = snapshot?.dom_summary;
  if (!isSupervisedResultAssessment(assessment, domSummary)) {
    return { result: null, candidateUrl: null, reason: 'assessment_invalid' };
  }
  if (!assessment.found) return { result: null, candidateUrl: null, reason: 'not_found' };

  const selected = snapshot.items?.[assessment.element_index];
  if (!selected) return { result: null, candidateUrl: null, reason: 'candidate_missing' };
  const evidence = candidateUrlForItem(job, selected);
  if (!evidence) return { result: null, candidateUrl: null, reason: 'candidate_link_invalid' };
  if (baseline.some(value => value === `own:${evidence.id}`)) {
    return { result: null, candidateUrl: null, reason: 'candidate_in_baseline' };
  }

  const candidateUrl = evidence.url;
  if (requireHumanConfirmation) {
    if (selected.authorMatches !== true || !selected.titleMatches || selected.state !== assessment.state
      || !['published', 'pending_approval'].includes(assessment.state)) {
      return { result: null, candidateUrl: null, reason: 'historical_candidate_unverified' };
    }
    return { result: null, candidateUrl, reason: 'historical_confirmation_required' };
  }
  if (assessment.confidence < 0.8 || assessment.state === 'unknown'
    || assessment.state === 'not_approved' || selected.state !== assessment.state
    || selected.authorMatches !== true || selected.titleMatches !== true) {
    return { result: null, candidateUrl, reason: 'candidate_requires_confirmation' };
  }

  const mechanism = job.destination.mechanism;
  const status = assessment.state === 'pending_approval' ? 'pending_approval'
    : assessment.state === 'not_approved' ? 'not_approved'
      : mechanism === 'marketplace' ? 'submitted' : 'published';
  return {
    result: {
      status,
      url: assessment.state === 'pending_approval' && mechanism !== 'marketplace' ? null : candidateUrl,
      ...(assessment.state === 'pending_approval' ? { pendingPostId: evidence.id } : {}),
      message: `Verificado con ayuda de la IA. ${assessment.observation}`.slice(0, 500),
    },
    candidateUrl: null,
    reason: 'verified',
  };
}

function candidateUrlForItem(job, item) {
  const destination = job.destination;
  if (!Array.isArray(item.links)) return null;
  const ids = new Set();
  if (destination.mechanism === 'marketplace') {
    for (const link of item.links) {
      const url = safeFacebookUrl(link);
      const match = url?.pathname.match(/^\/marketplace\/item\/(\d+)\/?$/);
      if (match) ids.add(match[1]);
    }
    if (ids.size !== 1) return null;
    const id = [...ids][0];
    return { id, url: `https://www.facebook.com/marketplace/item/${id}/` };
  }
  if (destination.mechanism === 'group_direct') {
    let groupSegment;
    try {
      const target = new URL(destination.url);
      if (target.origin !== 'https://www.facebook.com') return null;
      groupSegment = target.pathname.match(/^\/groups\/([A-Za-z0-9._-]+)\/?$/)?.[1];
    } catch { return null; }
    if (!groupSegment) return null;
    for (const link of item.links) {
      const url = safeFacebookUrl(link);
      const match = url?.pathname.match(new RegExp(`^/groups/${escapeRegExp(groupSegment)}/(?:posts|permalink)/(\\d+)/?$`));
      if (match) ids.add(match[1]);
    }
    if (ids.size !== 1) return null;
    const id = [...ids][0];
    return { id, url: `https://www.facebook.com/groups/${groupSegment}/permalink/${id}/` };
  }
  return null;
}

function safeFacebookUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== 'https://www.facebook.com' || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
