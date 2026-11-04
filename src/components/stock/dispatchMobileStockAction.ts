import type { MobileStockAction } from './MobileStockExperience';
import type { Product } from '../../types';

export interface MobileStockActionHandlers {
  startCodeSelection: () => void;
  cancelCodeSelection: () => void;
  generateCodes: () => void;
  addProduct: () => void;
  openResellers: () => void;
  openPriceList: () => void;
  downloadPriceList: () => void;
  adjustStock: (product: Product) => void;
  toggleCatalog: (product: Product) => void;
  printBarcode: (product: Product) => void;
  publishFacebook: (product: Product) => void;
  deleteProduct: (product: Product) => Promise<boolean>;
  createProductFromScan: (barcode: string) => void;
  editProduct: (product: Product) => void;
  retryImageCleanup: () => void;
}

export function dispatchMobileStockAction(
  action: MobileStockAction,
  handlers: MobileStockActionHandlers,
): void | Promise<boolean> {
  switch (action.type) {
    case 'start-code-selection': handlers.startCodeSelection(); break;
    case 'cancel-code-selection': handlers.cancelCodeSelection(); break;
    case 'generate-codes': handlers.generateCodes(); break;
    case 'add-product': handlers.addProduct(); break;
    case 'open-resellers': handlers.openResellers(); break;
    case 'open-price-list': handlers.openPriceList(); break;
    case 'download-price-list': handlers.downloadPriceList(); break;
    case 'adjust-stock': handlers.adjustStock(action.product); break;
    case 'toggle-catalog': handlers.toggleCatalog(action.product); break;
    case 'print-barcode': handlers.printBarcode(action.product); break;
    case 'publish-facebook': handlers.publishFacebook(action.product); break;
    case 'delete-product': return handlers.deleteProduct(action.product);
    case 'create-product-from-scan': handlers.createProductFromScan(action.barcode); break;
    case 'edit-product': handlers.editProduct(action.product); break;
    case 'retry-image-cleanup': handlers.retryImageCleanup(); break;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
