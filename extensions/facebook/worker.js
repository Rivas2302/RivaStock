import { facebookAdapter } from './adapter.js';
import { registerPairing } from './pairing.js';
import { discoverJoinedGroups, discoverGroupMembers } from './group-discovery.js';
import { closeAutomationTab } from './automation-tabs.js';
registerPairing({wakeGroups:connection=>syncGroups(connection,true),wakePublications:signal=>{void poll(signal,true);}});

let polling = false;
let pendingSignal=null;
let readingGroups = false;

const capabilities=['attempts','causal-results','recovery','result-candidates','evidence-receipts','causal-results-v2','own-content-tracking'];
function extensionVersion(){try{return chrome.runtime.getManifest().version;}catch{return '0.5.14';}}
// Contract rejections cannot be resolved by sending the same payload again.
// PostgreSQL reports every RAISE EXCEPTION as SQLSTATE P0001 and carries the
// domain code in the message, so the code never arrives in error.code.
const PERMANENT_CODES=new Set(['RESULT_EVIDENCE_INVALID','RESULT_INVALID','RESULT_UNKNOWN','DIAGNOSTIC_INVALID',
 'PROTOCOL_UNSUPPORTED','CLAIM_KEY_REQUIRED','QUEUE_STATE_INVALID','QUEUE_PAUSED','DEVICE_REVOKED',
 'DEVICE_PERMISSION_REVOKED','TOKEN_EXPIRED','ATTEMPT_STALE','ATTEMPT_RECOVERY_REQUIRED','RECOVERY_REQUIRED',
 'CONTRACT_REJECTED','TAB_LOST']);
export function errorCode(error){
  if(error.code&&/^[A-Z][A-Z_]+$/.test(error.code))return error.code;
  if(['PGRST202','42883'].includes(error.code))return 'PROTOCOL_UNSUPPORTED';
  const value=error.message??'';
  const known=value.match(/^([A-Z][A-Z_]{3,})\b/)?.[1];if(known&&PERMANENT_CODES.has(known))return known;
  if(/DEVICE_REVOKED|revocad/i.test(value))return 'DEVICE_REVOKED';
  if(/TOKEN_EXPIRED|vencida/i.test(value))return 'TOKEN_EXPIRED';
  if(/ATTEMPT_|RECOVERY_REQUIRED/.test(value))return 'ATTEMPT_STALE';
  if(/PROTOCOL_|PGRST202/.test(value))return 'PROTOCOL_UNSUPPORTED';
  // Chrome destroys the target frame when its tab navigates or closes mid-script.
  if(/Frame with ID|No frame with id|No tab with id|tab was closed|Cannot access contents|Could not establish connection/i.test(value))return 'TAB_LOST';
  if(['40001','40P01'].includes(error.code))return 'NETWORK_TEMPORARY';
  if([408,429].includes(error.status)||error.status>=500)return 'NETWORK_TEMPORARY';
  if(error.status>=400)return 'CONTRACT_REJECTED';
  return 'NETWORK_TEMPORARY';
}
export function errorIsPermanent(error){return PERMANENT_CODES.has(errorCode(error));}
// Facebook can acknowledge a submission without exposing a permalink. The server
// requires evidence for every status but pending_approval, so such a capture is a
// receipt to review, never a saved result.
export function evidenceContract(result){
  if(!result?.status)return 'none';
  return result.url||result.status==='pending_approval'?'result':'receipt';
}
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
          const data=request.resumeMembers?null:await discoverJoinedGroups();
          let members=request.resumeMembers?request:await rpc(connection,'facebook_group_discovery',{p_token:connection.token,p_operation:'result',p_request:request.id,p_data:{...data,readAllMembers:true,memberCounts:[]}});
          if(!Array.isArray(members?.member_targets))throw new Error('Aplicá la migración 0057 para consultar los miembros de todos los grupos.');
          while(members.offset<members.total){
            const targets=members.member_targets.slice(members.offset,members.offset+3);
            await chrome.storage.local.set({groupDiscovery:{phase:'reading',message:`Consultando miembros: ${members.offset} de ${members.total} grupos…`,checkedAt:Date.now()}});
            const counts=await discoverGroupMembers(targets);
            const next=await rpc(connection,'facebook_group_discovery',{p_token:connection.token,p_operation:'members_batch',p_request:request.id,p_data:{offset:members.offset,memberCounts:counts}});
            if(!next||next.offset<=members.offset)throw new Error('La lectura de miembros no avanzó. El progreso guardado se conserva.');
            members=next;
          }
          await chrome.storage.local.remove('groupDiscoveryIssue');
          await chrome.storage.local.set({groupDiscovery:{phase:'done',message:`Miembros consultados: ${members.total} de ${members.total} grupos${data?.partial?' · Listado parcial':''}.`,checkedAt:Date.now()}});
        }catch(error){await chrome.storage.local.set({groupDiscoveryIssue:error.message,groupDiscoveryIssueStage:'read',groupDiscovery:{phase:'error',message:error.message,checkedAt:Date.now()}});await rpc(connection,'facebook_group_discovery',{p_token:connection.token,p_operation:'error',p_request:request.id,p_data:{message:error.message}});}
        finally{clearInterval(pulse);}
      };
      if(background){
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
  const alarm=await chrome.alarms.get('rivastock-queue');
  if(alarm?.periodInMinutes!==0.5)await chrome.alarms.create('rivastock-queue',{periodInMinutes:0.5});
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
    const error=new Error(data.message || 'No se pudo conectar con RivaStock.');error.code=data.code;error.status=response.status;throw error;
  }
  return data;
}

