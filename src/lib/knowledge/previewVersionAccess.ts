export interface VersionPreviewAccess<T> {
  versionId: string;
  value: T;
}

export function getPreviewVersionAccess<T>(
  access: VersionPreviewAccess<T> | null,
  previewVersionId: string | null | undefined,
): T | null {
  if (!access || !previewVersionId || access.versionId !== previewVersionId) return null;
  return access.value;
}
