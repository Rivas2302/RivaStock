export function failedStorageCleanupPaths(
  paths: string[],
  results: PromiseSettledResult<void>[],
): string[] {
  return paths.filter((_, index) => results[index]?.status === 'rejected');
}
