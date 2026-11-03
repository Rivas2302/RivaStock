export function getCatalogSharePath(slug: string, productId?: string | null): string {
  const encodedSlug = encodeURIComponent(slug);
  return productId
    ? `/p/${encodedSlug}/${encodeURIComponent(productId)}`
    : `/p/${encodedSlug}`;
}

export function getCatalogShareUrl(origin: string, slug: string, productId?: string | null): string {
  return new URL(getCatalogSharePath(slug, productId), origin).toString();
}
