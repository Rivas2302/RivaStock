import type { Product } from '../types';
import { supabase } from './supabase';
import { marketplaceConditions } from '../../extensions/facebook/marketplace-contract.js';

export interface PublicationContent {
  title: string; description: string; price: number; photos: string[];
  location: string; category: string; condition: 'new' | 'like_new' | 'good' | 'fair';
  groupText?: string;
}
export function groupPublicationText(content: PublicationContent): string {
  return `${content.title}\n\n${content.description}\n\nPrecio: ARS ${content.price.toFixed(2)}\nEstado: ${marketplaceConditions[content.condition]}\nUbicación: ${content.location}\nCategoría: ${content.category}`;
}
export interface FacebookGroup { id: string; name: string; url: string; mechanism: 'group_direct' }
export interface FacebookDevice { id: string; name: string; last_seen_at: string | null; revoked_at: string | null }
export interface FacebookDelivery {
  id: string; status: string; message: string | null; evidence_url: string | null;
  destination: { name: string; url: string; mechanism: string };
}
export interface FacebookPublication { id: string; content: PublicationContent; approved_at: string; facebook_deliveries: FacebookDelivery[] }
export const publicationStatus: Record<string, string> = {
  pending: 'Pendiente', running: 'En ejecución', submitted: 'Enviado', published: 'Publicado',
  pending_approval: 'Pendiente de aprobación', attention: 'Requiere atención', cancelled: 'Cancelado',
};
export function productPhotos(product: Product): string[] {
  return [...new Set([...(product.images ?? []), product.imageUrl].filter((url): url is string => Boolean(url)))];
}
export function initialPublication(product: Product): PublicationContent {
  return { title: product.name, description: product.description ?? '', price: product.salePrice,
    photos: productPhotos(product).slice(0, 10), location: '', category: '', condition: 'new' };
}
export function validatePublication(content: PublicationContent, marketplace: boolean, groups: string[]): string | null {
  if (!content.title.trim() || content.title.length > 100) return 'Ingresá un título de hasta 100 caracteres.';
  if (!content.description.trim() || content.description.length > 5000) return 'Ingresá una descripción de hasta 5000 caracteres.';
  if (!Number.isFinite(content.price) || content.price <= 0 || content.price > 999999999) return 'Ingresá un precio mayor a cero.';
  if (!content.location.trim() || !content.category.trim()) return 'Completá ubicación y categoría de Facebook.';
  if (!['new','like_new','good','fair'].includes(content.condition)) return 'Elegí una condición válida.';
  if (!content.photos.length || content.photos.length > 10 || new Set(content.photos).size !== content.photos.length) return 'Seleccioná entre 1 y 10 fotos distintas.';
  if (content.photos.some(url => !url.startsWith('https://'))) return 'Las fotos deben tener una dirección HTTPS.';
  if (!marketplace && !groups.length) return 'Elegí Marketplace o al menos un grupo.';
  return null;
}
export function normalizeGroupUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.hostname !== 'www.facebook.com' || !/^\/groups\/[A-Za-z0-9._-]+\/?$/.test(url.pathname) || url.username || url.password || url.port) {
    throw new Error('Usá la URL del grupo: https://www.facebook.com/groups/nombre-o-id');
  }
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}
export function deviceConnected(device: FacebookDevice, now = Date.now()): boolean {
  const seen = Date.parse(device.last_seen_at ?? '');
  return !device.revoked_at && Number.isFinite(seen) && now - seen < 150000 && seen <= now;
}
export async function facebookRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function loadFacebookPublicationData(productId: string) {
  const results = await Promise.all([
    supabase.from('facebook_groups').select('id,name,url,mechanism').order('name'),
    supabase.from('facebook_devices').select('id,name,last_seen_at,revoked_at').is('revoked_at', null),
    supabase.from('facebook_publications').select('id,content,approved_at,facebook_deliveries(*)').eq('product_id', productId).order('approved_at', { ascending: false }).limit(20),
  ]);
  for (const result of results) if (result.error) throw new Error('No se pudo cargar Facebook. Verificá la conexión y que esté instalada la migración 0049.');
  return { groups: results[0].data as FacebookGroup[], devices: results[1].data as FacebookDevice[], publications: results[2].data as unknown as FacebookPublication[] };
}
