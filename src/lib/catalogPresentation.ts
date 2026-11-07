export const CATALOG_THEME_IDS = ['normal', 'christmas', 'children-day', 'new-year', 'mothers-day', 'fathers-day', 'back-to-school', 'hot-sale', 'custom'] as const;
export type CatalogThemeId = typeof CATALOG_THEME_IDS[number];
export type CatalogSectionId = 'featured' | 'offers' | 'categories' | 'new' | 'all';
export type CatalogAmbienceIntensity = 'soft' | 'normal' | 'party';

export interface CatalogAmbience {
  intensity: CatalogAmbienceIntensity;
  animatedEffects: boolean;
  headerDecoration: boolean;
  productDecoration: boolean;
  countdown: boolean;
  announcementText: string;
  themedFont: boolean;
  welcomeCard: boolean;
}

export interface CatalogSectionSetting {
  id: CatalogSectionId;
  visible: boolean;
}

export interface CatalogThemeSchedule {
  id: string;
  theme: CatalogThemeId;
  startDate: string;
  endDate: string;
}

export interface CatalogPresentation {
  theme: CatalogThemeId;
  featuredMode: 'manual' | 'best_selling' | 'category';
  schedules: CatalogThemeSchedule[];
  heroTitle: string;
  heroDescription: string;
  heroImageUrl: string | null;
  useBusinessCover: boolean;
  heroColor: string;
  accentColor: string;
  sections: CatalogSectionSetting[];
  featuredProductIds: string[];
  featuredCategoryId: string | null;
  offerProductIds: string[];
  offerDiscountPercentByProduct: Record<string, number>;
  offerEndsAt: string | null;
  ambience: CatalogAmbience;
  showWhatsAppButton: boolean;
  showProductsWithoutPhoto: boolean;
  whatsappMessageTemplate: string;
}

export const CATALOG_THEME_OPTIONS: Array<{ id: CatalogThemeId; label: string; heroColor: string; accentColor: string; title: string; description: string }> = [
  { id: 'normal', label: 'Normal', heroColor: '#172033', accentColor: '#3156A6', title: 'Encontrá lo que buscás', description: 'Una selección para todos los días.' },
  { id: 'christmas', label: 'Navidad', heroColor: '#164632', accentColor: '#B23A48', title: 'Regalos para compartir', description: 'Encontrá algo especial para estas fiestas.' },
  { id: 'children-day', label: 'Día del Niño', heroColor: '#F1D98B', accentColor: '#6B55A1', title: 'Un regalo para cada aventura', description: 'Ideas para sorprender a los más chicos.' },
  { id: 'new-year', label: 'Año Nuevo', heroColor: '#202226', accentColor: '#9B7A35', title: 'Empezá el año con algo nuevo', description: 'Elegí tus favoritos para arrancar.' },
  { id: 'mothers-day', label: 'Día de la Madre', heroColor: '#F1DCE3', accentColor: '#9D466A', title: 'Un detalle para celebrar', description: 'Ideas para agradecer y compartir.' },
  { id: 'fathers-day', label: 'Día del Padre', heroColor: '#26384A', accentColor: '#39728A', title: 'Para alguien que siempre está', description: 'Encontrá un regalo pensado para él.' },
  { id: 'back-to-school', label: 'Vuelta a clases', heroColor: '#DCE7F3', accentColor: '#466E9D', title: 'Todo listo para volver', description: 'Prepará el comienzo de clases.' },
  { id: 'hot-sale', label: 'Hot Sale', heroColor: '#6C3431', accentColor: '#B84F38', title: 'Oportunidades por tiempo limitado', description: 'Mirá las propuestas disponibles.' },
  { id: 'custom', label: 'Personalizado', heroColor: '#27303F', accentColor: '#5278BD', title: 'Tu negocio, a tu manera', description: 'Elegí el mensaje y los colores que te representan.' },
];

export const DEFAULT_CATALOG_SECTIONS: CatalogSectionSetting[] = [
  { id: 'featured', visible: true },
  { id: 'offers', visible: true },
  { id: 'categories', visible: true },
  { id: 'new', visible: false },
  { id: 'all', visible: true },
];

export const DEFAULT_CATALOG_AMBIENCE: CatalogAmbience = {
  intensity: 'normal', animatedEffects: true, headerDecoration: true,
  productDecoration: true, countdown: true, announcementText: '',
  themedFont: true, welcomeCard: true,
};

export const CATALOG_SECTION_LABELS: Record<CatalogSectionId, string> = {
  featured: 'Destacados de la temporada',
  offers: 'Ofertas',
  categories: 'Categorías',
  new: 'Novedades',
  all: 'Todos los productos',
};

