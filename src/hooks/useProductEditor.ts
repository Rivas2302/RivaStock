import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { Location, NavigateFunction } from 'react-router-dom';
import type { InventoryHolding, InventoryHoldingDraft, InventoryOwner, Product, UserProfile } from '../types';
import type { SupplierProductCreationContext } from '../components/ResellerPriceListModal';
import { db, deleteFromStorage } from '../lib/db';
import {
  buildHoldingDrafts,
  saveProductWithHoldings,
} from '../lib/inventoryHoldings';
import { resolveIdempotencyIntent, type IdempotencyIntent } from '../lib/idempotencyIntent';
import { beginSubmission, endSubmission } from '../lib/submissionGuard';
import { DUPLICATE_DETECTION_WINDOW_MS } from '../lib/constants';
import { normalizeBarcode } from '../lib/barcode';
import { uploadSupplierListProductPhoto } from '../lib/supplierListPhotos';
import { getProductThumbnailUrl } from '../lib/productPhotos';
import { showToast } from '../lib/toast';
import { clearMobileProductDraft, hasMobileProductDraftContent, restoreMobileProductDraft } from '../lib/mobileProductDraft';
import { getProductEditorRoute } from '../lib/productEditorRoute';
import { firstProductEditorValidationError, validateProductEditorForm } from '../lib/productEditorValidation';
import {
  addProductToResellerPriceList,
  promoteResellerCatalogProduct,
  saveResellerSupplierList,
  saveResellerSupplierListWithPricing,
} from '../lib/priceLists';

