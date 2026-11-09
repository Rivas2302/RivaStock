import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultCatalogPresentation, formatCatalogWhatsAppMessage, getActiveCatalogTheme, getCatalogAnnouncementBackgroundColor, getCatalogAnnouncementTextColor, getCatalogHeroTextTone, getCatalogOfferPrice, getCatalogThemeCountdown, moveCatalogSection, moveCatalogSectionToIndex, normalizeCatalogColor, normalizeCatalogSections, type CatalogPresentation } from './catalogPresentation';

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

  it('uses the catalog accent automatically and chooses black or white for readable ribbon text', () => {
    expect(getCatalogAnnouncementBackgroundColor(null, '#B23A48')).toBe('#B23A48');
    expect(getCatalogAnnouncementBackgroundColor('#ff8800', '#3156A6')).toBe('#FF8800');
    expect(getCatalogAnnouncementBackgroundColor('invalid', 'invalid')).toBe('#3156A6');
    expect(getCatalogAnnouncementTextColor('#FFFFFF')).toBe('#000000');
    expect(getCatalogAnnouncementTextColor('#000000')).toBe('#FFFFFF');
    expect(getCatalogAnnouncementTextColor('#B23A48')).toBe('#FFFFFF');
    expect(normalizeCatalogColor('#12abEF')).toBe('#12ABEF');
    expect(normalizeCatalogColor('rgb(1,2,3)')).toBeNull();
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

  it('replaces WhatsApp variables with the product, price, share link, and quantity', () => {
    expect(formatCatalogWhatsAppMessage('Quiero {producto}, {cantidad} por {precio}. {link}', {
      product: 'Cable USB-C', price: '$ 8.500', link: 'https://rivastock.vercel.app/p/tienda/cable', quantity: 2,
    })).toBe('Quiero Cable USB-C, 2 por $ 8.500. https://rivastock.vercel.app/p/tienda/cable');
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

  it('adds ribbon color and owner-scoped supplier mappings without changing catalog or product data', () => {
    const sql = readFileSync('supabase/migrations/20261109214859_20261109210209_catalog_reseller_category_mappings_and_ribbon_color.sql', 'utf8');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS announcement_color text');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.reseller_supplier_category_mappings');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('get_owner_uid(auth.uid())');
    expect(sql).toContain('s.user_id = reseller_supplier_category_mappings.user_id');
    expect(sql).toContain('c.user_id = reseller_supplier_category_mappings.user_id');
    expect(sql).not.toMatch(/\b(UPDATE|DELETE)\s+(public\.)?[a-z_]+\s+SET\b|\b(DROP\s+TABLE|TRUNCATE)\b/i);
  });
});
