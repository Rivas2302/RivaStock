import { lazy, Suspense } from 'react';
import RequirePermission from '../components/RequirePermission';

const ProductPhotosPage = lazy(() => import('./ProductPhotos'));

export default function ProductPhotosRoute() {
  return (
    <RequirePermission module="stock" action="read">
      <Suspense fallback={(
        <div role="status" className="flex min-h-64 items-center justify-center text-sm text-slate-500">
          Cargando fotos de productos…
        </div>
      )}>
        <ProductPhotosPage />
      </Suspense>
    </RequirePermission>
  );
}
