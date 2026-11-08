import { createSupplierPhotoOcrWorker, inspectSupplierPhotoBrand } from '../../src/lib/supplierPrivacy';
import { SUPPLIER_PHOTO_TIMEOUT_MS, withSupplierPhotoTimeout } from '../../src/lib/supplierPhotoTimeout';

declare global {
  interface Window {
    __I43_REAL_OCR_RESULT__?: {
      marked: boolean;
      clean: boolean;
      listText: string;
      fakeWorkerInstalled: boolean;
    } | { error: string };
    __I43_RUN_REAL_PROVIDER_OCR__?: (photos: Array<{ provider: string; path: string }>) => Promise<Array<{ provider: string; status: 'analyzed' | 'failed'; flagged?: boolean }>>;
  }
}

async function renderTextImage(lines: string[]): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1800;
  canvas.height = Math.max(320, lines.length * 110 + 120);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas OCR fixture could not be rendered.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111111';
  context.font = 'bold 72px Arial';
  context.textBaseline = 'top';
  lines.forEach((line, index) => context.fillText(line, 60, 45 + index * 110));
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Could not create OCR image pixels.'));
  }, 'image/png'));
}

async function runRealOcr() {
  if ((window as Window & { __RIVASTOCK_SUPPLIER_OCR_WORKER_FACTORY__?: unknown })
    .__RIVASTOCK_SUPPLIER_OCR_WORKER_FACTORY__) throw new Error('A fake OCR worker must not be installed.');

  const worker = await createSupplierPhotoOcrWorker();
  try {
    const indicators = { supplierName: 'Proveedor', catalogUrl: 'https://proveedor.com.ar' };
    const marked = await inspectSupplierPhotoBrand(
      await renderTextImage(['WWW.PROVEEDOR.COM.AR']), indicators, worker,
    );
    const clean = await inspectSupplierPhotoBrand(
      await renderTextImage(['CABLE USB C']), indicators, worker,
    );
    const listText = (await worker.recognize(await renderTextImage([
      'CABLE USB C - $ 2.660',
      'AURICULAR BLUETOOTH - $ 3.850',
    ]))).data.text;
    window.__I43_REAL_OCR_RESULT__ = {
      marked: marked.flagged,
      clean: clean.flagged,
      listText,
      fakeWorkerInstalled: false,
    };
  } finally {
    await worker.terminate();
  }
}

window.__I43_RUN_REAL_PROVIDER_OCR__ = async photos => {
  if (window.__RIVASTOCK_SUPPLIER_OCR_WORKER_FACTORY__) throw new Error('A fake OCR worker must not be installed.');
  const worker = await withSupplierPhotoTimeout(createSupplierPhotoOcrWorker, SUPPLIER_PHOTO_TIMEOUT_MS.worker, 'worker');
  const results: Array<{ provider: string; status: 'analyzed' | 'failed'; flagged?: boolean }> = [];
  try {
    for (const photo of photos) {
      try {
        const response = await withSupplierPhotoTimeout(
          () => fetch(photo.path, { credentials: 'omit', cache: 'no-store' }),
          SUPPLIER_PHOTO_TIMEOUT_MS.catalogDownload,
          'catalogDownload',
        );
        if (!response.ok) throw new Error('Photo is unavailable.');
        const image = await response.blob();
        const providerUrl = photo.provider === 'Babaji' ? 'https://babaji.com.ar/' : 'https://mrtecno.com.ar/';
        const detection = await withSupplierPhotoTimeout(
          () => inspectSupplierPhotoBrand(image, { supplierName: photo.provider, catalogUrl: providerUrl }, worker),
          SUPPLIER_PHOTO_TIMEOUT_MS.recognition,
          'recognition',
        );
        results.push({ provider: photo.provider, status: 'analyzed', flagged: detection.flagged });
      } catch {
        results.push({ provider: photo.provider, status: 'failed' });
      }
    }
  } finally {
    await withSupplierPhotoTimeout(() => worker.terminate(), SUPPLIER_PHOTO_TIMEOUT_MS.terminate, 'terminate')
      .catch(() => undefined);
  }
  return results;
};

runRealOcr().catch(error => {
  window.__I43_REAL_OCR_RESULT__ = { error: error instanceof Error ? error.message : 'OCR failed.' };
});
