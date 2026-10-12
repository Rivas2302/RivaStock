export function pageBounds(total: number, requestedPage: number, pageSize = 50) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  return { page, pages, start: page * pageSize, end: Math.min(total, (page + 1) * pageSize) };
}
