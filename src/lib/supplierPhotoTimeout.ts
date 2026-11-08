export const SUPPLIER_PHOTO_TIMEOUT_MS = {
  worker: 30_000,
  catalogDownload: 15_000,
  extensionResponse: 10_000,
  recognition: 20_000,
  terminate: 3_000,
} as const;

export type SupplierPhotoOperation = keyof typeof SUPPLIER_PHOTO_TIMEOUT_MS;

export class SupplierPhotoOperationTimeout extends Error {
  constructor(readonly operation: SupplierPhotoOperation) {
    super('supplier-photo-operation-timeout');
    this.name = 'SupplierPhotoOperationTimeout';
  }
}

export async function withSupplierPhotoTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName: SupplierPhotoOperation,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SupplierPhotoOperationTimeout(operationName)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function isSupplierPhotoOperationTimeout(error: unknown): error is SupplierPhotoOperationTimeout {
  return error instanceof SupplierPhotoOperationTimeout;
}
