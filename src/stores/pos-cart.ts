import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Product, PaymentMethod } from '../types';

export interface PosCartItem {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  stockAtAdd: number;
  lineDiscount: number;
}

interface State {
  items: PosCartItem[];
  paymentMethod: PaymentMethod;
  globalAdjustment: number;
  creditCustomerId: string | null;
  clientName: string;
}

interface Actions {
  addProduct: (product: Pick<Product, 'id' | 'name' | 'salePrice' | 'stock'>) => void;
  incrementItem: (productId: string, delta: number) => void;
  setItemQuantity: (productId: string, qty: number) => void;
  setItemPrice: (productId: string, price: number) => void;
  setItemLineDiscount: (productId: string, discount: number) => void;
  removeItem: (productId: string) => void;
  setPaymentMethod: (m: PaymentMethod) => void;
  setGlobalAdjustment: (n: number) => void;
  setCreditCustomerId: (id: string | null) => void;
  setClientName: (s: string) => void;
  clear: () => void;
}

export type PosCartStore = State & Actions;

const initial: State = {
  items: [],
  paymentMethod: 'Efectivo',
  globalAdjustment: 0,
  creditCustomerId: null,
  clientName: '',
};

export const usePosCart = create<PosCartStore>()(
  persist(
    (set) => ({
      ...initial,
      addProduct: (product) => set((s) => {
        const existing = s.items.find((it) => it.productId === product.id);
        if (existing) {
          return {
            items: s.items.map((it) =>
              it.productId === product.id ? { ...it, quantity: it.quantity + 1 } : it,
            ),
          };
        }
        return {
          items: [
            ...s.items,
            {
              productId: product.id,
              productName: product.name,
              unitPrice: Math.round(product.salePrice * 100) / 100,
              quantity: 1,
              stockAtAdd: product.stock,
              lineDiscount: 0,
            },
          ],
        };
      }),
      incrementItem: (productId, delta) => set((s) => ({
        items: s.items
          .map((it) => it.productId === productId ? { ...it, quantity: Math.max(0, it.quantity + delta) } : it)
          .filter((it) => it.quantity > 0),
      })),
      setItemQuantity: (productId, qty) => set((s) => ({
        items: s.items
          .map((it) => it.productId === productId ? { ...it, quantity: Math.max(0, Math.floor(qty)) } : it)
          .filter((it) => it.quantity > 0),
      })),
      setItemPrice: (productId, price) => set((s) => ({
        items: s.items.map((it) => it.productId === productId ? { ...it, unitPrice: Math.max(0, price) } : it),
      })),
      setItemLineDiscount: (productId, discount) => set((s) => ({
        items: s.items.map((it) =>
          it.productId === productId ? { ...it, lineDiscount: Math.max(0, discount) } : it,
        ),
      })),
      removeItem: (productId) => set((s) => ({
        items: s.items.filter((it) => it.productId !== productId),
      })),
      setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
      setGlobalAdjustment: (globalAdjustment) => set({ globalAdjustment }),
      setCreditCustomerId: (creditCustomerId) => set({ creditCustomerId }),
      setClientName: (clientName) => set({ clientName }),
      clear: () => set({ ...initial }),
    }),
    {
      name: 'rivastock-pos-cart-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        items: s.items,
        paymentMethod: s.paymentMethod,
        globalAdjustment: s.globalAdjustment,
        creditCustomerId: s.creditCustomerId,
        clientName: s.clientName,
      }),
    },
  ),
);

export function calculateCartTotals(state: Pick<PosCartStore, 'items' | 'globalAdjustment'>) {
  const linesSubtotal = state.items.reduce(
    (sum, it) => sum + it.quantity * Math.max(0, it.unitPrice - it.lineDiscount),
    0,
  );
  const total = Math.max(0, linesSubtotal + state.globalAdjustment);
  const itemCount = state.items.reduce((n, it) => n + it.quantity, 0);
  return { linesSubtotal, total, itemCount };
}
