export function platformBusinessDisplayName(businessName: string | null | undefined, email: string): string {
  const name = typeof businessName === 'string' ? businessName.trim() : '';
  return name || `Sin nombre · ${email}`;
}
