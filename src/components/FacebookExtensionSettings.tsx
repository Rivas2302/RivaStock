import {useEffect,useState,useImperativeHandle,type Ref} from 'react';
import {Download,CheckCircle2,Monitor} from 'lucide-react';
import {useAuth} from '../AuthContext';
import {usePermission} from '../hooks/usePermission';
import {supabase} from '../lib/supabase';
import {connectFacebookComputer,facebookExtensionInstalled} from '../lib/facebookConnection';
import {deviceConnected,facebookRpc,type FacebookDevice} from '../lib/facebookPublications';

export default function FacebookExtensionSettings({ref}:{ref?:Ref<{refresh:()=>Promise<void>}>}) {
  const {isOwner}=useAuth();
  const canWrite=usePermission('config','write');
  const [installed,setInstalled]=useState(false);
  const [devices,setDevices]=useState<FacebookDevice[]>([]);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);
  useImperativeHandle(ref,()=>({refresh:async()=>{
    const found=await facebookExtensionInstalled();
    const {data,error}=await supabase.from('facebook_devices').select('id,name,last_seen_at,revoked_at,queue_enabled,execution_state,current_activity').is('revoked_at',null);
    if(error)throw new Error('No se pudo consultar la conexión de Facebook.');
    setInstalled(found);setDevices(data as FacebookDevice[]);setError('');
  }}));
  useEffect(()=> {
    let active=true;
    async function refresh() {
      const found=await facebookExtensionInstalled();
      const {data,error}=await supabase.from('facebook_devices').select('id,name,last_seen_at,revoked_at,queue_enabled,execution_state,current_activity').is('revoked_at',null);
      if(!active)return;
      setInstalled(found);
      if(error)setError('No se pudo consultar la conexión de Facebook.');
      else {setDevices(data as FacebookDevice[]);setError('');}
    }
    void refresh();const timer=setInterval(refresh,10000);
    const onFocus=()=>void refresh();window.addEventListener('focus',onFocus);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',onFocus);};
  },[]);
  async function run(action:()=>Promise<void>) {
    setBusy(true);setError('');setNotice('');
    try {await action();} catch(error){setError((error as Error).message);} finally{setBusy(false);}
  }
  const button='inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white disabled:opacity-50';
  return <section className="space-y-6" aria-labelledby="facebook-extension-heading">
    <div><h3 id="facebook-extension-heading" className="text-xl font-bold text-slate-900 dark:text-white">Publicaciones en Facebook</h3><p className="mt-2 text-slate-500 dark:text-slate-400">Instalá la extensión en Chrome de una PC. Después podés aprobar publicaciones desde RivaStock en tu celular o cualquier computadora.</p></div>
    <p className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">{installed?<CheckCircle2 size={20}/>:<Monitor size={20}/>} {installed?'Extensión detectada en este navegador':'Extensión sin detectar en este navegador'}</p>
    <div className="flex flex-wrap gap-3"><a className={button} href="/downloads/rivastock-facebook.zip" download="rivastock-facebook.zip"><Download size={18}/>Descargar extensión</a>
      {isOwner && canWrite && <button className={button} disabled={busy||!installed} onClick={()=>void run(async()=>{await connectFacebookComputer();setNotice('En la pestaña de la extensión, presioná Conectar y activar esta PC y aceptá los permisos de Chrome.');})}>Conectar esta PC</button>}
    </div>
    {!installed && <div className="rounded-2xl bg-slate-50 p-4 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><h4 className="font-bold">Instalación inicial en la PC</h4><ol className="mt-3 list-decimal space-y-3 pl-5"><li>Descargá el archivo y extraelo en una carpeta que puedas conservar.</li><li>Abrí <code>chrome://extensions</code> en Chrome y activá <strong>Modo de desarrollador</strong>. <button type="button" className="underline" onClick={()=>void run(async()=>{await navigator.clipboard.writeText('chrome://extensions');setCopied(true);})}>{copied?'Dirección copiada':'Copiar dirección'}</button></li><li>Presioná <strong>Cargar descomprimida</strong> y elegí la carpeta donde extrajiste el archivo.</li><li>Volvé a esta pantalla y presioná <strong>Conectar esta PC</strong>.</li></ol><p className="mt-4 text-sm">Chrome requiere confirmar la instalación en el navegador. En Android y iPhone, usá la conexión de tu PC para enviar publicaciones.</p></div>}
    <p className="text-sm text-slate-500 dark:text-slate-400">Mantené la PC encendida, Chrome abierto y Facebook con la sesión iniciada en ese mismo perfil. La conexión se conserva entre reinicios y se renueva mientras siga activa.</p>
    {!isOwner && <p className="text-sm text-slate-500">El titular de la cuenta debe vincular la PC.</p>}
    {notice && <p role="status" className="text-emerald-700 dark:text-emerald-400">{notice}</p>}{error && <p role="alert" className="text-rose-600 dark:text-rose-400">{error}</p>}
    {devices.map(device=><div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><span className="text-slate-700 dark:text-slate-200">{device.name} · {deviceConnected(device)?'Conectada':'Sin conexión reciente'}</span>{isOwner&&canWrite&&<button className="rounded-lg border px-3 py-2 text-sm dark:text-white" disabled={busy} onClick={()=>void run(async()=>{await facebookRpc('revoke_facebook_device',{p_device:device.id});setDevices(current=>current.filter(item=>item.id!==device.id));setNotice('Computadora desvinculada.');})}>Desvincular</button>}</div>)}
  </section>;
}
