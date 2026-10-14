import { facebookExtensionId } from './facebookExtensionId';
import { facebookRpc } from './facebookPublications';

type Runtime = { lastError?: { message?: string }; sendMessage: (id:string,message:unknown,callback:(response: {installed?:boolean;pending?:boolean;error?:string}|undefined)=>void)=>void };
function extensionMessage(message:unknown) {
  const runtime = (window as Window & {chrome?:{runtime?:Runtime}}).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.reject(new Error('Abrí RivaStock en Chrome de la PC con la extensión instalada.'));
  return new Promise<{installed?:boolean;pending?:boolean;error?:string}>((resolve,reject) => {
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
