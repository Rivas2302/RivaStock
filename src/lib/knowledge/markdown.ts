export async function renderMarkdownSafe(md: string): Promise<string> {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([
    import('marked'),
    import('dompurify'),
  ]);

  return DOMPurify.sanitize(await marked.parse(md));
}
