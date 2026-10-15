import { facebookExtensionId } from './facebookExtensionId';
import { facebookRpc } from './facebookPublications';

type ExtensionResponse = {installed?:boolean;pending?:boolean;error?:string;version?:string;groupsWake?:boolean;accepted?:boolean;state?:string};
type Runtime = { lastError?: { message?: string }; sendMessage: (id:string,message:unknown,callback:(response: ExtensionResponse|undefined)=>void)=>void };
function extensionMessage(message:unknown) {
  const runtime = (window as Window & {chrome?:{runtime?:Runtime}}).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.reject(new Error('Abrí RivaStock en Chrome de la PC con la extensión instalada.'));
  return new Promise<ExtensionResponse>((resolve,reject) => {
    const timer=setTimeout(() => reject(new Error('La extensión no respondió. Actualizala y volvé a intentar.')),10000);
    runtime.sendMessage(facebookExtensionId,message,response => {
      clearTimeout(timer);
      if(runtime.lastError || !response) reject(new Error('Instalá o actualizá la extensión RivaStock en Chrome y recargá esta página.'));
      else if(response.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}
export async function connectFacebookComputer() {
  const installed=await extensionMessage({type:'rivastock-installed'});
  if(!installed.installed) throw new Error('Actualizá la extensión RivaStock.');
  const {code}=await facebookRpc<{code:string}>('pair_facebook_device',{p_name:'Chrome de RivaStock'});
  const rawUrl=(import.meta.env.VITE_SUPABASE_URL as string).trim();
  const result=await extensionMessage({type:'rivastock-connect',code,url:rawUrl.startsWith('https://')?rawUrl:`https://${rawUrl}`,key:import.meta.env.VITE_SUPABASE_ANON_KEY});
  if(!result.pending) throw new Error('No se pudo iniciar la conexión.');
}
export async function facebookExtensionInstalled() {
  try {return (await extensionMessage({type:'rivastock-installed'})).installed===true;}
  catch {return false;}
}
export async function wakeFacebookGroups(deviceId:string):Promise<string|null> {
  let installed:ExtensionResponse;
  try{installed=await extensionMessage({type:'rivastock-installed'});}catch{return null;}
  if(!installed.groupsWake)return `La extensión local${installed.version?` (${installed.version})`:''} no admite iniciar la lectura desde esta pantalla. Actualizala a 0.4.5 y recargala en Chrome. El pedido remoto se conserva.`;
  const rawUrl=(import.meta.env.VITE_SUPABASE_URL as string).trim();
  const projectUrl=new URL(rawUrl.startsWith('https://')?rawUrl:`https://${rawUrl}`).origin;
  const result=await extensionMessage({type:'rivastock-wake-groups',deviceId,projectUrl});
  if(!result.accepted)throw new Error('La extensión no confirmó el inicio de la lectura. Revisá la PC vinculada.');
  if(result.state==='waiting')return 'La extensión respondió, pero no encontró un pedido nuevo para esta conexión. Revisá qué PC elegiste en RivaStock; otro intento también puede estar en curso.';
  return 'Extensión avisada. Esperando que Facebook responda.';
}
