import { describe, expect, it } from 'vitest';
import { estimateFacebookGroupMembers, lastProductGroupUse, rankFacebookGroups, type FacebookGroupPerformance } from './facebookGroupSuggestions';
import type { FacebookGroup, FacebookPublication } from './facebookPublications';

const groups: FacebookGroup[] = [
  { id: 'large', name: 'Muebles y hogar Rosario', url: 'https://www.facebook.com/groups/large', mechanism: 'group_direct', member_count_text: '20 mil miembros' },
  { id: 'small', name: 'Compra venta general', url: 'https://www.facebook.com/groups/small', mechanism: 'group_direct', member_count_text: '250 miembros' },
  { id: 'repeat', name: 'Hogar y muebles usados', url: 'https://www.facebook.com/groups/repeat', mechanism: 'group_direct' },
];

const performance: FacebookGroupPerformance[] = [
  { group_id: 'large', group_name: groups[0].name, group_url: groups[0].url, member_count_text: '20 mil miembros', member_count_updated_at: null, publication_count: 10, published_count: 9, pending_count: 0, rejected_count: 1, approval_rate_pct: 90, avg_approval_seconds: 120, last_used_at: null, last_rejected_at: null, rejected_last_30d_count: 0 },
  { group_id: 'small', group_name: groups[1].name, group_url: groups[1].url, member_count_text: '250 miembros', member_count_updated_at: null, publication_count: 4, published_count: 2, pending_count: 0, rejected_count: 2, approval_rate_pct: 50, avg_approval_seconds: null, last_used_at: null, last_rejected_at: null, rejected_last_30d_count: 2 },
];

describe('Facebook group suggestions', () => {
  it('parses common Spanish and abbreviated member counts', () => {
    expect(estimateFacebookGroupMembers('1.234 miembros')).toBe(1234);
    expect(estimateFacebookGroupMembers('1,2 mil miembros')).toBe(1200);
    expect(estimateFacebookGroupMembers('1.5K members')).toBe(1500);
    expect(estimateFacebookGroupMembers('sin datos')).toBeNull();
  });

  it('scores deterministically, ranks safer matches first and blocks recent product repeats', () => {
    const now = Date.parse('2026-11-03T12:00:00Z');
    const ranked = rankFacebookGroups(groups, performance, 'Muebles', new Map([
      ['repeat', '2026-11-01T12:00:00Z'],
    ]), now);
    expect(ranked.map(row => row.group.id)).toEqual(['large', 'small', 'repeat']);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[2].blockedUntil).toBe('2026-11-15T12:00:00.000Z');
    expect(rankFacebookGroups(groups, performance, 'Muebles', new Map([
      ['repeat', '2026-11-01T12:00:00Z'],
    ]), now)).toEqual(ranked);
  });

  it('enforces group rules and keeps safety-paused groups out of suggestions', () => {
    const restricted = [
      { ...groups[0], allows_sales: false, rules_summary: 'No se permiten publicaciones de venta.' },
      { ...groups[1], repeat_limit_days: 30 },
      { ...groups[2], safety_paused: true, safety_pause_reason: 'Dos publicaciones rechazadas en los últimos 30 días.' },
    ];
    const ranked = rankFacebookGroups(restricted, performance, 'Muebles', new Map([
      ['small', '2026-11-01T12:00:00Z'],
    ]), Date.parse('2026-11-03T12:00:00Z'));
    expect(ranked.find(row => row.group.id === 'large')?.excludedReason).toContain('no permiten ventas');
    expect(ranked.find(row => row.group.id === 'repeat')?.excludedReason).toContain('rechazadas');
    expect(ranked.find(row => row.group.id === 'small')?.blockedUntil).toBe('2026-12-01T12:00:00.000Z');
  });

  it('uses the latest actual group usage from product publication history', () => {
    const publications = [{
      id: 'publication', approved_at: '2026-11-01T12:00:00Z',
      facebook_deliveries: [{
        id: 'delivery', status: 'published', message: null, evidence_url: null, submitted_at: '2026-11-02T12:00:00Z',
        destination: { name: 'Marketplace', url: '', mechanism: 'marketplace_groups' },
        fb_delivery_group_results: [{ group_id: 'large', status: 'published', post_id: '1', url: null, message: null, checked_at: '2026-11-02T12:10:00Z' }],
        target_groups: [{ group_id: 'small', name: 'General', url: 'https://www.facebook.com/groups/small' }],
      }],
    }] as unknown as FacebookPublication[];
    expect([...lastProductGroupUse(publications).entries()]).toEqual([
      ['large', '2026-11-02T12:00:00Z'],
      ['small', '2026-11-02T12:00:00Z'],
    ]);
  });
});
