import { Sale } from '../types';

type SaleLineItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
};

export function isPendingSaleStatus(status: Sale['status']) {
  return status === 'Pendiente' || status === 'No Pagado';
}

export function hasDerivedSaleItems(sale: Pick<Sale, 'items'>) {
  return Array.isArray(sale.items) && sale.items.length > 0;
}

export function isPosSale(sale: Pick<Sale, 'source'>) {
  return sale.source === 'pos';
}

export function isQuoteSale(sale: Pick<Sale, 'source'>) {
  return sale.source === 'quote';
}

export type SalesPageEditPlan =
  | { allowed: true; rpc: 'edit_sale' | 'edit_pos_sale' }
  | { allowed: false; reason: string };

export function getSalesPageEditPlan(
  sale: Pick<Sale, 'source' | 'items'>,
): SalesPageEditPlan {
  if (isQuoteSale(sale)) {
    return {
      allowed: false,
      reason: 'Las ventas creadas desde presupuestos se editan desde el presupuesto original.',
    };
  }

  if (isPosSale(sale)) {
    if (Array.isArray(sale.items) && sale.items.length > 1) {
      return {
        allowed: false,
        reason: 'Esta venta POS tiene varios productos. Para conservar sus lineas y stock, elimina la venta y volve a registrarla desde el POS.',
      };
    }
    return { allowed: true, rpc: 'edit_pos_sale' };
  }

  return { allowed: true, rpc: 'edit_sale' };
}

export function getSaleLineItems(
  sale: Pick<Sale, 'productId' | 'productName' | 'quantity' | 'unitPrice' | 'items'>
): SaleLineItem[] {
  if (hasDerivedSaleItems(sale)) {
    return sale.items!.map(item => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.price,
    }));
  }

  return [{
    productId: sale.productId,
    productName: sale.productName,
    quantity: sale.quantity,
    unitPrice: sale.unitPrice,
  }];
}

export function aggregateProductQuantities(items: Array<Pick<SaleLineItem, 'productId' | 'quantity'>>) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.productId] = (acc[item.productId] || 0) + item.quantity;
    return acc;
  }, {});
}

export function getSaleDisplayQuantity(
  sale: Pick<Sale, 'productId' | 'productName' | 'quantity' | 'unitPrice' | 'items'>
) {
  return getSaleLineItems(sale).reduce((sum, item) => sum + item.quantity, 0);
}

export function getSaleCashFlowDescription(
  sale: Pick<Sale, 'productId' | 'productName' | 'quantity' | 'unitPrice' | 'items'>
) {
  const items = getSaleLineItems(sale);
  if (items.length === 1) {
    const [item] = items;
    return `Venta: ${item.productName} x${item.quantity}`;
  }

  return `Venta: ${sale.productName}`;
}
