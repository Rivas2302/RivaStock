export function getSupplierAssetStoragePath(imageUrl: string, projectUrl: string): string | null {
  try {
    const rawPath = imageUrl.split(/[?#]/, 1)[0];
    const rawBucketMarker = '/storage/v1/object/public/assets/';
    const rawMarkerIndex = rawPath.toLocaleLowerCase('en-US').indexOf(rawBucketMarker);
    if (rawMarkerIndex < 0) return null;
    const rawSegments = rawPath.slice(rawMarkerIndex + rawBucketMarker.length).split('/').map(part => decodeURIComponent(part));
    if (rawSegments.some(part => part === '.' || part === '..')) return null;
    const image = new URL(imageUrl);
    const project = new URL(projectUrl);
    const prefix = '/storage/v1/object/public/assets/';
    if (image.protocol !== 'https:' || image.origin !== project.origin || !image.pathname.startsWith(prefix)) return null;
    const encodedPath = image.pathname.slice(prefix.length);
    const path = encodedPath.split('/').map(part => decodeURIComponent(part)).join('/');
    if (!path || path.split('/').some(part => part === '.' || part === '..')) return null;
    return path;
  } catch {
    return null;
  }
}
