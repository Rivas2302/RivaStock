import { useEffect, useRef } from 'react';
import type { Product } from '../../types';

interface Props {
  productId: string;
  products: Product[];
  loading: boolean;
  onEditProduct: (product: Product) => void;
}

export default function DesktopProductEditorRoute({ productId, products, loading, onEditProduct }: Props) {
  const openedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading || openedIdRef.current === productId) return;
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    openedIdRef.current = productId;
    onEditProduct(product);
  }, [loading, onEditProduct, productId, products]);

  return null;
}
