import type { Product } from '../types';
import { supabase } from './supabase';
import { formatCurrency } from './utils';
import { marketplaceConditions } from '../../extensions/facebook/marketplace-contract.js';

export interface PublicationContent {
  title: string; description: string; price: number; photos: string[];
  location: string; category: string; condition: 'new' | 'like_new' | 'good' | 'fair';
  groupText?: string;
}
export function groupPublicationText(content: PublicationContent): string {
  return `${content.title}\n\n${content.description}\n\nPrecio: ${formatCurrency(content.price).replace(/\s/g,'')}\nEstado: ${marketplaceConditions[content.condition]}\nUbicación: ${content.location}\nCategoría: ${content.category}`;
}
export interface FacebookGroup { id: string; name: string; url: string; mechanism: 'group_direct'; member_count_text?: string|null; member_count_updated_at?: string|null }
export function groupCompatibility(group:FacebookGroup):string|null {
  if(group.mechanism!=='group_direct')return 'Este flujo de grupo no está implementado.';
  try{normalizeGroupUrl(group.url);return null;}catch{return 'Falta una URL válida del grupo. No se puede identificar el destino por su nombre.';}
}
export function validateGroupSelection(groups:FacebookGroup[],selected:string[]):string|null {
  if(selected.length>20)return 'Podés elegir hasta 20 grupos.';
  const urls=new Set<string>();
  for(const id of selected){const group=groups.find(item=>item.id===id);if(!group)return 'Un grupo seleccionado ya no está disponible. Actualizá y revisá los destinos.';const reason=groupCompatibility(group);if(reason)return reason;const url=normalizeGroupUrl(group.url).replace(/\/PicoVendedeTodo$/,'/710102875717376');if(urls.has(url))return 'El mismo grupo está seleccionado más de una vez. Revisá sus URLs.';urls.add(url);}
  return null;
}
export interface FacebookDevice { id: string; name: string; last_seen_at: string | null; revoked_at: string | null; queue_enabled?: boolean; queue_command_at?: string | null; execution_state?: 'active' | 'paused' | 'unknown'; current_activity?: string | null; worker_protocol?:number; extension_version?:string|null; last_error_code?:string|null }
export interface FacebookAttempt {id:string;started_at:string;lease_expires_at:string;authorized_at:string|null;finished_at:string|null;outcome:string|null;last_error_code:string|null;events?:{type:string;created_at:string;data:{new_url?:string;new_status?:string;url?:string;decision?:string}}[]}
export const facebookDeliveryFields='*,facebook_delivery_attempts!facebook_delivery_attempts_delivery_id_fkey(id,started_at,lease_expires_at,authorized_at,finished_at,outcome,last_error_code,events:facebook_delivery_attempt_events(type,created_at,data))';
export async function refreshFacebookDeliveryStates(){
 const {error}=await supabase.rpc('refresh_facebook_delivery_states');
 if(error&&!['PGRST202','42883'].includes(error.code))throw new Error('No se pudo comprobar si hay ejecuciones interrumpidas.');
}
export interface FacebookDelivery {
  recovery_required?:boolean;active_attempt_id?:string|null;facebook_delivery_attempts?:FacebookAttempt[];
  id: string; status: string; message: string | null; evidence_url: string | null;
  issue?: {kind:string;message:string;candidates?:{title:string;summary:string;status:string|null;url:string|null}[];fields?:{label:string;supported?:boolean;options?:{value:string;label:string}[]|null}[]}|null;
  resolution?: {action:string;url?:string|null;observedStatus?:string|null}|null;
  submitted_at?: string | null;
  destination_key?: string;
  execution_timing?: {source?:string;approval_to_claim_ms?:number;receipt_to_preparation_ms?:number;claim_rpc_ms?:number;photos_ms?:number;navigation_ms?:number;preparation_ms?:number};
  destination: { name: string; url: string; mechanism: string };
}
export interface FacebookPublication { id: string; product_id?: string; repeat_of?: string | null; content: PublicationContent & {selection?:{marketplace:boolean;groups:string[]}}; approved_at: string; facebook_deliveries: FacebookDelivery[] }
export const publicationStatus: Record<string, string> = {
  pending: 'Pendiente', running: 'En ejecución', submitted: 'Enviado', published: 'Publicado',
  pending_approval: 'Pendiente de aprobación', attention: 'Requiere atención', cancelled: 'Cancelado',
};
export function deliveryState(delivery:FacebookDelivery) {
  if(delivery.recovery_required)return 'unknown';
  if(delivery.status==='attention') return delivery.submitted_at===null?'failed':'unknown';
  return delivery.status;
}
export function deliveryLabel(delivery:FacebookDelivery) {
  const state=deliveryState(delivery);
  if(delivery.recovery_required)return 'Evidencia nueva: revisión requerida';
  if(delivery.resolution?.action==='existing')return 'Anuncio vinculado';
  if(delivery.issue?.kind==='marketplace_conflict')return 'Decisión requerida';
  return state==='failed'?'Preparación fallida':state==='unknown'?'Resultado desconocido':publicationStatus[state]??state;
}
export function publicationBlock(publications:FacebookPublication[],marketplace:boolean,groups:string[],knownGroups:FacebookGroup[]=[]) {
  const key=(url:string)=>url.replace(/\/$/,'').replace(/\/PicoVendedeTodo$/,'/710102875717376');
  const urls=new Set(knownGroups.filter(group=>groups.includes(group.id)).map(group=>key(group.url)));
  const selected=(d:FacebookDelivery)=>d.destination.mechanism==='marketplace'?marketplace:urls.has(key(d.destination.url??''))||(d.destination_key?groups.includes(d.destination_key):groups.length>0);
  // Older responses without destination keys treat group jobs conservatively.
  const jobs=publications.flatMap(p=>p.facebook_deliveries).filter(selected);
  if(jobs.some(d=>['pending','running'].includes(d.status)))return 'Ya hay un trabajo pendiente o en ejecución para este destino. Consultá su historial.';
  if(jobs.some(d=>deliveryState(d)==='unknown'))return 'Hay un resultado desconocido. Revisá Facebook y registrá la revisión en el historial antes de crear otro envío.';
  return null;
}
export function safeFacebookEvidence(delivery:FacebookDelivery) {
  const url=delivery.evidence_url;
  if(!url)return null;
  try {
    const parsed=new URL(url);
    if(parsed.origin!=='https://www.facebook.com'||parsed.username||parsed.password||parsed.search||parsed.hash)return null;
    return /^\/(marketplace\/item\/\d+|groups\/[A-Za-z0-9._-]+\/(posts|permalink)\/\d+)\/?$/.test(parsed.pathname)?url:null;
  }catch{return null;}
}
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
  await refreshFacebookDeliveryStates();
  const results = await Promise.all([
    supabase.from('facebook_groups').select('id,name,url,mechanism,member_count_text,member_count_updated_at').order('name'),
    supabase.from('facebook_devices').select('id,name,last_seen_at,revoked_at,queue_enabled,execution_state,current_activity,worker_protocol,extension_version,last_error_code').is('revoked_at', null),
    supabase.from('facebook_publications').select('id,product_id,repeat_of,content,approved_at,facebook_deliveries('+facebookDeliveryFields+')').eq('product_id', productId).order('approved_at', { ascending: false }).order('id',{ascending:false}),
  ]);
  for (const result of results) if (result.error) throw new Error('No se pudo cargar Publicaciones. Verificá la conexión y las migraciones de Automatizaciones.');
  return { groups: results[0].data as FacebookGroup[], devices: results[1].data as FacebookDevice[], publications: results[2].data as unknown as FacebookPublication[] };
}
