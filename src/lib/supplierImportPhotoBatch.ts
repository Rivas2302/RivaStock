export async function processSupplierPhotoBatch<T>(
  items: T[],
  processPhoto: (item: T) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
  onFailure?: (item: T) => void,
): Promise<number> {
  let failures = 0;
  for (let index = 0; index < items.length; index++) {
    try {
      await processPhoto(items[index]);
    } catch {
      failures++;
      onFailure?.(items[index]);
    }
    onProgress?.(index + 1, items.length);
  }
  return failures;
}
