import {it,expect,vi} from 'vitest';
vi.mock('./supabase',()=>({supabase:{}}));
import {deliveryState,publicationBlock,safeFacebookEvidence,type FacebookDelivery,type FacebookPublication} from './facebookPublications';
const delivery:FacebookDelivery={id:'one',status:'attention',submitted_at:null,evidence_url:null,message:null,destination:{name:'Marketplace',url:'https://www.facebook.com/marketplace/create/item',mechanism:'marketplace'}};
it('distinguishes a failed preparation from unknown and explicitly confirmed outcomes',()=>{
  expect(deliveryState(delivery)).toBe('failed');expect(deliveryState({...delivery,submitted_at:'2026-10-14'})).toBe('unknown');
  expect(deliveryState({...delivery,submitted_at:undefined})).toBe('unknown');
  for(const state of ['submitted','published','pending_approval'])expect(deliveryState({...delivery,status:state})).toBe(state);
});
it('blocks unresolved selected destinations without blocking unrelated destinations',()=>{
  const history=[{facebook_deliveries:[{...delivery,submitted_at:'2026-10-14'}]}] as FacebookPublication[];
  expect(publicationBlock(history,true,[])).toContain('desconocido');expect(publicationBlock(history,false,['group'])).toBeNull();
  const groups=[{facebook_deliveries:[{...delivery,status:'pending',destination_key:'first',destination:{...delivery.destination,mechanism:'group_direct'}}]}] as FacebookPublication[];
  expect(publicationBlock(groups,false,['second'])).toBeNull();expect(publicationBlock(groups,false,['first'])).toContain('pendiente');
  const aliases=[{facebook_deliveries:[{...delivery,status:'attention',submitted_at:'2026-10-14',destination_key:'old',destination:{name:'Old',mechanism:'group_direct',url:'https://www.facebook.com/groups/PicoVendedeTodo'}}]}] as FacebookPublication[];
  expect(publicationBlock(aliases,false,['new'],[{id:'new',name:'Renamed',mechanism:'group_direct',url:'https://www.facebook.com/groups/710102875717376'}])).toBeNull(); // different URL forms: server-side alias dedup
  const sameUrl=[{facebook_deliveries:[{...delivery,status:'attention',submitted_at:'2026-10-14',destination_key:'group',destination:{name:'Group',mechanism:'group_direct',url:'https://www.facebook.com/groups/710102875717376'}}]}] as FacebookPublication[];
  expect(publicationBlock(sameUrl,false,['new'],[{id:'new',name:'Renamed',mechanism:'group_direct',url:'https://www.facebook.com/groups/710102875717376'}])).toContain('desconocido');
});
it('opens only Facebook evidence links and rejects foreign origins and credentials',()=>{
  expect(safeFacebookEvidence({...delivery,evidence_url:'https://www.facebook.com/marketplace/item/123/'})).toBeTruthy();
  for(const url of ['javascript:alert(1)','https://evil.test/marketplace/item/123/','https://user@www.facebook.com/marketplace/item/123/','https://www.facebook.com/marketplace/item/123/?redirect=evil'])expect(safeFacebookEvidence({...delivery,evidence_url:url})).toBeNull();
});
