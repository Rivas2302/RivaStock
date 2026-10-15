import { facebookAdapter } from './adapter.js';
import { registerPairing } from './pairing.js';
import { discoverJoinedGroups, discoverGroupMembers } from './group-discovery.js';
registerPairing({wakeGroups:connection=>syncGroups(connection,true)});

let polling = false;
let readingGroups = false;
export async function syncGroups(connection,background=false) {
  if(readingGroups)return {state:'reading'};
  readingGroups=true;
  let startedInBackground=false;
  try {
    await chrome.storage.local.set({groupDiscovery:{phase:'checking',message:'Consultando el pedido de RivaStock…',checkedAt:Date.now()}});
    const request=await rpc(connection,'facebook_group_discovery',{p_token:connection.token,p_operation:'claim'});
    const previous=await chrome.storage.local.get(['groupDiscoveryIssue','groupDiscoveryIssueStage']);
    if(previous.groupDiscoveryIssueStage==='claim'||previous.groupDiscoveryIssue==='Conexión vencida o revocada')await chrome.storage.local.remove('groupDiscoveryIssue');
    if(typeof request?.id==='string'){
      const read=async()=>{
        const pulse=setInterval(()=>void chrome.storage.local.set({groupDiscoveryHeartbeat:Date.now()}).catch(()=>{}),15000);
        try {
          await chrome.storage.local.set({groupDiscovery:{phase:'reading',message:'Leyendo Tus grupos con la sesión de Facebook…',checkedAt:Date.now()}});
          const data=await discoverJoinedGroups();
          const targets=request.member_targets??[];
          data.memberCounts=await discoverGroupMembers(targets).catch(()=>[]);
          await rpc(connection,'facebook_group_discovery',{p_token:connection.token,p_operation:'result',p_request:request.id,p_data:data});
          await chrome.storage.local.remove('groupDiscoveryIssue');
          await chrome.storage.local.set({groupDiscovery:{phase:'done',message:`${data.groups.length} grupos leídos${data.partial?' · Listado parcial':''}.`,checkedAt:Date.now()}});
        }catch(error){await chrome.storage.local.set({groupDiscoveryIssue:error.message,groupDiscoveryIssueStage:'read',groupDiscovery:{phase:'error',message:error.message,checkedAt:Date.now()}});await rpc(connection,'facebook_group_discovery',{p_token:connection.token,p_operation:'error',p_request:request.id,p_data:{message:error.message}});}
        finally{clearInterval(pulse);}
      };
      if(background){
        // Acknowledge only after the server accepts the claim; report an RPC
        // or capability failure directly to the requesting page.
        startedInBackground=true;
        void read().catch(error=>chrome.storage.local.set({groupDiscoveryIssue:error.message})).finally(()=>{readingGroups=false;});
      }else await read();
      return {state:background?'reading':'finished'};
    }
    await chrome.storage.local.set({groupDiscovery:{phase:'waiting',message:'No hay un pedido nuevo asignado a esta conexión. Si RivaStock muestra uno pendiente, revisá la PC elegida; otro intento puede estar en curso.',checkedAt:Date.now()}});
    return {state:'waiting'};
  }catch(error){await chrome.storage.local.set({groupDiscoveryIssue:error.message,groupDiscoveryIssueStage:'claim',groupDiscovery:{phase:'error',message:error.message,checkedAt:Date.now()}});throw error;}
  finally{if(!startedInBackground)readingGroups=false;}
}
export async function ensureQueueAlarm() {
  const {connection}=await chrome.storage.local.get('connection');
  if(!connection)return;
  if(!await chrome.alarms.get('rivastock-queue')) await chrome.alarms.create('rivastock-queue',{periodInMinutes:1});
}
// MV3 alarms may disappear across browser sessions or extension updates.
// Recreate them whenever the worker is loaded, without changing user pause.
void ensureQueueAlarm().catch(()=>{});
export async function rpc(config, name, args) {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: config.key, ...(config.key.startsWith('ey') ? { Authorization: `Bearer ${config.key}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(20000), credentials: 'omit', redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok) {
    if(name==='request_facebook_groups_from_device'&&['PGRST202','42883'].includes(data.code))throw new Error('Falta aplicar la migración 0054 para actualizar grupos desde la extensión.');
    throw new Error(data.message || 'No se pudo conectar con RivaStock.');
  }
  return data;
}
async function poll() {
  if (polling) return;
  polling = true;
  let heartbeatTimer;
  try {
    const saved=await chrome.storage.local.get(['connection','paused','activeJob','lastIssue','status','queueCommandAt']);
    const {connection,activeJob,lastIssue}=saved;let paused=saved.paused;
    if (!connection) return;
    const heartbeat=await rpc(connection, 'facebook_worker', { p_token: connection.token, p_operation: 'heartbeat',p_status:paused===false?'active':'paused',p_message:saved.status??null });
    if(heartbeat?.queue_command_at&&heartbeat.queue_command_at!==saved.queueCommandAt) {
      paused=!heartbeat.queue_enabled;
      const message=paused?'Cola pausada desde RivaStock.':'Cola activa desde RivaStock.';
      await chrome.storage.local.set({paused,queueCommandAt:heartbeat.queue_command_at,status:message});
      await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'heartbeat',p_status:paused?'paused':'active',p_message:message});
    }
    // Refresh the actual device heartbeat during long photo/form work. The
    // storage API call also lets MV3 observe ongoing activity; jobs still have
    // a persisted recovery checkpoint if Chrome terminates the worker.
    heartbeatTimer=setInterval(() => {
      void rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'heartbeat'}).catch(() => {});
      void chrome.storage.local.set({lastHeartbeat:Date.now()});
    },20000);
    if (activeJob) {
      if(activeJob.deviceId!==connection.deviceId||activeJob.projectUrl!==connection.url) {
        await chrome.storage.local.set({paused:true,status:'Hay un envío de otra conexión pendiente de revisar. No se ejecutó con esta cuenta.'});
        return;
      }
      if (activeJob.stage === 'result') {
        await saveResult(connection, activeJob);
      } else if (activeJob.stage === 'submitting') {
        try {
          const result = await facebookAdapter.reconcile(activeJob);
          await chrome.storage.local.set({ activeJob: {...activeJob,stage:'result',result} });
          await saveResult(connection, {...activeJob,result});
        } catch (error) {
          await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'attention',p_delivery:activeJob.job.id,p_message:error.message});
          await chrome.storage.local.set({status:error.message,lastIssue:error.message});
          await chrome.storage.local.remove('activeJob');
        }
      } else {
        await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'attention',p_delivery:activeJob.job.id,p_message:'Preparación interrumpida. Revisá la pestaña; no se repitió el envío.'});
        await chrome.storage.local.set({status:'Preparación interrumpida. Revisá Facebook. La cola continúa activa.',lastIssue:'Preparación interrumpida. Revisá Facebook.'});
        await chrome.storage.local.remove('activeJob');
      }
      return;
    }
    // Read-only discovery also works with the publication queue paused. A
    // discovery error must never block other destinations or submitted jobs.
    await syncGroups(connection).catch(()=>{});
    // A user can pause or disconnect while header reads are in progress.
    const current=await chrome.storage.local.get(['paused','connection']);
    if(current.connection?.deviceId!==connection.deviceId||current.connection?.token!==connection.token)return;
    paused=current.paused;
    if (paused !== false) { await chrome.storage.local.set({status:'Conectada. Cola pausada.'}); return; }
    const job = await rpc(connection, 'facebook_worker', { p_token: connection.token, p_operation: 'claim' });
    if (!job) { await chrome.storage.local.set({ status: lastIssue?`Cola activa. Último envío requiere revisión: ${lastIssue}`:'Conectada. Sin trabajos pendientes.' }); return; }
    await chrome.storage.local.set({status:`Preparando ${job.destination.name ?? 'publicación'} en una pestaña de Facebook…`});
    try {
      // Persist the claim before any fetch/navigation so a service-worker restart
      // cannot forget an assigned job. Never resubmit a recovered active job.
      await chrome.storage.local.set({activeJob:{job,deviceId:connection.deviceId,projectUrl:connection.url,stage:'preparing'}});
      await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'progress',p_delivery:job.id,p_message:`Preparando ${job.destination.name??'publicación'}`}).catch(()=>{});
      const active = await facebookAdapter.prepare(job,connection);
      if(active.existing) {
        const completed={...active,stage:'result'};
        await chrome.storage.local.set({activeJob:completed});
        await saveResult(connection,completed);
        return;
      }
      await chrome.storage.local.set({activeJob:active});
      await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'checkpoint',p_delivery:job.id});
      await chrome.storage.local.set({activeJob:{...active,stage:'submitting'}});
      await chrome.storage.local.set({status:`Enviando ${job.destination.name ?? 'publicación'}… No cierres Chrome.`});
      await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'progress',p_delivery:job.id,p_message:'Enviando a Facebook; resultado todavía sin confirmar'}).catch(()=>{});
      await facebookAdapter.action(active.tabId,'submit',job.content,[],active.baseline);
      const result = await facebookAdapter.reconcile(active);
      const completed={...active,stage:'result',result};
      await chrome.storage.local.set({activeJob:completed});
      await saveResult(connection,completed);
    } catch (error) {
      // Keep a captured result if its acknowledgement was lost; the next poll
      // retries only the idempotent database write, never Facebook submission.
      const saved=await chrome.storage.local.get('activeJob');
      if (saved.activeJob?.stage==='result') throw error;
      await rpc(connection, 'facebook_worker', { p_token: connection.token, p_operation: 'attention', p_delivery: job.id, p_message: error.message });
      await chrome.storage.local.set({ status: error.message,lastIssue:error.message });
      await chrome.storage.local.remove('activeJob');
    }
  } catch (error) {
    await chrome.storage.local.set({ status: `Sin conexión momentánea. Se reintentará automáticamente: ${error.message}` });
  } finally { clearInterval(heartbeatTimer); polling = false; }
}
async function saveResult(connection, active) {
  const saved=await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:active.existing?'record_existing':'result',p_delivery:active.job.id,p_status:active.result.status,p_url:active.result.url,p_message:active.result.message});
  await chrome.storage.local.set({status:saved?.reviewed?'Este intento ya fue resuelto por una revisión registrada en RivaStock.':`Resultado guardado: ${active.result.message}`});
  await chrome.storage.local.remove('lastIssue');
  await chrome.storage.local.remove('activeJob');
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'rivastock-queue') void poll(); });
chrome.runtime.onInstalled.addListener(() => { void ensureQueueAlarm().then(poll).catch(()=>{}); });
chrome.runtime.onStartup.addListener(() => { void ensureQueueAlarm().then(poll).catch(()=>{}); });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if(['groups-check','groups-refresh'].includes(message.type)&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('connect.html')){
    void (async()=>{try{const {connection}=await chrome.storage.local.get('connection');if(!connection)throw new Error('Vinculá esta PC desde RivaStock primero.');if(message.type==='groups-refresh'){await rpc(connection,'request_facebook_groups_from_device',{p_token:connection.token});await chrome.storage.local.remove('groupDiscoveryIssue');}const result=await syncGroups(connection,true);reply({accepted:true,...result});}catch(error){if(message.type==='groups-refresh')await chrome.storage.local.set({groupDiscoveryIssue:error.message,groupDiscoveryIssueStage:'request',groupDiscovery:{phase:'error',message:error.message,checkedAt:Date.now()}});reply({error:error.message});}})();return true;
  }
  if(message.type==='queue-control'&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('connect.html')&&typeof message.paused==='boolean') {
    void (async()=>{
      try {
        const {connection}=await chrome.storage.local.get('connection');
        if(!connection)throw new Error('Conectá esta PC primero.');
        const command=await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'queue_state',p_status:message.paused?'paused':'active'});
        await chrome.storage.local.set({paused:message.paused,queueCommandAt:command.queue_command_at??null,status:message.paused?'Cola pausada. El envío en curso puede terminar.':'Cola activa. Revisando publicaciones aprobadas…'});
        if(!message.paused)void poll();
        reply({done:true});
      }catch(error){reply({error:error.message});}
    })();
    return true;
  }
  if(message.type==='diagnose'&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('connect.html')) {
    void (async()=>{
      try {
        const tabs=await chrome.tabs.query({url:'https://www.facebook.com/marketplace/*'});
        const forms=tabs.filter(tab=>new URL(tab.url).pathname==='/marketplace/create/item');
        const focused=forms.filter(tab=>tab.active);
        const candidates=focused.length===1?focused:forms;
        if(candidates.length!==1)throw new Error('Abrí un único formulario de Marketplace para revisar.');
        const details=await facebookAdapter.action(candidates[0].id,'diagnose',{});
        const {status}=await chrome.storage.local.get('status');
        reply({version:chrome.runtime.getManifest().version,status,details});
      } catch(error){reply({error:error.message});}
    })();
    return true;
  }
  const stages=['Seleccionando categoría','Seleccionando estado','Completando descripción y ubicación','Cargando fotos','Verificando destinos antes de publicar'];
  if(sender.id===chrome.runtime.id&&sender.tab&&message.type==='progress'&&stages.includes(message.stage)) {
    void chrome.storage.local.get(['activeJob','connection']).then(async({activeJob,connection})=>{
      if(activeJob?.tabId===sender.tab.id&&activeJob.stage==='preparing') {
        await chrome.storage.local.set({status:`${message.stage}…`});
        if(connection)await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'progress',p_delivery:activeJob.job.id,p_message:message.stage});
      }
    }).catch(()=>{});
    return;
  }
  if (sender.id !== chrome.runtime.id || message.type !== 'poll') return;
  void poll().then(() => reply({ done: true }));
  return true;
});
