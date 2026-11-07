export function shouldNotifyPublicOrderOwner(hostname: string): boolean {
  return hostname.toLowerCase() === 'rivastock.vercel.app';
}
