import type { InventoryHoldingDraft, Product } from '../types';

const DRAFT_VERSION = 1;
const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

export interface MobileProductDraft {
  version: 1;
  ownerUid: string;
  pathname: string;
  savedAt: number;
  formData: Partial<Product>;
  holdingDrafts: InventoryHoldingDraft[];
  editingProduct: Product | null;
  creatingProductForReseller: boolean;
  supplierProductCreationContext: {
    priceListId: string;
    supplierId: string;
    productIds: string[];
    initialDraft?: {
      name: string;
      supplierCost: number;
      category: string;
      marginPercent: number;
      roundingStep: 0 | 100 | 500;
      listBasePrice: number;
    };
  } | null;
  promotingCatalogProduct: boolean;
  returnToResellerList: boolean;
}

export function hasMobileProductDraftContent(draft: MobileProductDraft): boolean {
  const form = draft.formData;
  return Boolean(
    form.name?.trim()
    || form.categoryId
    || form.barcode?.trim()
    || form.description?.trim()
    || form.notes?.trim()
    || (form.images?.length ?? 0) > 0
    || Number(form.salePrice ?? 0) > 0
    || Number(form.purchasePrice ?? 0) > 0
    || Number(form.catalogCost ?? 0) > 0
    || Number(form.stock ?? 0) > 0
    || (form.minStock !== undefined && Number(form.minStock) !== 2)
    || draft.holdingDrafts.some((holding) => holding.stock > 0 || holding.purchaseCost > 0 || holding.minStock !== 2)
    || Boolean(draft.supplierProductCreationContext)
    || draft.promotingCatalogProduct,
  );
}

function keyFor(ownerUid: string): string {
  return `rivastock:mobile-product-draft:v${DRAFT_VERSION}:${ownerUid}`;
}

export function saveMobileProductDraft(
  draft: Omit<MobileProductDraft, 'version' | 'savedAt'>,
  storage: Pick<Storage, 'setItem'> = sessionStorage,
  now = Date.now(),
): boolean {
  try {
    const value: MobileProductDraft = { ...draft, version: DRAFT_VERSION, savedAt: now };
    storage.setItem(keyFor(draft.ownerUid), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function restoreMobileProductDraft(
  ownerUid: string,
  pathname: string,
  search: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage,
  now = Date.now(),
): MobileProductDraft | null {
  const params = new URLSearchParams(search);
  if (!params.has('nuevo') && !params.has('editar')) return null;

  const key = keyFor(ownerUid);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const candidate = JSON.parse(raw) as Partial<MobileProductDraft>;
    const hasProductId = typeof candidate.formData?.id === 'string' && candidate.formData.id.length > 0;
    const requestedProductId = params.get('editar');
    const valid = candidate.version === DRAFT_VERSION
      && candidate.ownerUid === ownerUid
      && candidate.pathname === pathname
      && typeof candidate.savedAt === 'number'
      && candidate.savedAt <= now
      && now - candidate.savedAt <= DRAFT_TTL_MS
      && candidate.formData !== null
      && typeof candidate.formData === 'object'
      && (!requestedProductId || candidate.editingProduct?.id === requestedProductId || candidate.formData.id === requestedProductId)
      && (requestedProductId !== null || !candidate.editingProduct)
      && Array.isArray(candidate.formData.images)
      && candidate.formData.images.every((image) => typeof image === 'string')
      && Array.isArray(candidate.holdingDrafts)
      && (hasProductId || typeof candidate.editingProduct?.id === 'string');
    if (!valid) {
      storage.removeItem(key);
      return null;
    }
    storage.removeItem(key);
    return candidate as MobileProductDraft;
  } catch {
    try { storage.removeItem(key); } catch { /* Storage can be unavailable in private browsing. */ }
    return null;
  }
}

export function clearMobileProductDraft(ownerUid: string, storage: Pick<Storage, 'removeItem'> = sessionStorage): void {
  try { storage.removeItem(keyFor(ownerUid)); } catch { /* Storage can be unavailable in private browsing. */ }
}
