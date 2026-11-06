import { describe,it,expect,vi } from 'vitest';
vi.mock('./supabase', () => ({supabase:{}}));
import { composeGroupPublicationText,groupPublicationText,initialPublication,validatePublication,normalizeGroupUrl,deviceConnected,validateGroupSelection,deliveryCandidate,deliveryLabel,type FacebookDelivery } from './facebookPublications';
import type { Product } from '../types';
import { facebookAdapter,validateFacebookDestination,fetchPublicationPhotos } from '../../extensions/facebook/adapter.js';
import { readFileSync } from 'node:fs';
const product = {name:'Silla',description:'Nueva',salePrice:1200,images:['https://test/a.jpg','https://test/b.jpg'],imageUrl:'https://test/a.jpg'} as Product;
describe('Facebook publication preparation',() => {
  it('copies product data without changing the catalogue and preserves photo order',() => {
    const content=initialPublication(product);
    content.photos.reverse(); content.title='Publicación';
    expect(product.name).toBe('Silla'); expect(product.images[0]).toBe('https://test/a.jpg');
    expect(content.photos).toHaveLength(2);
    expect(validatePublication({...content,location:'BA',category:'Muebles'},true,[])).toBeNull();
    expect(validatePublication({...content,photos:[],location:'BA',category:'Muebles'},true,[])).toContain('1 y 10 fotos');
    expect(validatePublication({...content,location:'BA',category:'Muebles'},false,[])).toMatch('grupo');
    expect(validatePublication({...content,price:NaN},true,[])).toMatch('precio');
    expect(validatePublication({...content,location:'BA',category:'Muebles'},true,[],true,1200)).toBeNull();
    expect(validatePublication({...content,price:1201,location:'BA',category:'Muebles'},true,[],true,1200)).toContain('coincidir con el precio');
  });
  it('uses the reviewed group text override and appends exact product fields to an AI draft', () => {
    const content={...initialPublication(product),price:1200,condition:'good' as const,location:'Buenos Aires',category:'Hogar'};
    const composed=composeGroupPublicationText(content,'Una opción práctica para el escritorio.');
    expect(composed).toContain('Una opción práctica para el escritorio.');
    expect(composed).toContain('Precio: $1.200');
    expect(groupPublicationText({...content,groupText:composed})).toBe(composed);
    const rebased=groupPublicationText({...content,groupText:composed,price:1500,location:'Rosario'});
    expect(rebased).toContain('Precio: $1.500');
    expect(rebased).toContain('Ubicación: Rosario');
    expect(rebased.match(/Precio:/g)).toHaveLength(1);
  });
  it('blocks policy-violating copy in the extension before touching Facebook', async () => {
    await expect(facebookAdapter.prepare({destination:{mechanism:'marketplace',url:'https://www.facebook.com/marketplace/create/item'},content:{title:'CABLE USB CARGA RAPIDA',description:'',price:1200,photos:[]}}, {url:'https://example.supabase.co'})).rejects.toThrow('mayúsculas sostenidas');
  });
  it('restricts group destinations and detects a stale or revoked computer',() => {
    expect(normalizeGroupUrl('https://www.facebook.com/groups/123/?ref=test')).toBe('https://www.facebook.com/groups/123');
    for(const url of ['https://evil.test/groups/123','https://www.facebook.com.evil.test/groups/123','http://www.facebook.com/groups/123','https://www.facebook.com/groups/123/posts/5']) expect(() => normalizeGroupUrl(url)).toThrow();
    const now=Date.now();
    expect(deviceConnected({id:'1',name:'PC',last_seen_at:new Date(now).toISOString(),revoked_at:null},now)).toBe(true);
    expect(deviceConnected({id:'1',name:'PC',last_seen_at:new Date(now-180000).toISOString(),revoked_at:null},now)).toBe(false);
  });
  it('validates group URLs before runtime composer checks without cookie or broad tab access',async () => {
    expect(facebookAdapter.ready).toBe(true);
    expect(() => validateFacebookDestination({mechanism:'group_direct',url:'https://www.facebook.com/groups/unknown'})).not.toThrow();
    expect(() => validateFacebookDestination({mechanism:'group_direct',url:'https://www.facebook.com/groups/PicoVendedeTodo'})).not.toThrow();
    await expect(fetchPublicationPhotos({photos:['https://evil.test/photo.jpg']},'https://test.supabase.co')).rejects.toThrow('almacenamiento');
    const manifest=JSON.parse(readFileSync('extensions/facebook/manifest.json','utf8'));
    expect(manifest.permissions).toEqual(['storage','alarms','scripting']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.externally_connectable).toEqual({matches:['https://rivastock.vercel.app/*']});
  });
});

