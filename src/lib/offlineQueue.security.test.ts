import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { from, getSession } = vi.hoisted(() => ({from:vi.fn(),getSession:vi.fn()}));
vi.mock('./supabase', () => ({supabase:{from,auth:{getSession}}}));
import { db, getOfflineQueueSize, setDatabaseActor, syncOfflineMutations } from './db';

let store: Map<string,string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value)});
  vi.stubGlobal('window',{dispatchEvent:vi.fn()});
  vi.stubGlobal('navigator',{onLine:false});
  setDatabaseActor(null); from.mockReset(); getSession.mockReset();
});
afterEach(() => { setDatabaseActor(null); vi.unstubAllGlobals(); });

function online(actor:string) {
  vi.stubGlobal('navigator',{onLine:true});
  getSession.mockResolvedValue({data:{session:{user:{id:actor},access_token:`token-${actor}`}},error:null});
}
describe('offline actor isolation', () => {
  it('never replays unscoped legacy changes or another account queue', async () => {
    store.set('rivastock:offline-mutations',JSON.stringify([{operation:'delete',collectionName:'products',id:'legacy'}]));
    setDatabaseActor('alice');
    await db.update('products','product',{name:'Alice edit'});
    expect(getOfflineQueueSize()).toBe(1);
    setDatabaseActor('bob'); online('bob');
    expect(getOfflineQueueSize()).toBe(0);
    await syncOfflineMutations();
    expect(from).not.toHaveBeenCalled();
    expect(store.has('rivastock:offline-mutations')).toBe(true);
    setDatabaseActor('alice');
    await syncOfflineMutations(); // Session still belongs to Bob.
    expect(from).not.toHaveBeenCalled();
    expect(getOfflineQueueSize()).toBe(1);
  });
  it('deduplicates synchronization, pins credentials and retains newly queued writes', async () => {
    setDatabaseActor('alice');
    await db.update('products','first',{name:'First'});
    let release!: (value:unknown)=>void;
    const pending = new Promise(resolve => { release=resolve; });
    const setHeader = vi.fn().mockReturnValue(pending);
    from.mockReturnValue({update:()=>({eq:()=>({setHeader})})});
    online('alice');
    const first = syncOfflineMutations();
    const second = syncOfflineMutations();
    await vi.waitFor(() => expect(setHeader).toHaveBeenCalledWith('Authorization','Bearer token-alice'));
    vi.stubGlobal('navigator',{onLine:false});
    await db.update('products','second',{name:'Second'});
    release({error:null});
    await Promise.all([first,second]);
    expect(from).toHaveBeenCalledOnce();
    expect(getOfflineQueueSize()).toBe(1);
    expect(store.get('rivastock:offline-mutations:alice')).toContain('second');
    expect(store.get('rivastock:offline-mutations:alice')).not.toContain('first');
  });
  it('does not queue unauthenticated edits or lose failed server mutations', async () => {
    await expect(db.update('products','x',{name:'Unknown'})).rejects.toThrow('sesión');
    setDatabaseActor('alice'); await db.delete('products','x'); online('alice');
    from.mockReturnValue({delete:()=>({eq:()=>({setHeader:()=>Promise.resolve({error:new Error('Denied')})})})});
    await syncOfflineMutations(); expect(getOfflineQueueSize()).toBe(1);
  });
});
