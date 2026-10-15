import { describe,it,expect,vi } from 'vitest';
vi.mock('./supabase', () => ({supabase:{}}));
import { initialPublication,validatePublication,normalizeGroupUrl,deviceConnected,validateGroupSelection } from './facebookPublications';
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
    expect(validatePublication({...content,location:'BA',category:'Muebles'},false,[])).toMatch('grupo');
    expect(validatePublication({...content,price:NaN},true,[])).toMatch('precio');
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

it('rejects duplicate group identities, missing destinations and excessive selections',()=>{
 const groups=[{id:'a',name:'Same',url:'https://www.facebook.com/groups/PicoVendedeTodo',mechanism:'group_direct' as const},{id:'b',name:'Different label',url:'https://www.facebook.com/groups/710102875717376',mechanism:'group_direct' as const},{id:'c',name:'Same',url:'https://www.facebook.com/groups/123',mechanism:'group_direct' as const}];
 expect(validateGroupSelection(groups,['a','b'])).toContain('más de una vez');
 expect(validateGroupSelection(groups,['a','c'])).toBeNull();
 expect(validateGroupSelection(groups,['missing'])).toContain('ya no está disponible');
 expect(validateGroupSelection(groups,Array(21).fill('a'))).toContain('20');
});