interface Options {
  user: UserProfile | null;
  inventoryAccessError: string | null;
  isMobile: boolean;
  holdingsEnabled: boolean;
  categories: Array<{ id: string; name: string }>;
  primaryOwner: InventoryOwner | null;
  operableOwners: InventoryOwner[];
  holdings: InventoryHolding[];
  products: Product[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  setHoldings: Dispatch<SetStateAction<InventoryHolding[]>>;
  setResellerPriceListOpen: Dispatch<SetStateAction<boolean>>;
  location: Location;
  navigate: NavigateFunction;
}

export default function useProductEditor({
  user,
  inventoryAccessError,
  isMobile,
  holdingsEnabled,
  categories,
  primaryOwner,
  operableOwners,
  holdings,
  products,
  setProducts,
  setHoldings,
  setResellerPriceListOpen,
  location,
  navigate,
}: Options) {
  const [isDesktopModalOpen, setIsDesktopModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [validationErrors, setValidationErrors] = useState<ReturnType<typeof validateProductEditorForm>>({});
  const initialEditorRouteRef = useRef({ pathname: location.pathname, search: location.search, route: getProductEditorRoute(location.search) });
  const [initialMobileRouteReady, setInitialMobileRouteReady] = useState(() => (
    !isMobile || !initialEditorRouteRef.current.route.isOpen
  ));
  const mobileEditorRoute = getProductEditorRoute(location.search);
  const isModalOpen = isMobile ? mobileEditorRoute.isOpen : isDesktopModalOpen;
  const [formData, setFormData] = useState<Partial<Product>>({
    ...(isMobile && mobileEditorRoute.mode === 'create' ? { id: crypto.randomUUID(), ownerUid: user?.uid ?? '' } : {}),
    name: '', categoryId: '', category: '', purchasePrice: 0, salePrice: 0, stock: 0,
    minStock: 2, showInCatalog: true, notes: '', images: [],
  });
  const [holdingDrafts, setHoldingDrafts] = useState<InventoryHoldingDraft[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingProductForReseller, setCreatingProductForReseller] = useState(false);
  const [supplierProductCreationContext, setSupplierProductCreationContext] = useState<SupplierProductCreationContext | null>(null);
  const [promotingCatalogProduct, setPromotingCatalogProduct] = useState(false);
  const [returnToResellerList, setReturnToResellerList] = useState(false);
  const productIntentRef = useRef<IdempotencyIntent | null>(null);
  const productSubmitInFlightRef = useRef(false);
  const draftRestoreAttemptedRef = useRef(false);

  useEffect(() => {
    const initialRoute = initialEditorRouteRef.current;
    if (!initialRoute.route.isOpen || !isMobile || !user?.uid || draftRestoreAttemptedRef.current) return;
    draftRestoreAttemptedRef.current = true;
    const draft = restoreMobileProductDraft(user.uid, initialRoute.pathname, initialRoute.search);
    if (draft && hasMobileProductDraftContent(draft)) {
      setFormData(draft.formData);
      setHoldingDrafts(draft.holdingDrafts);
      setEditingProduct(draft.editingProduct);
      setCreatingProductForReseller(draft.creatingProductForReseller);
      setSupplierProductCreationContext(draft.supplierProductCreationContext);
      setPromotingCatalogProduct(draft.promotingCatalogProduct);
      setReturnToResellerList(draft.returnToResellerList);
      setIsUploadingImage(false);
      showToast('Recuperamos tu producto.', 'success');
    }
    setInitialMobileRouteReady(true);
  }, [isMobile, user?.uid]);

  const openProductEditor = (
    product?: Product,
    barcode?: string,
    options?: {
      forReseller?: boolean;
      promoteToStock?: boolean;
      returnToResellerList?: boolean;
      supplierContext?: SupplierProductCreationContext;
      initialDraft?: SupplierProductCreationContext['initialDraft'];
      clearNavigationState?: boolean;
    },
  ) => {
    const params = new URLSearchParams(location.search);
    if (isMobile && isModalOpen && (
      (!product && !editingProduct && params.has('nuevo') && formData.id)
      || (product && editingProduct?.id === product.id)
    )) return;
    if (user?.uid) clearMobileProductDraft(user.uid);
    setValidationErrors({});
    const promoteToStock = Boolean(product?.catalogOnly && options?.promoteToStock);
    const forReseller = Boolean(options?.forReseller || (product?.catalogOnly && !promoteToStock));
    const next = product ? {
      ...product,
      purchasePrice: promoteToStock ? Number(product.catalogCost ?? 0) : product.purchasePrice,
      minStock: promoteToStock ? 2 : product.minStock,
    } : {
      id: crypto.randomUUID(),
      name: options?.initialDraft?.name ?? '',
      categoryId: categories.find(category => category.name.toLocaleLowerCase('es-AR') === options?.initialDraft?.category?.toLocaleLowerCase('es-AR'))?.id ?? '',
      category: options?.initialDraft?.category ?? '',
      purchasePrice: 0, salePrice: options?.initialDraft?.listBasePrice ?? 0, stock: 0, minStock: 2,
      showInCatalog: !forReseller, notes: '', images: [], barcode,
      catalogOnly: forReseller,
      catalogCost: options?.initialDraft?.supplierCost ?? (forReseller ? 0 : null),
      inventoryOwnerId: primaryOwner?.id,
      ownerUid: user?.uid ?? '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setCreatingProductForReseller(forReseller);
    setPromotingCatalogProduct(promoteToStock);
    setSupplierProductCreationContext(options?.supplierContext ?? null);
    setReturnToResellerList(Boolean(options?.returnToResellerList || forReseller || promoteToStock));
    setEditingProduct(product ?? null);
    productIntentRef.current = null;
    setIsUploadingImage(false);
    setFormData(next);
    const nextHoldingDrafts = buildHoldingDrafts(
      operableOwners,
      product && !product.catalogOnly ? holdings.filter((holding) => holding.productId === product.id) : [],
    ).map((draft, index) => (
      promoteToStock && index === 0
        ? { ...draft, purchaseCost: Number(product?.catalogCost ?? 0) }
        : draft
    ));
    setHoldingDrafts(forReseller ? [] : nextHoldingDrafts);
    if (isMobile) {
      const params = new URLSearchParams(location.search);
      params.delete('producto');
      params.delete('ajustar');
      if (product) {
        params.delete('nuevo');
        params.set('editar', product.id);
      } else {
        params.delete('editar');
        params.set('nuevo', '1');
      }
      const query = params.toString();
      const nextSearch = query ? `?${query}` : '';
      if (nextSearch !== location.search) {
        navigate({ pathname: location.pathname, search: nextSearch }, {
          state: { ...(options?.clearNavigationState ? {} : (location.state as Record<string, unknown> | null) ?? {}), productEditorEntry: true },
        });
      }
    } else {
      setIsDesktopModalOpen(true);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || inventoryAccessError || isUploadingImage) return;
    const validationErrors = validateProductEditorForm({ formData, holdingDrafts, holdingsEnabled, creatingProductForReseller });
    const validationMessage = firstProductEditorValidationError(validationErrors);
    if (validationMessage) {
      setValidationErrors(validationErrors);
      showToast(validationMessage, 'error');
      return;
    }
    setValidationErrors({});
    if (!beginSubmission(productSubmitInFlightRef)) return;
    setSaving(true);
    let pendingSupplierPhotoUrl: string | null = null;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const saveAndAddAnother = submitter?.getAttribute('data-save-another') === 'true'
      && !editingProduct && !creatingProductForReseller && !promotingCatalogProduct;

    try {
      let savedProduct: Product | null = null;
      if (creatingProductForReseller && Number(formData.catalogCost ?? 0) <= 0) {
        showToast('Cargá el costo del proveedor para calcular la ganancia.', 'error');
        return;
      }
      if (promotingCatalogProduct) {
        const promotionStock = holdingsEnabled
          ? holdingDrafts.reduce((total, draft) => total + draft.stock, 0)
          : Number(formData.stock ?? 0);
        if (promotionStock <= 0) {
          showToast('Cargá una cantidad mayor que cero para incorporar el producto al stock.', 'error');
          return;
        }
      }
      const normalizedBarcode = normalizeBarcode(formData.barcode ?? '');
      if (normalizedBarcode) {
        const duplicate = products.find(
          (product) => normalizeBarcode(product.barcode ?? '') === normalizedBarcode && product.id !== editingProduct?.id,
        );
        if (duplicate) {
          showToast(`Ya existe un producto con ese código: "${duplicate.name}"`, 'error');
          return;
        }
      }

      const productId = editingProduct?.id ?? formData.id ?? crypto.randomUUID();
      if (creatingProductForReseller && supplierProductCreationContext?.initialDraft?.photoFile) {
        pendingSupplierPhotoUrl = await uploadSupplierListProductPhoto(
          supplierProductCreationContext.initialDraft.photoFile,
          user.uid,
          productId,
        );
      }
      const productData = {
        ...formData,
        id: productId,
        images: pendingSupplierPhotoUrl ? [...(formData.images ?? []), pendingSupplierPhotoUrl] : (formData.images ?? []),
        barcode: normalizedBarcode || undefined,
        inventoryOwnerId: formData.inventoryOwnerId || primaryOwner?.id,
        ownerUid: user.uid,
        updatedAt: new Date().toISOString(),
      } as Product;

      if (creatingProductForReseller) {
        const catalogProductData = {
          ...productData,
          stock: 0, minStock: 0, purchasePrice: 0, showInCatalog: false,
          catalogOnly: true, catalogCost: Number(formData.catalogCost ?? 0),
        } as Product;
        if (editingProduct) {
          await db.update('products', editingProduct.id, catalogProductData);
          savedProduct = { ...editingProduct, ...catalogProductData };
          setProducts((previous) => previous.map((product) => product.id === editingProduct.id ? savedProduct as Product : product));
        } else {
          savedProduct = await db.create<Product>('products', {
            ...catalogProductData, id: catalogProductData.id || crypto.randomUUID(), createdAt: new Date().toISOString(),
          });
          setProducts((previous) => [...previous, savedProduct as Product]);
        }
      } else if (holdingsEnabled) {
        const intent = resolveIdempotencyIntent('product', {
          editingProductId: editingProduct?.id ?? null, formData, holdings: holdingDrafts,
        }, productIntentRef.current);
        productIntentRef.current = intent;
        const result = await saveProductWithHoldings({
          product: {
            ...productData,
            id: editingProduct?.id ?? productData.id ?? crypto.randomUUID(),
            createdAt: editingProduct?.createdAt ?? new Date().toISOString(),
          },
          holdings: holdingDrafts,
          idempotencyKey: intent.key,
        });
        setProducts((previous) => {
          const exists = previous.some((product) => product.id === result.product.id);
          return exists
            ? previous.map((product) => product.id === result.product.id ? result.product : product)
            : [...previous, result.product];
        });
        setHoldings((previous) => [
          ...previous.filter((holding) => holding.productId !== result.product.id), ...result.holdings,
        ]);
        savedProduct = result.product;
      } else if (editingProduct) {
        const inventoryProductData = promotingCatalogProduct
          ? { ...productData, catalogOnly: true, catalogCost: editingProduct.catalogCost ?? null }
          : productData;
        await db.update('products', editingProduct.id, inventoryProductData);
        setProducts((previous) => previous.map((product) => product.id === editingProduct.id
          ? { ...product, ...inventoryProductData } as Product
          : product));
        savedProduct = { ...editingProduct, ...inventoryProductData } as Product;
      } else {
        const cutoff = new Date(Date.now() - DUPLICATE_DETECTION_WINDOW_MS).toISOString();
        const potentialDuplicate = products.find((product) => (
          product.name.toLowerCase() === (formData.name || '').toLowerCase()
          && product.inventoryOwnerId === productData.inventoryOwnerId
          && product.createdAt && product.createdAt > cutoff
        ));
        if (potentialDuplicate) {
          showToast('Ya existe un producto con ese nombre creado hace unos segundos. Esperá antes de volver a intentarlo.', 'error');
          return;
        }
        savedProduct = await db.create<Product>('products', {
          ...productData, id: productData.id || crypto.randomUUID(), createdAt: new Date().toISOString(),
        });
        setProducts((previous) => [...previous, savedProduct as Product]);
      }

      // The product now owns this uploaded object; later UI failures must not orphan its image.
      if (savedProduct) pendingSupplierPhotoUrl = null;

      if (creatingProductForReseller && savedProduct && !editingProduct) {
        try {
          if (supplierProductCreationContext) {
            const productIds = [...supplierProductCreationContext.productIds, savedProduct.id];
            if (supplierProductCreationContext.initialDraft) {
              await saveResellerSupplierListWithPricing({
                priceListId: supplierProductCreationContext.priceListId,
                supplierId: supplierProductCreationContext.supplierId,
                productIds,
                price: {
                  productId: savedProduct.id,
                  supplierCost: supplierProductCreationContext.initialDraft.supplierCost,
                  marginPercent: supplierProductCreationContext.initialDraft.marginPercent,
                  roundingStep: supplierProductCreationContext.initialDraft.roundingStep,
                },
              });
            } else {
              await saveResellerSupplierList({
                priceListId: supplierProductCreationContext.priceListId,
                supplierId: supplierProductCreationContext.supplierId,
                productIds,
              });
            }
            showToast('Producto creado exclusivamente para la lista del proveedor.', 'success');
          } else {
            await addProductToResellerPriceList(savedProduct.id, 'on_order');
            showToast('Producto de catálogo creado y agregado como “Por pedido”.', 'success');
          }
        } catch (listError) {
          console.error('[Stock] add product to reseller list error:', listError);
          showToast('El producto se guardó, pero deberás agregarlo manualmente a la lista de revendedores.', 'info');
        }
      }

      if (promotingCatalogProduct && savedProduct) {
        const promoted = await promoteResellerCatalogProduct(savedProduct.id);
        savedProduct = promoted;
        setProducts((previous) => previous.map((product) => product.id === promoted.id ? promoted : product));
        showToast('Producto incorporado al stock y separado de la lista por pedido.', 'success');
      }

      if (saveAndAddAnother && savedProduct) {
        const nextCategoryId = formData.categoryId ?? '';
        const nextCategory = formData.category ?? categories.find((category) => category.id === nextCategoryId)?.name ?? '';
        const nextInventoryOwnerId = formData.inventoryOwnerId || primaryOwner?.id;
        setEditingProduct(null);
        setCreatingProductForReseller(false);
        setPromotingCatalogProduct(false);
        setSupplierProductCreationContext(null);
        setReturnToResellerList(false);
        productIntentRef.current = null;
        setIsUploadingImage(false);
        setFormData({
          id: crypto.randomUUID(), name: '', categoryId: nextCategoryId, category: nextCategory,
          purchasePrice: 0, salePrice: 0, stock: 0, minStock: 2, showInCatalog: true,
          notes: '', images: [], inventoryOwnerId: nextInventoryOwnerId, ownerUid: user.uid,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        setHoldingDrafts(buildHoldingDrafts(operableOwners, []));
        setValidationErrors({});
        if (user.uid) clearMobileProductDraft(user.uid);
        showToast('Producto guardado.', 'success');
        return;
      }

      setIsDesktopModalOpen(false);
      setValidationErrors({});
      setCreatingProductForReseller(false);
      setPromotingCatalogProduct(false);
      setSupplierProductCreationContext(null);
      productIntentRef.current = null;
      setEditingProduct(null);
      setHoldingDrafts([]);
      setFormData({
        name: '', categoryId: '', category: '', purchasePrice: 0, salePrice: 0, stock: 0,
        minStock: 2, showInCatalog: true, catalogOnly: false, catalogCost: null,
        notes: '', images: [], inventoryOwnerId: primaryOwner?.id,
      });
      if (isMobile && savedProduct && !returnToResellerList) {
        navigate(`/stock?producto=${encodeURIComponent(savedProduct.id)}`, { replace: true, state: { fromMobileStock: true, productJustSaved: true } });
      } else if (isMobile && returnToResellerList) {
        navigate('/stock', { replace: true, state: {} });
      }
      if (returnToResellerList) setResellerPriceListOpen(true);
      setReturnToResellerList(false);
      if (user.uid) clearMobileProductDraft(user.uid);
    } catch (error) {
      if (pendingSupplierPhotoUrl) {
        await Promise.allSettled([pendingSupplierPhotoUrl, getProductThumbnailUrl(pendingSupplierPhotoUrl)].map(deleteFromStorage));
      }
      console.error('[Stock] save product error:', error);
      showToast(error instanceof Error ? error.message : 'No se pudo guardar el producto.', 'error');
    } finally {
      endSubmission(productSubmitInFlightRef);
      setSaving(false);
    }
  };

  const closeProductEditor = () => {
    if (productSubmitInFlightRef.current) return;
    if (user?.uid) clearMobileProductDraft(user.uid);
    productIntentRef.current = null;
    setIsDesktopModalOpen(false);
    setCreatingProductForReseller(false);
    setPromotingCatalogProduct(false);
    setSupplierProductCreationContext(null);
    if (returnToResellerList) setResellerPriceListOpen(true);
    setReturnToResellerList(false);
    const params = new URLSearchParams(location.search);
    if (params.has('editar') || params.has('nuevo')) {
      params.delete('editar');
      params.delete('nuevo');
      const query = params.toString();
      const locationState = location.state as { productEditorEntry?: boolean } | null;
      if (isMobile && locationState?.productEditorEntry) {
        navigate(-1);
      } else {
        navigate({ pathname: location.pathname, search: query ? `?${query}` : '' }, { replace: true, state: location.state });
      }
    }
  };

  return {
    isModalOpen,
    isInitialMobileRouteReady: initialMobileRouteReady,
    setIsModalOpen: setIsDesktopModalOpen,
    validationErrors,
    setValidationErrors,
    editingProduct,
    setEditingProduct,
    formData,
    setFormData,
    holdingDrafts,
    setHoldingDrafts,
    isUploadingImage,
    setIsUploadingImage,
    saving,
    setSaving,
    creatingProductForReseller,
    setCreatingProductForReseller,
    supplierProductCreationContext,
    setSupplierProductCreationContext,
    promotingCatalogProduct,
    setPromotingCatalogProduct,
    returnToResellerList,
    setReturnToResellerList,
    productIntentRef,
    productSubmitInFlightRef,
    openProductEditor,
    handleSave,
    closeProductEditor,
  };
}
