import {useEffect,useState,useImperativeHandle,type Ref} from 'react';
import {useAuth} from '../../AuthContext';
import {usePermission} from '../../hooks/usePermission';
import {supabase} from '../../lib/supabase';
import {normalizeGroupUrl,type FacebookGroup,type FacebookDevice} from '../../lib/facebookPublications';
import FacebookGroupPicker from './FacebookGroupPicker';
import {inspectedFacebookGroup} from '../../../extensions/facebook/group-contract.js';

export default function FacebookGroupsSettings({ref}:{ref?:Ref<{refresh:()=>Promise<void>}>}) {
  const {ownerUid}=useAuth();const canWrite=usePermission('stock','write');
  const [groups,setGroups]=useState<FacebookGroup[]>([]);const [name,setName]=useState(inspectedFacebookGroup.name);const [url,setUrl]=useState(inspectedFacebookGroup.url);
  const [devices,setDevices]=useState<FacebookDevice[]>([]);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function refresh(){const {data,error}=await supabase.from('facebook_groups').select('id,name,url,mechanism').order('name');if(error)throw new Error('No se pudieron actualizar los grupos. Volvé a intentarlo.');setGroups(data as FacebookGroup[]);const pcs=await supabase.from('facebook_devices').select('id,name,last_seen_at,revoked_at').is('revoked_at',null);if(pcs.error)throw new Error('No se pudo cargar la conexión.');setDevices(pcs.data as FacebookDevice[]);setError('');}
  useImperativeHandle(ref,()=>({refresh}));
  useEffect(()=>{void refresh().catch(()=>setError('No se pudieron cargar los grupos.'));},[ownerUid]);
  async function save(){setBusy(true);setError('');try{if(!name.trim())throw new Error('Ingresá el nombre del grupo.');const {error}=await supabase.from('facebook_groups').insert({user_id:ownerUid,name:name.trim(),url:normalizeGroupUrl(url)});if(error)throw error;await refresh();}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  const input='mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900';
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"><h3 className="font-bold">Destinos y grupos</h3><FacebookGroupPicker groups={groups} devices={devices} onRefresh={refresh}/>{canWrite&&<div className="space-y-3"><label className="block text-sm">Nombre del grupo<input className={input} value={name} onChange={e=>setName(e.target.value)} maxLength={160}/></label><label className="block text-sm">URL del grupo<input className={input} value={url} onChange={e=>setUrl(e.target.value)}/></label><button disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50" onClick={()=>void save()}>Guardar grupo</button></div>}{error&&<p role="alert" className="text-sm text-rose-600">{error}</p>}</section>;
}
