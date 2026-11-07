import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultCatalogPresentation, getActiveCatalogTheme, getCatalogHeroTextTone, getCatalogOfferPrice, getCatalogThemeCountdown, moveCatalogSection, moveCatalogSectionToIndex, normalizeCatalogSections, type CatalogPresentation } from './catalogPresentation';

const presentation = (schedules: CatalogPresentation['schedules'], theme: CatalogPresentation['theme'] = 'christmas') => ({ theme, schedules });

describe('public catalog presentation', () => {
  it('uses the selected theme when no schedule exists', () => {
    expect(getActiveCatalogTheme(presentation([]), new Date('2026-11-06T12:00:00Z'))).toBe('christmas');
  });

  it('uses the scheduled theme inside its date window', () => {
    expect(getActiveCatalogTheme(presentation([{ id: 'one', theme: 'hot-sale', startDate: '2026-11-01', endDate: '2026-11-30' }]), new Date('2026-11-06T12:00:00Z'))).toBe('hot-sale');
  });

  it('uses the most recently started theme when schedules overlap', () => {
    expect(getActiveCatalogTheme(presentation([
      { id: 'early', theme: 'christmas', startDate: '2026-11-01', endDate: '2026-12-31' },
      { id: 'late', theme: 'new-year', startDate: '2026-11-05', endDate: '2027-01-10' },
    ]), new Date('2026-11-06T12:00:00Z'))).toBe('new-year');
  });

  it('returns to Normal after the scheduled theme expires', () => {
    expect(getActiveCatalogTheme(presentation([{ id: 'past', theme: 'hot-sale', startDate: '2026-10-01', endDate: '2026-10-31' }]), new Date('2026-11-06T12:00:00Z'))).toBe('normal');
  });

  it('keeps section visibility while normalizing order and missing sections', () => {
    expect(normalizeCatalogSections([
      { id: 'all', visible: false }, { id: 'categories', visible: true },
    ])).toEqual([
      { id: 'all', visible: false }, { id: 'categories', visible: true },
      { id: 'featured', visible: true }, { id: 'offers', visible: true }, { id: 'new', visible: false },
    ]);
  });

  it('removes duplicate section records from persisted configuration', () => {
    expect(normalizeCatalogSections([
      { id: 'featured', visible: true }, { id: 'featured', visible: false },
    ]).filter(section => section.id === 'featured')).toHaveLength(1);
  });

  it('moves sections in either direction without dropping them', () => {
    const sections = normalizeCatalogSections(undefined);
    expect(moveCatalogSection(sections, 'offers', -1).map(section => section.id)).toEqual(['offers', 'featured', 'categories', 'new', 'all']);
    expect(moveCatalogSection(sections, 'offers', 1).map(section => section.id)).toEqual(['featured', 'categories', 'offers', 'new', 'all']);
  });

  it('supports desktop drag-and-drop reordering', () => {
    const sections = normalizeCatalogSections(undefined);
    expect(moveCatalogSectionToIndex(sections, 'all', 0).map(section => section.id)).toEqual(['all', 'featured', 'offers', 'categories', 'new']);
  });

  it('chooses readable title text for both light and dark hero palettes', () => {
    expect(getCatalogHeroTextTone('#F1D98B')).toBe('dark');
    expect(getCatalogHeroTextTone('#164632')).toBe('light');
  });

  it('provides a countdown target for holiday themes without inventing dates for other themes', () => {
    expect(getCatalogThemeCountdown('christmas', new Date(2026, 10, 6))?.target).toEqual(new Date(2026, 11, 24));
    expect(getCatalogThemeCountdown('new-year', new Date(2026, 10, 6))?.target).toEqual(new Date(2027, 0, 1));
    expect(getCatalogThemeCountdown('hot-sale', new Date(2026, 10, 6))).toBeNull();
  });

  it('defaults to enabled decorative controls with announcement text off', () => {
    const defaults = defaultCatalogPresentation();
    expect(defaults.ambience).toMatchObject({ animatedEffects: true, headerDecoration: true, productDecoration: true, announcementText: '' });
  });

  it('shows an offer price only for a valid positive discount', () => {
    expect(getCatalogOfferPrice(8500, 20)).toBe(6800);
    expect(getCatalogOfferPrice(8500, 0)).toBeNull();
    expect(getCatalogOfferPrice(8500, 100)).toBeNull();
  });
});

describe('public catalog presentation migration', () => {
  it('adds presentation without changing existing policy boundaries and exposes only safe public date metadata', () => {
    const sql = readFileSync('supabase/migrations/20261106210043_public_catalog_presentation.sql', 'utf8');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS presentation jsonb NOT NULL DEFAULT');
    expect(sql).toContain("'createdAt', p.created_at");
    expect(sql).toContain('AND p.show_in_catalog');
    expect(sql).toContain('AND NOT p.catalog_only');
    expect(sql).toContain('AND (cc.show_out_of_stock OR p.stock > 0)');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_public_catalog_products(text) FROM PUBLIC');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_public_catalog_products(text) TO anon, authenticated');
    expect(sql).not.toContain('purchase_price');
  });
});
