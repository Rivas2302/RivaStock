import {useEffect,useState} from 'react';
import {useAuth} from '../../AuthContext';
import {db,invalidateDbCache} from '../../lib/db';
import {filterProductsByHoldingOwner,getInventoryHoldings,getVisibleHoldingEconomics} from '../../lib/inventoryHoldings';
import {formatCurrency} from '../../lib/utils';
import type {Product} from '../../types';
import Modal from '../Modal';

export default function PublicationProductPicker({onClose,onSelect}:{onClose:()=>void;onSelect:(product:Product)=>void}) {
  const {ownerUid,holdingsEnabled,inventoryAccessError}=useAuth();
  const [products,setProducts]=useState<Product[]>([]);
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    async function load(){
      if(inventoryAccessError)throw new Error(inventoryAccessError);
      invalidateDbCache('products','inventory_holdings');
      const [items,holdings]=await Promise.all([db.list<Product>('products',ownerUid),holdingsEnabled?getInventoryHoldings(ownerUid):Promise.resolve([])]);
      const inventory=items.filter(item=>!item.catalogOnly);
      if(active)setProducts(holdingsEnabled?filterProductsByHoldingOwner(inventory,holdings,'all').map(item=>({...item,stock:getVisibleHoldingEconomics(item,holdings,'all').stock})):inventory);
    }
    void load().catch(()=>{if(active)setError('No se pudo cargar el inventario. Volvé a intentarlo.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[ownerUid,holdingsEnabled,inventoryAccessError,attempt]);
  const visible=products.filter(item=>item.name.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')));
  return <Modal isOpen title="Nueva publicación" onClose={onClose}><div className="space-y-4">
    <p className="text-sm text-slate-500">Elegí un producto. Antes de enviar podrás revisar sus publicaciones anteriores, contenido y destinos.</p>
    <input aria-label="Buscar producto del inventario" placeholder="Buscar por nombre…" value={search} onChange={event=>setSearch(event.target.value)} className="w-full rounded-xl border border-slate-300 p-3 dark:border-slate-600 dark:bg-slate-800"/>
    {loading?<p role="status">Cargando inventario…</p>:error?<div role="alert"><p>{error}</p><button className="mt-3 rounded-xl border px-4 py-3" onClick={()=>setAttempt(value=>value+1)}>Reintentar carga</button></div>:<>
      <p className="text-sm text-slate-500">{visible.length} {visible.length===1?'producto encontrado':'productos encontrados'}</p>
      {!visible.length&&<p className="rounded-xl bg-slate-50 p-5 text-center dark:bg-slate-800">{products.length?'No hay productos que coincidan con la búsqueda.':'No hay productos de inventario disponibles para consultar.'}</p>}
      <div className="space-y-2">{visible.slice(0,100).map(item=><button key={item.id} onClick={()=>onSelect(item)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-500 dark:border-slate-700">
        {(item.imageUrl||item.images?.[0])?<img src={item.imageUrl||item.images?.[0]} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover"/>:<span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500 dark:bg-slate-800">Sin foto</span>}
        <span className="min-w-0"><strong className="block break-words">{item.name}</strong><span className="block">{formatCurrency(item.salePrice)}</span><span className={`text-sm ${item.stock>0?'text-emerald-700 dark:text-emerald-400':'text-slate-500'}`}>{item.stock>0?`Disponible · ${item.stock} en stock`:'Sin stock'}</span></span>
      </button>)}</div>{visible.length>100&&<p className="text-sm text-slate-500">Mostrando los primeros 100. Refiná la búsqueda para encontrar tu producto.</p>}
    </>}
  </div></Modal>;
}
