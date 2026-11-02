import { facebookExtensionId } from './facebookExtensionId';
import { facebookRpc } from './facebookPublications';
import { supabasePublicApiKey } from './supabase';

export type ExtensionResponse = {installed?:boolean;pending?:boolean;updated?:boolean;busy?:boolean;error?:string;version?:string;groupsWake?:boolean;publicationsWake?:boolean;historicalReview?:boolean;publicKeyRefresh?:boolean;publicKeyUpdated?:boolean;publicKeyRefreshBusy?:boolean;candidateFound?:boolean;message?:string;accepted?:boolean;state?:string;protocol?:number;connectionStatus?:boolean;hasConnection?:boolean;matches?:boolean;hasActiveJob?:boolean;paused?:boolean;errorCode?:string;recoveryPending?:boolean;pairingPending?:boolean};
type Runtime = { lastError?: { message?: string }; sendMessage: (id:string,message:unknown,callback:(response: ExtensionResponse|undefined)=>void)=>void };
function extensionMessage(message:unknown,timeoutMs=10000) {
  const runtime = (window as Window & {chrome?:{runtime?:Runtime}}).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.reject(new Error('Abrí RivaStock en Chrome de la PC con la extensión instalada.'));
  return new Promise<ExtensionResponse>((resolve,reject) => {
    const timer=setTimeout(() => reject(new Error('La extensión no respondió. Actualizala y volvé a intentar.')),timeoutMs);
    runtime.sendMessage(facebookExtensionId,message,response => {
      clearTimeout(timer);
      if(runtime.lastError || !response) reject(new Error('Instalá o actualizá la extensión RivaStock en Chrome y recargá esta página.'));
      else if(response.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}
function facebookProjectUrl(){const raw=(import.meta.env.VITE_SUPABASE_URL as string).trim();return new URL(raw.startsWith('https://')?raw:'https://'+raw).origin;}
async function refreshExtensionPublicKey(info:ExtensionResponse):Promise<ExtensionResponse>{
 if(!info.publicKeyRefresh)return info;
 const result=await extensionMessage({type:'rivastock-update-public-key',projectUrl:facebookProjectUrl(),key:supabasePublicApiKey});
 return {...info,publicKeyUpdated:result.updated===true,publicKeyRefreshBusy:result.busy===true};
}
export async function facebookExtensionInfo(){try{return await refreshExtensionPublicKey(await extensionMessage({type:'rivastock-installed'}));}catch{return null;}}
export async function connectFacebookComputer(deviceIds:string[]=[]):Promise<string>{
 const installed=await refreshExtensionPublicKey(await extensionMessage({type:'rivastock-installed'}));
 if(!installed.installed||!installed.connectionStatus)throw new Error('Actualizá la extensión a 0.5.1 y recargala antes de vincular.');
 const projectUrl=facebookProjectUrl();
 const state=await extensionMessage({type:'rivastock-connection-status',projectUrl,deviceIds});
 if(state.hasConnection||state.hasActiveJob||state.pairingPending){
  await extensionMessage({type:'rivastock-open-connection'});
  if(state.pairingPending&&!state.hasConnection)return 'Ya hay una vinculación pendiente. Confirmala en el panel de la extensión; no hace falta generar otro código.';
  if(state.hasActiveJob)return 'Hay un intento anterior pendiente de revisar. Usá la recuperación del panel; no vuelvas a aprobar las publicaciones.';
  if(state.matches)return state.paused?'Esta PC ya está vinculada. Revisá su estado y activá la cola desde el panel cuando corresponda.':'Esta PC ya está vinculada. Revisá el mensaje del panel si no tiene conexión reciente.';
  return 'La extensión conserva otra vinculación o una credencial revocada. Revisá y cerrá esa conexión desde el panel antes de vincular.';
 }
 const {code}=await facebookRpc<{code:string}>('pair_facebook_device',{p_name:'Chrome de RivaStock'});
 const result=await extensionMessage({type:'rivastock-connect',code,url:projectUrl,key:supabasePublicApiKey});
 if(!result.pending)throw new Error('No se pudo iniciar la conexión.');
 return 'En la pestaña de la extensión, presioná Conectar y activar esta PC y aceptá los permisos de Chrome.';
}
export async function facebookExtensionInstalled() {
  try {return (await extensionMessage({type:'rivastock-installed'})).installed===true;}
  catch {return false;}
}
export async function wakeFacebookPublications(deviceIds:string[],requestStarted?:number):Promise<void> {
  const sent=performance.now();
  const sentAt=new Date().toISOString();
  try{
    const rawUrl=(import.meta.env.VITE_SUPABASE_URL as string).trim();
    const projectUrl=new URL(rawUrl.startsWith('https://')?rawUrl:`https://${rawUrl}`).origin;
    // Send immediately after approval; no detection round trip on this path.
    const result=await extensionMessage({type:'rivastock-wake-publications',deviceIds,projectUrl});
    if(result.accepted)try{const acknowledged=performance.now();sessionStorage.setItem('facebook-last-wake',JSON.stringify({sentAt,acknowledgementMs:acknowledged-sent,...(requestStarted===undefined?{}:{approvalRoundTripMs:sent-requestStarted,requestToAcknowledgementMs:acknowledged-requestStarted})}));}catch{/* Optional diagnostics only. */}
  }catch{/* The approved job remains queued for the remote PC's alarm. */}
}
export async function wakeFacebookGroups(deviceId:string):Promise<string|null> {
  let installed:ExtensionResponse;
  try{installed=await extensionMessage({type:'rivastock-installed'});}catch{return null;}
  if(!installed.groupsWake)return `La extensión local${installed.version?` (${installed.version})`:''} no admite iniciar la lectura desde esta pantalla. Actualizala a 0.4.8 y recargala en Chrome. El pedido remoto se conserva.`;
  const rawUrl=(import.meta.env.VITE_SUPABASE_URL as string).trim();
  const projectUrl=new URL(rawUrl.startsWith('https://')?rawUrl:`https://${rawUrl}`).origin;
  const result=await extensionMessage({type:'rivastock-wake-groups',deviceId,projectUrl});
  if(!result.accepted)throw new Error('La extensión no confirmó el inicio de la lectura. Revisá la PC vinculada.');
  if(result.state==='waiting')return 'La extensión respondió, pero no encontró un pedido nuevo para esta conexión. Revisá qué PC elegiste en RivaStock; otro intento también puede estar en curso.';
  return 'Extensión avisada. Esperando que Facebook responda.';
}

export interface HistoricalFacebookReview {
  deliveryId:string;attemptId:string;deviceId:string;authorizedAt:string;
  destination:{mechanism:string;url:string;name:string};
  content:{title:string;description:string;price:number;photos:string[];location:string;category:string;condition:string;groupText?:string};
  postSubmitObservations?:unknown[];
}
export async function reviewFacebookUnknownAttempt(review:HistoricalFacebookReview):Promise<ExtensionResponse> {
  const installed=await extensionMessage({type:'rivastock-installed'});
  if(!installed.installed||installed.protocol!==2||!installed.historicalReview)
    throw new Error(`Actualizá y recargá la extensión Facebook${installed.version?` (versión detectada ${installed.version})`:''} para revisar resultados históricos con IA.`);
  const rawUrl=(import.meta.env.VITE_SUPABASE_URL as string).trim();
  const projectUrl=new URL(rawUrl.startsWith('https://')?rawUrl:`https://${rawUrl}`).origin;
  return extensionMessage({type:'rivastock-review-unknown',projectUrl,deviceId:review.deviceId,deviceIds:[review.deviceId],review},240000);
}