async function getWorkerProtocol(){return (await chrome.storage.local.get('workerProtocol')).workerProtocol??1;}
export async function workerRpc(connection,operation,params={}){
  const protocol=params.protocol??await getWorkerProtocol();
  if(protocol>=2)return rpc(connection,'facebook_worker_v2',{
    p_token:connection.token,p_operation:operation,p_delivery:params.delivery??null,p_attempt:params.attempt??null,
    p_data:{...(params.data??{}),...(params.message===undefined?{}:{message:params.message}),...(params.status?{status:params.status}:{}),...(operation==='heartbeat'?{version:extensionVersion(),capabilities}:{})},
  });
  return rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:operation,
    ...(params.delivery?{p_delivery:params.delivery}:{}),...(operation==='heartbeat'||params.message!==undefined?{p_message:params.message??null}:{}),
    ...((params.status??params.data?.status)?{p_status:params.status??params.data.status}:{}),...(params.url?{p_url:params.url}:{})});
}
async function trackPending(connection) {
  const response=await workerRpc(connection,'track',{protocol:2});
  const jobs=Array.isArray(response?.items)?response.items:[];
  if(!jobs.length)return;
  const saved=await chrome.storage.local.get('ownContentTrackers');
  const trackers={...(saved.ownContentTrackers??{})};
  for(const job of jobs) {
    const tracker=trackers[job.attemptId];
    if(!tracker)continue;
    const result=await facebookAdapter.track({destination:job.destination,content:{title:job.title}},tracker,job.pendingPostId);
    if(!result)continue;
    const updated=await workerRpc(connection,'track',{protocol:2,delivery:job.deliveryId,attempt:job.attemptId,data:{
      status:result.status,url:result.url,message:result.message,pendingPostId:job.pendingPostId,
    }});
    if(updated?.saved===true) {
      if(result.status!=='pending_approval')delete trackers[job.attemptId];
      await chrome.storage.local.set({ownContentTrackers:trackers,status:'Seguimiento automático actualizado en RivaStock.'});
    }
  }
}
export async function poll(signal={source:'alarm',received:performance.now(),receivedAt:new Date().toISOString()},chain=false){
  if(polling){pendingSignal=signal;return;}
  polling=true;const lifetime=globalThis.chrome;let heartbeatTimer;let drain=false;
  try{
    const saved=await chrome.storage.local.get(['connection','paused','activeJob','lastIssue','status','queueCommandAt','pendingClaim','workerProtocol','serverFeatures']);
    let serverFeatures=saved.serverFeatures??[];
    const {connection,activeJob}=saved;if(!connection)return;
    let protocol=saved.workerProtocol??1;let heartbeat;
    // Upgrade only on an explicit V2 handshake. A missing endpoint is the only safe fallback.
    if(chrome.runtime.getManifest){
      try{heartbeat=await workerRpc(connection,'heartbeat',{protocol:2,status:saved.paused===false?'active':'paused'});if(heartbeat?.worker_protocol===2){protocol=2;serverFeatures=heartbeat.features??[];await chrome.storage.local.set({serverFeatures});}}
      catch(error){if(!['PGRST202','42883'].includes(error.code)||protocol>=2)throw error;}
    }
    if(!heartbeat||protocol<2)heartbeat=await workerRpc(connection,'heartbeat',{protocol:1,status:saved.paused===false?'active':'paused',message:saved.status??null});
    if(heartbeat?.required_protocol>=2&&protocol<2)throw new Error('PROTOCOL_UNSUPPORTED');
    await chrome.storage.local.set({workerProtocol:protocol,lastErrorCode:null});
    let paused=saved.paused;
    if(heartbeat?.queue_command_at&&heartbeat.queue_command_at!==saved.queueCommandAt){
      paused=!heartbeat.queue_enabled;await chrome.storage.local.set({paused,queueCommandAt:heartbeat.queue_command_at,status:paused?'Cola pausada desde RivaStock.':'Cola activa desde RivaStock.'});
      await workerRpc(connection,'heartbeat',{protocol,status:paused?'paused':'active'});
    }
    // Expiring our own in-flight attempt first would retire it without reconciling.
    if(protocol>=2&&!activeJob)try{await rpc(connection,'facebook_watchdog',{p_token:connection.token});}catch{}
    heartbeatTimer=setInterval(()=>{
      void (async()=>{
        const current=await chrome.storage.local.get(['activeJob','connection']);
        if(current.connection?.token!==connection.token)return;
        const running=current.activeJob;
        if(running?.attemptId&&running.stage==='preparing')await workerRpc(connection,'progress',{protocol:2,delivery:running.job.id,attempt:running.attemptId,data:{message:'Preparando el formulario aprobado'}});
        else await workerRpc(connection,'heartbeat',{protocol});
        await chrome.storage.local.set({lastHeartbeat:Date.now()});
      })().catch(()=>{});
    },20000);
    if(activeJob){
      if(activeJob.deviceId!==connection.deviceId||activeJob.projectUrl!==connection.url){await chrome.storage.local.set({paused:true,status:'Hay un envío de otra conexión pendiente de revisar. No se ejecutó con esta cuenta.'});return;}
      // Captured evidence must be persisted before asking whether the attempt was retired.
      if(activeJob.stage==='result'){await persistResult(connection,activeJob,serverFeatures);drain=true;return;}
      try{
        if(activeJob.attemptId){
          const recovery=await workerRpc(connection,'recover',{protocol:2,delivery:activeJob.job.id,attempt:activeJob.attemptId});
          if(recovery?.action==='retire'){await closeAutomationTab(activeJob.tabId);await chrome.storage.local.remove('activeJob');await chrome.storage.local.set({status:'Intento anterior registrado para revisión; la cola puede continuar.'});drain=true;return;}
          if(recovery?.action!=='reconcile_only')throw new Error('ATTEMPT_STALE');
        }else if(activeJob.stage!=='submitting'&&activeJob.stage!=='authorizing'){
          await markAttention(connection,activeJob,'Preparación interrumpida. No se repitió el envío.',{serverFeatures});drain=true;return;
        }
        const result=await facebookAdapter.reconcile(activeJob);
        const completed={...activeJob,stage:'result',result};await chrome.storage.local.set({activeJob:completed});await persistResult(connection,completed,serverFeatures);drain=true;
      }catch(error){
        if((await chrome.storage.local.get('activeJob')).activeJob?.stage==='result')throw error;
        await markAttention(connection,activeJob,error.message,{issue:error.issue,code:error.code,candidateUrl:error.candidateUrl,receipt:error.receipt,serverFeatures});drain=true;
      }
      return;
    }
    if(protocol>=2&&serverFeatures.includes('own-content-tracking')) {
      try{await trackPending(connection);await chrome.storage.local.remove('lastTrackingErrorCode');}
      catch(error){await chrome.storage.local.set({lastTrackingErrorCode:errorCode(error)});}
    }
    const current=await chrome.storage.local.get(['paused','connection']);
    if(current.connection?.token!==connection.token)return;
    if(current.paused!==false){await chrome.storage.local.set({status:'Conectada. Cola pausada.'});if(chain)void maintainGroups(connection);return;}
    const pending=saved.pendingClaim;
    const claimKey=pending?.deviceId===connection.deviceId&&pending.projectUrl===connection.url?pending.claimKey:crypto.randomUUID();
    if(protocol>=2)await chrome.storage.local.set({pendingClaim:{claimKey,deviceId:connection.deviceId,projectUrl:connection.url}});
    const claimStart=performance.now();
    const job=await workerRpc(connection,'claim',{protocol,data:{claimKey}});
    if(!job){await chrome.storage.local.remove('pendingClaim');if(chain)void maintainGroups(connection);await chrome.storage.local.set({status:saved.lastIssue?'Cola activa. Último envío requiere revisión: '+saved.lastIssue:'Conectada. Sin trabajos pendientes.'});return;}
    const identity={schemaVersion:2,claimKey,attemptId:job.attemptId,protocol};
    let active={...identity,job,deviceId:connection.deviceId,projectUrl:connection.url,stage:'preparing'};
    await chrome.storage.local.set({activeJob:active});await chrome.storage.local.remove('pendingClaim');
    if(job.recovered){pendingSignal={source:'drain',received:performance.now(),receivedAt:new Date().toISOString()};return;}
    try{
      await chrome.storage.local.set({status:'Preparando '+(job.destination.name??'publicación')+' en una pestaña de Facebook…'});
      void workerRpc(connection,'progress',{protocol,delivery:job.id,attempt:job.attemptId,message:'Preparando '+(job.destination.name??'publicación')}).catch(()=>{});
      const preparationStart=performance.now();
      const timing={source:signal.source,receivedAt:signal.receivedAt,receipt_to_claim_ms:preparationStart-signal.received,claim_rpc_ms:preparationStart-claimStart,receipt_to_preparation_ms:preparationStart-signal.received};
      const reportTiming=()=>rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'latency',p_delivery:job.id,p_message:JSON.stringify(timing)}).catch(()=>{});
      if(protocol<2)void reportTiming();
      active={...await facebookAdapter.prepare(job,{...connection,journalIdentity:identity,onTiming:(phase,elapsed)=>{timing[phase]=elapsed;}}),...identity};
      timing.preparation_ms=performance.now()-preparationStart;if(protocol<2)void reportTiming();
      await chrome.storage.local.set({activeJob:active});
      if(active.existing){const completed={...active,stage:'result'};await chrome.storage.local.set({activeJob:completed});await saveResult(connection,completed);drain=true;return;}
      const before=await chrome.storage.local.get(['paused','connection']);
      if(before.paused!==false||before.connection?.token!==connection.token)throw new Error('Cola pausada o conexión cambiada antes del envío. No se publicó.');
      await facebookAdapter.action(active.tabId,'validate_submit',job.content,[],active.baseline);
      const afterValidation=await chrome.storage.local.get(['paused','connection']);
      if(afterValidation.paused!==false||afterValidation.connection?.token!==connection.token)throw new Error('Cola pausada o conexión cambiada antes del envío. No se publicó.');
      await chrome.storage.local.set({activeJob:{...active,stage:'authorizing'}});
      const checkpoint=await workerRpc(connection,'checkpoint',{protocol,delivery:job.id,attempt:job.attemptId});
      if(checkpoint?.authorized!==true||(protocol>=2&&checkpoint.phase!=='authorized_now'))throw new Error('RESULT_UNKNOWN: no se concedió una nueva autorización de envío.');
      await chrome.storage.local.set({activeJob:{...active,stage:'submitting'},status:'Enviando a Facebook; resultado todavía sin confirmar…'});
      // A click that navigates destroys the frame before replying; reconcile instead of failing.
      try{await facebookAdapter.action(active.tabId,'submit',job.content,[],active.baseline);}
      catch(error){if(errorCode(error)!=='TAB_LOST'&&error.message!=='No se pudo verificar el formulario de Facebook.')throw error;}
      const result=await facebookAdapter.reconcile(active);
      const completed={...active,stage:'result',result};await chrome.storage.local.set({activeJob:completed});await persistResult(connection,completed,serverFeatures);drain=true;
    }catch(error){
      const journal=(await chrome.storage.local.get('activeJob')).activeJob;
      if(journal?.stage==='result')throw error;
      await markAttention(connection,journal??active,error.message,{issue:error.issue,code:error.code,candidateUrl:error.candidateUrl,receipt:error.receipt,serverFeatures});drain=true;
    }
  }catch(error){
    const code=errorCode(error);await chrome.storage.local.set({lastErrorCode:code,status:code==='NETWORK_TEMPORARY'?'Sin conexión momentánea. Se reintentará automáticamente.':code==='DEVICE_REVOKED'||code==='TOKEN_EXPIRED'?'La vinculación venció o fue revocada. Revisá la conexión antes de continuar.':'La ejecución requiere revisión: '+code});
  }finally{
    clearInterval(heartbeatTimer);polling=false;const next=pendingSignal;pendingSignal=null;
    if(next||(drain&&chain))setTimeout(()=>{if(globalThis.chrome===lifetime)void poll(next??{source:'drain',received:performance.now(),receivedAt:new Date().toISOString()},true);},0);
  }
}
async function markAttention(connection,active,message,options={}){
  const {issue,code,candidateUrl,receipt,rejectedEvidence,serverFeatures}=options;
  const protocol=active.protocol??1;const features=serverFeatures??[];
  const authorized=['submitting','authorizing','result'].includes(active.stage);
  const useCandidate=Boolean(candidateUrl)&&protocol>=2&&authorized&&features.includes('result-candidates');
  // Extra keys reach an older server as a contract violation, so each one is
  // sent only after its feature was announced in the heartbeat.
  const useReceipts=protocol>=2&&authorized&&features.includes('evidence-receipts');
  const attentionData=issue?{issue,message}:{message,
    ...(useCandidate?{candidateUrl}:{}),
    ...(useReceipts&&receipt?.status?{receipt:{status:receipt.status,...(receipt.message?{message:receipt.message}:{})}}:{}),
    ...(useReceipts&&rejectedEvidence?{rejectedEvidence}:{})};
  await workerRpc(connection,issue?'issue':'attention',{protocol,delivery:active.job.id,attempt:active.attemptId,message:issue&&protocol<2?JSON.stringify(issue):message,data:attentionData});
  const displayMsg=useCandidate?'Resultado desconocido: posible publicación encontrada. Confirmala en RivaStock.':message;
  await chrome.storage.local.set({status:displayMsg,lastIssue:displayMsg,lastErrorCode:code??(authorized?'RESULT_UNKNOWN':'PREPARATION_INTERRUPTED')});
  await closeAutomationTab(active.tabId);
  await chrome.storage.local.remove('activeJob');
}
// A journal must never outlive its ability to be persisted. Transport failures
// are retried with the same payload; a contract rejection or an exhausted budget
// parks the capture for human review and releases the queue.
const RESULT_RETRY_LIMIT=20;
// When even the attention is rejected for good, keep the reference on this PC
// and release the queue instead of resending the same payload forever.
async function parkLocally(active,code){
  const {parkedResults=[]}=await chrome.storage.local.get('parkedResults');
  await chrome.storage.local.set({
    parkedResults:[...parkedResults.slice(-9),{deliveryId:active.job.id,attemptId:active.attemptId??null,result:active.result??null,code,at:new Date().toISOString()}],
    status:`No se pudo registrar el resultado (${code}). Revisá la entrega en RivaStock; la referencia quedó guardada en esta PC.`,
    lastErrorCode:code});
  await chrome.storage.local.remove('activeJob');
}
async function parkAttention(connection,active,message,options){
  try{await markAttention(connection,active,message,options);}
  catch(error){if(!errorIsPermanent(error))throw error;await parkLocally(active,errorCode(error));}
}
async function persistResult(connection,active,serverFeatures){
  if(evidenceContract(active.result)==='receipt'){
    await parkAttention(connection,active,'Facebook confirmó la recepción sin publicar un enlace. Confirmá el resultado en RivaStock.',
      {code:'RESULT_RECEIPT_ONLY',receipt:{status:active.result.status,message:active.result.message},serverFeatures});
    await closeCompletedTab(active);
    return;
  }
  try{await saveResult(connection,active);}
  catch(error){
    const code=errorCode(error);const attempts=(active.resultAttempts??0)+1;
    await chrome.storage.local.set({activeJob:{...active,resultAttempts:attempts},lastErrorCode:code});
    if(!errorIsPermanent(error)&&attempts<RESULT_RETRY_LIMIT)throw error;
    await parkAttention(connection,active,`Se capturó un resultado que el servidor no aceptó (${code}). Revisalo en RivaStock antes de otro envío.`,
      {code,receipt:{status:active.result?.status,message:active.result?.message},rejectedEvidence:active.result?.url??null,serverFeatures});
    await closeCompletedTab(active);
  }
}
let maintaining=false;
async function maintainGroups(connection){
  if(maintaining||readingGroups)return;
  const api=globalThis.chrome;
  maintaining=true;
  try{
    const state=await chrome.storage.local.get(['lastGroupMaintenance','lastGroupMaintenanceDevice']);
    if(state.lastGroupMaintenanceDevice!==connection.deviceId||Date.now()-(state.lastGroupMaintenance??0)>3600000){
      await rpc(connection,'request_facebook_groups_if_due',{p_token:connection.token});
      await chrome.storage.local.set({lastGroupMaintenance:Date.now(),lastGroupMaintenanceDevice:connection.deviceId});
    }
    if(globalThis.chrome===api)await syncGroups(connection,true);
  }catch(error){await api.storage.local.set({groupDiscoveryIssue:error.message}).catch(()=>{});}
  finally{maintaining=false;}
}
export function diagnosticSummary(state){
 const active=state.activeJob;
 return {version:extensionVersion(),protocol:state.workerProtocol??1,linked:Boolean(state.connection),paused:state.paused!==false,errorCode:state.lastErrorCode??null,
  attempt:active?{deliveryId:active.job?.id??null,attemptId:active.attemptId??null,stage:active.stage}:null};
}
async function closeCompletedTab(active){
 await closeAutomationTab(active.tabId);
}
async function saveResult(connection, active) {
  const data = { status: active.result.status, url: active.result.url, message: active.result.message };
  if (active.protocol >= 2 && active.attemptId) {
    if(active.result.status==='pending_approval'&&/^\d+$/.test(active.result.pendingPostId??'')) {
      const authorId=active.baseline.find(value=>value.startsWith('author:'))?.slice(7)??null;
      if(active.job.destination.mechanism==='marketplace'||/^\d+$/.test(authorId??'')) {
        const stored=await chrome.storage.local.get('ownContentTrackers');
        const trackers={...(stored.ownContentTrackers??{})};
        trackers[active.attemptId]={authorId,createdAt:Date.now(),destination:active.job.destination.url,mechanism:active.job.destination.mechanism,pendingPostId:active.result.pendingPostId};
        await chrome.storage.local.set({ownContentTrackers:trackers});
      }
      data.pendingPostId=active.result.pendingPostId;
    }
    const saved = await workerRpc(connection, 'result', { protocol:2, delivery: active.job.id, attempt: active.attemptId, data });
    if(saved?.saved!==true)throw new Error('RESULT_SAVE_UNCONFIRMED');
    await chrome.storage.local.set({status:saved?.reviewed?'Este intento ya fue resuelto por una revisión registrada en RivaStock.':`Resultado guardado: ${active.result.message}`});
  } else {
    const saved=await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:active.existing?'record_existing':'result',p_delivery:active.job.id,p_status:active.result.status,p_url:active.result.url,p_message:active.result.message});
    await chrome.storage.local.set({status:saved?.reviewed?'Este intento ya fue resuelto por una revisión registrada en RivaStock.':`Resultado guardado: ${active.result.message}`});
  }
  await closeCompletedTab(active);
  await chrome.storage.local.remove('lastIssue');
  await chrome.storage.local.remove('activeJob');
}
export async function disconnectLocal(archiveUnresolved=false){
 await chrome.storage.local.set({paused:true});
 if(polling)throw new Error('El envío en curso está terminando. La cola quedó pausada; esperá su resultado antes de desconectar.');
 const state=await chrome.storage.local.get(['connection','activeJob','recoveryArchive','serverFeatures']);
 const {connection}=state;let active=state.activeJob;
 if(connection){try{await workerRpc(connection,'queue_state',{data:{status:'paused'}});}catch{/* Local pause remains effective; remote revocation is a separate action. */}}
 if(active){
  if(connection&&active.deviceId===connection.deviceId&&active.projectUrl===connection.url){
   try{
    // A receipt or a rejected capture is parked for review here too, so an
    // unsavable result never prevents disconnecting.
    if(active.stage==='result'){await persistResult(connection,active,state.serverFeatures);active=(await chrome.storage.local.get('activeJob')).activeJob??null;}
    else if(active.attemptId){const result=await workerRpc(connection,'recover',{protocol:2,attempt:active.attemptId,delivery:active.job.id});if(result.action==='retire'){await chrome.storage.local.remove('activeJob');active=null;}}
   }catch{/* The explicit archive path below preserves the unresolved reference. */}
  }
  if(active){
   // Never discard captured evidence just to permit pairing with another account.
   // An explicit archive keeps the captured result inside the archive itself.
   if(active.stage==='result'&&!archiveUnresolved)throw new Error('Hay evidencia de un resultado sin guardar. Recuperá la conexión para conservarla antes de desconectar.');
   if(!archiveUnresolved)throw new Error('Hay un intento sin resolver. Revisalo en RivaStock o confirmá el archivo de su referencia antes de desconectar.');
   if(state.recoveryArchive&&state.recoveryArchive.deliveryId!==active.job.id)throw new Error('Primero resolvé la recuperación archivada anterior en RivaStock.');
   await chrome.storage.local.set({recoveryArchive:{projectUrl:active.projectUrl,deviceId:active.deviceId,deliveryId:active.job.id,attemptId:active.attemptId??null,stage:active.stage,result:active.result??null,archivedAt:new Date().toISOString()}});
   await chrome.storage.local.remove('activeJob');
  }
 }
 await chrome.storage.local.remove(['connection','workerProtocol','pendingClaim','queueCommandAt','lastIssue']);
 await chrome.storage.session.remove('pendingConnection');await chrome.alarms.clear('rivastock-queue');
 if(connection)await chrome.permissions.remove({origins:[connection.url+'/*']});
 await chrome.storage.local.set({status:'Desconectada localmente. Revocá la PC anterior en RivaStock; la recuperación pendiente se conserva.'});
 return {done:true};
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'rivastock-queue') void poll(undefined,true); });
chrome.runtime.onInstalled.addListener(() => { void ensureQueueAlarm().then(poll).catch(()=>{}); });
chrome.runtime.onStartup.addListener(() => { void ensureQueueAlarm().then(()=>poll({source:'startup',received:performance.now(),receivedAt:new Date().toISOString()},true)).catch(()=>{}); });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if(message.type==='disconnect-local'&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('connect.html')){
    void disconnectLocal(message.archive===true).then(reply).catch(error=>reply({error:error.message}));return true;
  }
  if(message.type==='connection-ready'&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('connect.html')){
    void ensureQueueAlarm().then(()=>{reply({done:true});void poll(undefined,true);}).catch(error=>reply({error:error.message}));return true;
  }
  if(['groups-check','groups-refresh'].includes(message.type)&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('connect.html')){
    void (async()=>{try{const {connection}=await chrome.storage.local.get('connection');if(!connection)throw new Error('Vinculá esta PC desde RivaStock primero.');if(message.type==='groups-refresh'){await rpc(connection,'request_facebook_groups_from_device',{p_token:connection.token});await chrome.storage.local.remove('groupDiscoveryIssue');}const result=await syncGroups(connection,true);reply({accepted:true,...result});}catch(error){if(message.type==='groups-refresh')await chrome.storage.local.set({groupDiscoveryIssue:error.message,groupDiscoveryIssueStage:'request',groupDiscovery:{phase:'error',message:error.message,checkedAt:Date.now()}});reply({error:error.message});}})();return true;
  }
  if(message.type==='queue-control'&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('connect.html')&&typeof message.paused==='boolean') {
    void (async()=>{
      try {
        const {connection}=await chrome.storage.local.get('connection');
        if(!connection)throw new Error('Conectá esta PC primero.');
        const command=await workerRpc(connection,'queue_state',{data:{status:message.paused?'paused':'active'}});
        await chrome.storage.local.set({paused:message.paused,queueCommandAt:command.queue_command_at??null,status:message.paused?'Cola pausada. El envío en curso puede terminar.':'Cola activa. Revisando publicaciones aprobadas…'});
        if(!message.paused)void poll(undefined,true);
        reply({done:true});
      }catch(error){reply({error:error.message});}
    })();
    return true;
  }
  if(message.type==='diagnose'&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('connect.html')){
    void (async()=>{
      try{
        const state=await chrome.storage.local.get(['activeJob','connection','paused','workerProtocol','lastErrorCode']);
        const summary=diagnosticSummary(state);
        const tabs=await chrome.tabs.query({url:['https://www.facebook.com/marketplace/*','https://www.facebook.com/groups/*']});
        const own=tabs.filter(tab=>tab.id===state.activeJob?.tabId);
        const forms=tabs.filter(tab=>new URL(tab.url).pathname==='/marketplace/create/item');
        const candidates=own.length===1?own:forms.length===1?forms:[];
        if(candidates.length!==1){reply({...summary,details:{form:'No hay un único formulario identificado. El informe no modifica pestañas.'}});return;}
        const details=await facebookAdapter.action(candidates[0].id,'diagnose',{});
        reply({...summary,details});
      }catch{reply({error:'No se pudo inspeccionar un formulario inequívoco. Revisá su pestaña.'});}
    })();return true;
  }
  const stages=['Seleccionando categoría','Seleccionando estado','Completando descripción y ubicación','Cargando fotos','Verificando destinos antes de publicar'];
  if(sender.id===chrome.runtime.id&&sender.tab&&message.type==='progress'&&stages.includes(message.stage)) {
    void chrome.storage.local.get(['activeJob','connection']).then(async({activeJob,connection})=>{
      if(activeJob?.tabId===sender.tab.id&&activeJob.stage==='preparing') {
        await chrome.storage.local.set({status:`${message.stage}…`});
        if(connection)await workerRpc(connection,'progress',{delivery:activeJob.job.id,attempt:activeJob.attemptId,data:{message:message.stage}});
      }
    }).catch(()=>{});
    return;
  }
  if (sender.id !== chrome.runtime.id || message.type !== 'poll') return;
  void poll().then(() => reply({ done: true }));
  return true;
});
