import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { Product } from '../../types';

export interface ProductThumbnailProps {
  product: Pick<Product, 'name' | 'images' | 'imageUrl'>;
  sizeClassName?: string;
}

export default function ProductThumbnail({ product, sizeClassName = 'size-10' }: ProductThumbnailProps) {
  const imageUrl = product.images?.[0] ?? product.imageUrl;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(imageUrl) && failedUrl !== imageUrl;

  return (
    <span className={['inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface-muted)] text-[var(--ink-muted)]', sizeClassName].join(' ')}>
      {showImage
        ? <img src={imageUrl} alt={product.name} loading="lazy" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setFailedUrl(imageUrl ?? null)} />
        : <ImageIcon size={20} role="img" aria-label={'Sin imagen para ' + product.name} />}
    </span>
  );
}