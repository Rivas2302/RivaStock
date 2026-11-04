import { useCallback } from 'react';
import type { InventoryHolding, InventoryOwner, Product } from '../../types';
import MobileStockExperience from './MobileStockExperience';
import { dispatchMobileStockAction } from './dispatchMobileStockAction';
import type { MobileStockActionHandlers } from './dispatchMobileStockAction';
import type { AdjustProductStockInput } from '../../lib/stockAdjustments';

type Data = [
  products: Product[],
  visibleHoldingsByProduct: ReadonlyMap<string, InventoryHolding[]>,
  owners: InventoryOwner[],
  ownersById: ReadonlyMap<string, InventoryOwner>,
  operableInventoryOwnerIds: string[],
  holdingsEnabled: boolean,
  loading: boolean,
  canWrite: boolean,
  canDelete: boolean,
  catalogSavingIds: ReadonlySet<string>,
  restockProductIds: ReadonlySet<string>,
  categories: Array<{ name: string }>,
  selectedIds: ReadonlySet<string>,
  selectingForCodes: boolean,
  bulkGenerating: boolean,
  pendingImageCleanupCount: number,
  imageCleanupRetrying: boolean,
  restockCount: number,
];

type Handlers = [
  onToggleSelect: (productId: string) => void,
  startCodeSelection: MobileStockActionHandlers['startCodeSelection'],
  cancelCodeSelection: MobileStockActionHandlers['cancelCodeSelection'],
  generateCodes: MobileStockActionHandlers['generateCodes'],
  addProduct: MobileStockActionHandlers['addProduct'],
  openResellers: MobileStockActionHandlers['openResellers'],
  openPriceList: MobileStockActionHandlers['openPriceList'],
  downloadPriceList: MobileStockActionHandlers['downloadPriceList'],
  adjustStock: MobileStockActionHandlers['adjustStock'],
  saveStockAdjustment: (input: AdjustProductStockInput) => Promise<unknown>,
  toggleCatalog: MobileStockActionHandlers['toggleCatalog'],
  printBarcode: MobileStockActionHandlers['printBarcode'],
  publishFacebook: MobileStockActionHandlers['publishFacebook'],
  deleteProduct: MobileStockActionHandlers['deleteProduct'],
  createProductFromScan: MobileStockActionHandlers['createProductFromScan'],
  editProduct: MobileStockActionHandlers['editProduct'],
  retryImageCleanup: MobileStockActionHandlers['retryImageCleanup'],
];

interface Props {
  data: Data;
  handlers: Handlers;
}

export default function MobileStockEntry({ data, handlers }: Props) {
  const [
    products, visibleHoldingsByProduct, owners, ownersById, operableInventoryOwnerIds, holdingsEnabled, loading,
    canWrite, canDelete, catalogSavingIds, restockProductIds, categories, selectedIds,
    selectingForCodes, bulkGenerating, pendingImageCleanupCount, imageCleanupRetrying, restockCount,
  ] = data;
  const [
    onToggleSelect, startCodeSelection, cancelCodeSelection, generateCodes, addProduct,
    openResellers, openPriceList, downloadPriceList, adjustStock, saveStockAdjustment,
    toggleCatalog, printBarcode, publishFacebook, deleteProduct, createProductFromScan,
    editProduct, retryImageCleanup,
  ] = handlers;
  const actionHandlers: MobileStockActionHandlers = {
    startCodeSelection, cancelCodeSelection, generateCodes, addProduct, openResellers,
    openPriceList, downloadPriceList, adjustStock, toggleCatalog,
    printBarcode, publishFacebook, deleteProduct, createProductFromScan, editProduct,
    retryImageCleanup,
  };
  const onAction = useCallback(
    (action: Parameters<typeof dispatchMobileStockAction>[0]) => dispatchMobileStockAction(action, actionHandlers),
    // `handlers` are callbacks over the current Stock state and are intentionally refreshed each render.
    [handlers],
  );

  return <MobileStockExperience
    products={products}
    visibleHoldingsByProduct={visibleHoldingsByProduct}
    owners={owners}
    ownersById={ownersById}
    operableInventoryOwnerIds={operableInventoryOwnerIds}
    holdingsEnabled={holdingsEnabled}
    loading={loading}
    canWrite={canWrite}
    canDelete={canDelete}
    catalogSavingIds={catalogSavingIds}
    restockProductIds={restockProductIds}
    categories={categories}
    selectedIds={selectedIds}
    selectingForCodes={selectingForCodes}
    bulkGenerating={bulkGenerating}
    pendingImageCleanupCount={pendingImageCleanupCount}
    imageCleanupRetrying={imageCleanupRetrying}
    restockCount={restockCount}
    onToggleSelect={onToggleSelect}
    onAction={onAction}
    onSaveStockAdjustment={saveStockAdjustment}
  />;
}