const base:FacebookDelivery={id:'d1',status:'attention',message:null,evidence_url:null,submitted_at:'2026-01-01T00:00:00Z',destination:{name:'G',url:'https://www.facebook.com/groups/123',mechanism:'group_direct'}};
const attempt=(events:any[])=>({id:'a1',started_at:'2026-01-01T00:00:00Z',lease_expires_at:'2026-01-01T01:00:00Z',authorized_at:'2026-01-01T00:01:00Z',finished_at:null,outcome:null,last_error_code:null,events});
const candidateEvent=(url:string)=>({type:'candidate',created_at:'2026-01-01T00:02:00Z',data:{url}});
it('deliveryCandidate returns null when no attempts',()=>{expect(deliveryCandidate(base)).toBeNull();});
it('deliveryCandidate returns validated URL from authorized attempt',()=>{
 const d={...base,facebook_delivery_attempts:[attempt([candidateEvent('https://www.facebook.com/groups/123/posts/987')])]};
 expect(deliveryCandidate(d)).toBe('https://www.facebook.com/groups/123/posts/987');
});
it('deliveryCandidate returns null for foreign origin URL',()=>{
 const d={...base,facebook_delivery_attempts:[attempt([candidateEvent('https://evil.test/groups/123/posts/987')])]};
 expect(deliveryCandidate(d)).toBeNull();
});
it('deliveryCandidate returns null when recovery_required',()=>{
 const d={...base,recovery_required:true,facebook_delivery_attempts:[attempt([candidateEvent('https://www.facebook.com/groups/123/posts/987')])]};
 expect(deliveryCandidate(d)).toBeNull();
});
it('labels pending results with captured IDs for automatic tracking',()=>{
 const d={...base,status:'pending_approval',facebook_delivery_attempts:[{...attempt([]),pending_post_id:'987'}]};
 expect(deliveryLabel(d)).toContain('seguimiento automático');
});
it('labels tracked rejections as not approved',()=>{
 const d={...base,status:'attention',issue:{kind:'facebook_not_approved',message:'No aprobada'}};
 expect(deliveryLabel(d)).toBe('No aprobada');
});
it('rejects duplicate group identities, missing destinations and excessive selections',()=>{
 const groups=[{id:'a',name:'Same',url:'https://www.facebook.com/groups/PicoVendedeTodo',mechanism:'group_direct' as const},{id:'b',name:'Different label',url:'https://www.facebook.com/groups/710102875717376',mechanism:'group_direct' as const},{id:'c',name:'Same',url:'https://www.facebook.com/groups/123',mechanism:'group_direct' as const}];
 expect(validateGroupSelection(groups,['a','b'])).toBeNull(); // different URL forms: alias dedup is server-side via facebook_group_key
 expect(validateGroupSelection(groups,['a','a'])).toContain('más de una vez'); // same group selected twice
 expect(validateGroupSelection(groups,['a','c'])).toBeNull();
 expect(validateGroupSelection(groups,['missing'])).toContain('ya no está disponible');
 expect(validateGroupSelection(groups,Array(21).fill('a'))).toContain('20');
});
it('rejects groups that prohibit sales or are paused for safety',()=>{
 const restricted={id:'restricted',name:'No ventas',url:'https://www.facebook.com/groups/789',mechanism:'group_direct' as const,allows_sales:false};
 const paused={id:'paused',name:'Pausado',url:'https://www.facebook.com/groups/987',mechanism:'group_direct' as const,safety_paused:true,safety_pause_reason:'Dos rechazos recientes.'};
 expect(validateGroupSelection([restricted],['restricted'])).toContain('no permiten ventas');
 expect(validateGroupSelection([paused],['paused'])).toBe('Dos rechazos recientes.');
});