export function defaultCatalogPresentation(legacy?: { welcomeMessage?: string; bannerColor?: string; primaryColor?: string; bannerUrl?: string }): CatalogPresentation {
  const theme = CATALOG_THEME_OPTIONS[0];
  return {
    theme: 'normal', featuredMode: 'manual', schedules: [], heroTitle: theme.title,
    heroDescription: legacy?.welcomeMessage || theme.description,
    heroImageUrl: null, useBusinessCover: false,
    heroColor: legacy?.bannerColor || theme.heroColor,
    accentColor: legacy?.primaryColor || theme.accentColor,
    sections: DEFAULT_CATALOG_SECTIONS.map(section => ({ ...section })),
    featuredProductIds: [], featuredCategoryId: null, offerProductIds: [],
    offerDiscountPercentByProduct: {}, offerEndsAt: null,
    ambience: { ...DEFAULT_CATALOG_AMBIENCE },
    showWhatsAppButton: true, showProductsWithoutPhoto: false,
    whatsappMessageTemplate: 'Hola! Quiero consultar por {producto} ({precio}).\n{link}',
  };
}

export function formatCatalogWhatsAppMessage(template: string, values: { product: string; price: string; link: string; quantity?: number }): string {
  const replacements: Record<string, string> = { producto: values.product, precio: values.price, link: values.link, cantidad: String(values.quantity ?? 1) };
  return template.replace(/\{(producto|precio|link|cantidad)\}/g, (_, key: string) => replacements[key]);
}

export function getCatalogOfferPrice(price: number, discountPercent: number): number | null {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent >= 100) return null;
  return Math.round(price * (1 - discountPercent / 100));
}

export function getActiveCatalogTheme(presentation: Pick<CatalogPresentation, 'theme' | 'schedules'>, now = new Date()): CatalogThemeId {
  const today = now.toISOString().slice(0, 10);
  const active = presentation.schedules
    .filter(schedule => schedule.startDate <= today && schedule.endDate >= today)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id.localeCompare(a.id))[0];
  if (active) return active.theme;
  if (presentation.schedules.some(schedule => schedule.endDate < today)) return 'normal';
  return presentation.theme;
}

export function getCatalogHeroTextTone(hexColor: string): 'light' | 'dark' {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexColor);
  if (!match) return 'light';
  const [red, green, blue] = match.slice(1).map(value => Number.parseInt(value, 16) / 255);
  const linear = [red, green, blue].map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.42 ? 'dark' : 'light';
}

export function getCatalogThemeCountdown(theme: CatalogThemeId, now = new Date()): { target: Date; label: string } | null {
  const currentYear = now.getFullYear();
  if (theme === 'christmas') {
    const target = new Date(currentYear, 11, 24);
    if (target <= now) target.setFullYear(currentYear + 1);
    return { target, label: 'para Navidad' };
  }
  if (theme === 'new-year') return { target: new Date(currentYear + 1, 0, 1), label: 'para Año Nuevo' };
  return null;
}

export function normalizeCatalogSections(sections: CatalogSectionSetting[] | undefined): CatalogSectionSetting[] {
  const sectionMap = new Map((sections ?? []).map(section => [section.id, section]));
  const validIds = new Set<CatalogSectionId>(DEFAULT_CATALOG_SECTIONS.map(section => section.id));
  const seen = new Set<CatalogSectionId>();
  const ordered = (sections ?? []).filter(section => {
    if (!validIds.has(section.id) || seen.has(section.id)) return false;
    seen.add(section.id);
    return true;
  });
  for (const section of DEFAULT_CATALOG_SECTIONS) {
    if (!sectionMap.has(section.id)) ordered.push({ ...section });
  }
  return ordered.map(section => ({ id: section.id, visible: section.visible }));
}

export function moveCatalogSection(sections: CatalogSectionSetting[], sectionId: CatalogSectionId, offset: -1 | 1): CatalogSectionSetting[] {
  const currentIndex = sections.findIndex(section => section.id === sectionId);
  const targetIndex = currentIndex + offset;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sections.length) return sections;
  const next = [...sections];
  [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
  return next;
}

export function moveCatalogSectionToIndex(sections: CatalogSectionSetting[], sectionId: CatalogSectionId, targetIndex: number): CatalogSectionSetting[] {
  const currentIndex = sections.findIndex(section => section.id === sectionId);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sections.length || currentIndex === targetIndex) return sections;
  const next = [...sections];
  const [section] = next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, section);
  return next;
}
