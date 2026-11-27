export function getCatalogSharePath(slug: string, productId?: string | null): string {
  const encodedSlug = encodeURIComponent(slug);
  return productId
    ? `/catalogo/${encodedSlug}/${encodeURIComponent(productId)}`
    : `/catalogo/${encodedSlug}`;
}

export function getCatalogShareUrl(origin: string, slug: string, productId?: string | null): string {
  return new URL(getCatalogSharePath(slug, productId), origin).toString();
}
