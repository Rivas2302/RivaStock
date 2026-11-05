import { facebookAdapter } from './adapter.js';
import { registerPairing } from './pairing.js';
import { discoverJoinedGroups, discoverGroupMembers } from './group-discovery.js';
import { closeAutomationTab } from './automation-tabs.js';
import { finishTrace, flushTraceQueue, startTrace, step as recordTraceStep, stepWithSequence, traceIdForJob } from './recorder.js';
import { collectPostSubmitObservations, POST_SUBMIT_SAMPLE_OFFSETS } from './post-submit.js';
import { isResultListUrl, isSupervisedResultAssessment } from './result-verification.js';
import { queueAlarmPeriodMinutes, shouldSkipPausedQueuePoll } from './polling-schedule.js';
registerPairing({wakeGroups:connection=>syncGroups(connection,true),wakePublications:signal=>{void poll(signal,true);},reviewUnknown:reviewHistoricalUnknown});
void flushTraceQueue();

let polling = false;
let pendingSignal=null;
let readingGroups = false;
let reviewingHistorical = false;

const capabilities=['attempts','causal-results','recovery','result-candidates','evidence-receipts','causal-results-v2','own-content-tracking'];
const POST_SUBMIT_QUEUE_KEY='pendingPostSubmitObservations';
let flushingPostSubmitObservations=false;
function extensionVersion(){try{return chrome.runtime.getManifest().version;}catch{return '0.5.21';}}
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
  if(reviewingHistorical)return {state:'busy'};
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
  const state=await chrome.storage.local.get(['connection','paused','activeJob','activeRehearsal','pendingClaim','pendingRehearsalClaim','ownContentTrackers']);
  const periodInMinutes=queueAlarmPeriodMinutes(state);
  if(periodInMinutes===null){await chrome.alarms.clear('rivastock-queue');return;}
  const alarm=await chrome.alarms.get('rivastock-queue');
  if(alarm?.periodInMinutes!==periodInMinutes)await chrome.alarms.create('rivastock-queue',{periodInMinutes});
}
// MV3 alarms may disappear across browser sessions or extension updates.
// Recreate them whenever the worker is loaded, respecting queue pause and active work.
void ensureQueueAlarm().catch(()=>{});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&['connection','paused','activeJob','activeRehearsal','pendingClaim','pendingRehearsalClaim','ownContentTrackers'].some(key=>key in changes))
    void ensureQueueAlarm().catch(()=>{});
});
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
async function sendPostSubmitObservations(connection,item){
  const response=await fetch(`${connection.url}/functions/v1/automation`,{
    method:'POST',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{apikey:connection.key,Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},
    body:JSON.stringify({action:'supervisor_worker',operation:'post_submit_observations',worker_id:connection.deviceId,
      id:item.attemptId,data:{post_submit_observations:item.observations}}),
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok||result?.saved!==true){
    const error=new Error('No se pudieron guardar las observaciones posteriores al envío.');
    error.status=response.status;
    throw error;
  }
}
async function flushPendingPostSubmitObservations(connection){
  if(flushingPostSubmitObservations||!connection)return;
  flushingPostSubmitObservations=true;
  try{
    const state=await chrome.storage.local.get(POST_SUBMIT_QUEUE_KEY);
    const queue=Array.isArray(state[POST_SUBMIT_QUEUE_KEY])?state[POST_SUBMIT_QUEUE_KEY]:[];
    for(const item of queue){
      if(item?.projectUrl!==connection.url||item?.deviceId!==connection.deviceId)continue;
      if(!Number.isFinite(item.queuedAt)||Date.now()-item.queuedAt>15*60*1000){
        await chrome.storage.local.set({[POST_SUBMIT_QUEUE_KEY]:queue.filter(entry=>entry.attemptId!==item.attemptId)});
        continue;
      }
      let saved=false;
      for(let attempt=0;attempt<3&&!saved;attempt++){
        try{await sendPostSubmitObservations(connection,item);saved=true;}
        catch(error){
          if(error.status&&error.status>=400&&error.status<500&&error.status!==409){
            await chrome.storage.local.set({postSubmitUploadIssue:'Facebook no aceptó el registro de observaciones.'});
            const current=await chrome.storage.local.get(POST_SUBMIT_QUEUE_KEY);
            const pending=Array.isArray(current[POST_SUBMIT_QUEUE_KEY])?current[POST_SUBMIT_QUEUE_KEY]:[];
            await chrome.storage.local.set({[POST_SUBMIT_QUEUE_KEY]:pending.filter(entry=>entry.attemptId!==item.attemptId)});
            break;
          }
          if(attempt<2)await new Promise(resolve=>setTimeout(resolve,attempt===0?400:1000));
        }
      }
      if(saved){
        const current=await chrome.storage.local.get(POST_SUBMIT_QUEUE_KEY);
        const pending=Array.isArray(current[POST_SUBMIT_QUEUE_KEY])?current[POST_SUBMIT_QUEUE_KEY]:[];
        await chrome.storage.local.set({[POST_SUBMIT_QUEUE_KEY]:pending.filter(entry=>entry.attemptId!==item.attemptId),postSubmitUploadIssue:null});
      }
    }
  }finally{flushingPostSubmitObservations=false;}
}
async function queuePostSubmitObservations(connection,attemptId,observations){
  if(!connection||typeof attemptId!=='string'||!Array.isArray(observations)||observations.length!==3)return;
  const state=await chrome.storage.local.get(POST_SUBMIT_QUEUE_KEY);
  const queue=Array.isArray(state[POST_SUBMIT_QUEUE_KEY])?state[POST_SUBMIT_QUEUE_KEY]:[];
  if(!queue.some(item=>item.attemptId===attemptId))queue.push({attemptId,deviceId:connection.deviceId,projectUrl:connection.url,queuedAt:Date.now(),observations});
  await chrome.storage.local.set({[POST_SUBMIT_QUEUE_KEY]:queue});
  await flushTraceQueue();
  await flushPendingPostSubmitObservations(connection);
}
async function completePostSubmitCapture(connection,active){
  let observations=Array.isArray(active.postSubmitObservations)?active.postSubmitObservations.slice():[];
  if(observations.length<POST_SUBMIT_SAMPLE_OFFSETS.length){
    const byOffset=new Map(observations.map(item=>[item.sample_offset_ms,item]));
    observations=POST_SUBMIT_SAMPLE_OFFSETS.map(sampleOffsetMs=>byOffset.get(sampleOffsetMs)??{
      sample_offset_ms:sampleOffsetMs,
      elapsed_ms:Math.min(120000,Math.max(0,Date.now()-(active.postSubmitStartedAt??Date.now()))),
      capture_status:'unavailable',trace_seq:null,alerts:[],new_urls:[],
    });
    active={...active,postSubmitObservations:observations};
    await chrome.storage.local.set({activeJob:active});
  }
  await queuePostSubmitObservations(connection,active.attemptId,observations);
  return active;
}
const SUPERVISION_WAIT_MS=90000;
const SUPERVISION_POLL_MS=1500;
async function requestFacebookSupervision(connection, descriptor) {
  if(!descriptor?.traceId||!Number.isSafeInteger(descriptor.stepSeq)||!descriptor.intent?.step||!descriptor.intent?.target)return null;
  const request=await rpc(connection,'facebook_supervision',{
    p_token:connection.token,p_operation:'request',p_id:null,
    p_data:{kind:'recover_step',trace_id:descriptor.traceId,step_seq:descriptor.stepSeq,intent:descriptor.intent,dom_summary:descriptor.domSummary},
  });
  if(!request?.id)return null;
  const deadline=Date.now()+SUPERVISION_WAIT_MS;
  while(Date.now()<deadline){
    const response=await rpc(connection,'facebook_supervision',{
      p_token:connection.token,p_operation:'poll',p_id:request.id,p_data:{},
    });
    if(response?.status==='answered'&&response.decision)return {id:request.id,decision:response.decision};
    if(['failed','expired'].includes(response?.status))return null;
    await new Promise(resolve=>setTimeout(resolve,SUPERVISION_POLL_MS));
  }
  return null;
}
async function requestFacebookResultVerification(connection, active, snapshot) {
  await flushTraceQueue();
  const traceId=await traceIdForJob(active.traceJobKey??active.attemptId);
  if(!traceId||!Number.isSafeInteger(snapshot?.trace_seq)||!snapshot?.dom_summary)return null;
  const approvedSubmission={
    title:String(active.job.content.title??'').slice(0,240),
    price:active.job.content.price,
    submitted_at:new Date(active.authorizedAt??active.postSubmitStartedAt??active.startedAt??Date.now()).toISOString(),
    ...(typeof active.job.content.photos?.[0]==='string'?{first_photo_url:active.job.content.photos[0]}:{}),
    post_submit_observations:Array.isArray(active.postSubmitObservations)?active.postSubmitObservations:[],
  };
  const intent={
    step:'verify_result.owned_content',intent_key:`verify_result:${active.job.destination.mechanism}`,
    objective:'Identify one newly appeared listing by matching its title, author and approved product image.',
    restrictions:['Read only. Do not interact with the page. Never invent an ID or URL. Select only a numbered card from the supplied DOM summary.'],
    supervisor_kind:'verify_result',
    approved_submission:approvedSubmission,
  };
  let request;
  try{
    request=await rpc(connection,'facebook_supervision',{
      p_token:connection.token,p_operation:'request',p_id:null,
      p_data:{kind:'verify_result',trace_id:traceId,step_seq:snapshot.trace_seq,intent,dom_summary:snapshot.dom_summary},
    });
  }catch{return null;}
  if(!request?.id)return null;
  const deadline=Date.now()+SUPERVISION_WAIT_MS;
  while(Date.now()<deadline){
    let response;
    try{
      response=await rpc(connection,'facebook_supervision',{
        p_token:connection.token,p_operation:'poll',p_id:request.id,p_data:{},
      });
    }catch{return null;}
    if(response?.status==='answered'&&isSupervisedResultAssessment(response.decision,snapshot.dom_summary))return response.decision;
    if(['failed','expired'].includes(response?.status))return null;
    await new Promise(resolve=>setTimeout(resolve,SUPERVISION_POLL_MS));
  }
  return null;
}
const REVIEW_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function historicalReviewJob(connection,review){
  if(!review||typeof review!=='object'||Array.isArray(review)||Object.keys(review).some(key=>!['deliveryId','attemptId','deviceId','authorizedAt','destination','content','postSubmitObservations'].includes(key)))
    throw new Error('La revisión histórica no tiene un formato válido.');
  if(!REVIEW_UUID.test(review.deliveryId??'')||!REVIEW_UUID.test(review.attemptId??'')||review.deviceId!==connection.deviceId
    ||typeof review.authorizedAt!=='string'||!Number.isFinite(Date.parse(review.authorizedAt)))
    throw new Error('El intento no tiene una autorización y una PC verificables.');
  const destination=review.destination;
  if(!destination||typeof destination!=='object'||!['marketplace','group_direct'].includes(destination.mechanism))
    throw new Error('El destino no es compatible con la revisión asistida.');
  if(destination.mechanism==='marketplace'&&destination.url!=='https://www.facebook.com/marketplace/create/item')
    throw new Error('El destino Marketplace no coincide con la ruta permitida.');
  if(destination.mechanism==='group_direct'&&!/^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9._-]+\/?$/.test(destination.url??''))
    throw new Error('El destino de grupo no coincide con la ruta permitida.');
  const content=review.content;
  if(!content||typeof content!=='object'||typeof content.title!=='string'||!content.title.trim()||content.title.length>100
    ||!Number.isFinite(content.price)||content.price<=0||typeof content.description!=='string'||content.description.length>5000
    ||!Array.isArray(content.photos)||content.photos.length<1||content.photos.length>10)
    throw new Error('Faltan datos aprobados para identificar la publicación.');
  const photo=new URL(content.photos[0]);
  if(photo.origin!==connection.url||!photo.pathname.startsWith('/storage/v1/object/public/'))
    throw new Error('La foto aprobada no pertenece al almacenamiento de esta cuenta.');
  const observations=Array.isArray(review.postSubmitObservations)?review.postSubmitObservations.slice(0,3):[];
  return {
    id:review.deliveryId,attemptId:review.attemptId,
    destination:{mechanism:destination.mechanism,url:destination.url,name:String(destination.name??'Destino').slice(0,120)},
    content:{title:content.title,description:content.description,price:content.price,photos:content.photos.slice(0,10),
      location:String(content.location??'').slice(0,120),category:String(content.category??'').slice(0,120),condition:content.condition,
      ...(typeof content.groupText==='string'?{groupText:content.groupText.slice(0,6000)}:{})},
    authorizedAt:review.authorizedAt,postSubmitObservations:observations,
  };
}
async function reviewHistoricalUnknown(connection,review){
  if(reviewingHistorical||polling||readingGroups)
    throw new Error('La PC está ocupada con otra ejecución. Esperá a que termine antes de revisar este resultado.');
  reviewingHistorical=true;
  let traceJobKey=null;
  let reviewStored=false;
  let finalStatus='La revisión histórica no se completó.';
  try{
    const state=await chrome.storage.local.get(['connection','activeJob','activeRehearsal','historicalReview','workerProtocol','serverFeatures','paused']);
    if(state.activeJob||state.activeRehearsal||state.historicalReview)
      throw new Error('La PC está ocupada con otra ejecución. Esperá a que termine antes de revisar este resultado.');
    if(state.connection?.token!==connection.token||state.connection?.deviceId!==connection.deviceId||state.connection?.url!==connection.url)
      throw new Error('La conexión cambió; no se inició la revisión.');
    if((state.workerProtocol??1)<2)throw new Error('Actualizá la extensión para habilitar la revisión asistida.');
    const job=historicalReviewJob(connection,review);
    const heartbeat=await workerRpc(connection,'heartbeat',{protocol:2,status:state.paused===false?'active':'paused'});
    const features=heartbeat?.features??state.serverFeatures??[];
    if(!features.includes('result-candidates'))throw new Error('El servidor no admite guardar candidatas para confirmación.');
    traceJobKey=`historical-review:${crypto.randomUUID()}`;
    const active={job,attemptId:job.attemptId,deviceId:connection.deviceId,projectUrl:connection.url,stage:'reviewing',protocol:2,
      traceJobKey,authorizedAt:job.authorizedAt,postSubmitObservations:job.postSubmitObservations,baseline:[],tabId:null};
    await chrome.storage.local.set({historicalReview:active,status:'Revisando las listas propias de Facebook sin volver a enviar…'});
    reviewStored=true;
    await startTrace('real',{...job,traceKey:traceJobKey,traceSummary:{purpose:'historical_unknown_review'}});
    await flushTraceQueue();
    if(!await traceIdForJob(traceJobKey))throw new Error('No se pudo iniciar la traza de revisión.');
    await recordTraceStep('historical_review_started','ok',{capture:false,jobKey:traceJobKey,note:'Lectura de listas propias; no se autoriza ni se ejecuta un envío.'});
    const outcome=await facebookAdapter.reviewHistoricalResult(active,{
      requestVerifyResult:snapshot=>requestFacebookResultVerification(connection,active,snapshot),
      recordTraceStep:(step,status,options)=>recordTraceStep(step,status,{...options,jobKey:traceJobKey}),
    });
    if(outcome.candidateUrl){
      await workerRpc(connection,'attention',{protocol:2,delivery:job.id,attempt:job.attemptId,data:{
        message:'La IA encontró una candidata en la lista propia. Confirmala en el historial antes de asociarla al intento.',candidateUrl:outcome.candidateUrl,
      }});
    }
    await recordTraceStep('historical_review_completed',outcome.candidateUrl?'supervised':'ok',{
      capture:false,jobKey:traceJobKey,note:outcome.candidateUrl?'Se guardó una candidata para confirmación humana. El estado del envío no cambió.':'No se encontró una candidata verificable; el intento sigue requiriendo revisión humana.',
    });
    await finishTrace('completed',{historical_review:true,candidate_found:Boolean(outcome.candidateUrl)},traceJobKey);
    await flushTraceQueue();
    finalStatus=outcome.candidateUrl?'Revisión finalizada. Hay una candidata para confirmar en RivaStock.':'Revisión finalizada. El resultado sigue pendiente de revisión manual.';
    return outcome.candidateUrl
      ?{candidateFound:true,message:'La IA encontró una candidata. Confirmala desde el historial; el intento sigue sin cambiar de estado.'}
      :{candidateFound:false,message:'No se encontró una candidata verificable. El intento sigue disponible para revisión manual.'};
  }catch(error){
    if(traceJobKey){
      await finishTrace('failed',{historical_review:true,reason:String(error?.message??'review_failed').slice(0,160)},traceJobKey).catch(()=>{});
      await flushTraceQueue().catch(()=>{});
    }
    throw error;
  }finally{
    if(reviewStored){await chrome.storage.local.remove('historicalReview');await chrome.storage.local.set({status:finalStatus});}
    reviewingHistorical=false;
    const next=pendingSignal;pendingSignal=null;
    if(next)setTimeout(()=>void poll(next,true),0);
  }
}
async function loadFacebookSupervisionHints(connection,step){
  const result=await rpc(connection,'facebook_supervision',{
    p_token:connection.token,p_operation:'hints',p_id:null,p_data:{step},
  });
  return Array.isArray(result?.hints)?result.hints:[];
}
async function reportFacebookSupervisionOutcome(connection,requestId,success,match,step,observation,tabId){
  try{
    await rpc(connection,'facebook_supervision',{
      p_token:connection.token,p_operation:'report_outcome',p_id:requestId,p_data:{success,match},
    });
  }finally{
    await recordTraceStep(`supervision.${String(step).slice(0,140)}`,success?'supervised':'retry',{
      tabId,capture:false,note:`${success?'Revalidación determinista aprobada':'La revalidación determinista no resolvió el paso'}. ${String(observation??'').slice(0,300)}`,
    });
  }
}
async function recordLearnedHintUse(step,tabId){
  await recordTraceStep(`hint.${String(step).slice(0,150)}`,'supervised',{
    tabId,capture:false,note:'Se resolvió con una pista aprendida; no se solicitó una nueva decisión IA.',
  });
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
async function finishRehearsal(connection, active, outcome, errorStep = null, summary = {}) {
  const rehearsalId=active?.rehearsalId??active?.job?.id;
  if(!rehearsalId)throw new Error('REHEARSAL_STALE');
  if(!active.traceFinished) {
    await finishTrace(outcome==='rehearsal_ok'?'rehearsal_ok':'failed',{...summary,...(errorStep?{error_step:errorStep}:{})},rehearsalId);
    active={...active,traceFinished:true,stage:'finalizing'};
    await chrome.storage.local.set({activeRehearsal:active});
    await flushTraceQueue();
  }
  const traceId=active.traceId??await traceIdForJob(rehearsalId);
  if(outcome==='rehearsal_ok'&&!traceId)throw new Error('REHEARSAL_TRACE_MISSING');
  const result=await rpc(connection,'facebook_rehearsal_worker',{
    p_token:connection.token,
    p_operation:'finish',
    p_id:rehearsalId,
    p_data:{outcome,...(errorStep?{error_step:String(errorStep).slice(0,160)}:{}),summary},
  });
  await closeAutomationTab(active.tabId);
  await chrome.storage.local.remove(['activeRehearsal','pendingRehearsalClaim']);
  await chrome.storage.local.set({status:result?.status==='rehearsal_ok'?'Ensayo terminado sin publicar.':'Ensayo finalizado con un bloqueo antes de publicar.'});
  return result;
}

async function processRehearsal(connection, rehearsal, claimKey) {
  const rehearsalId=rehearsal.id;
  const job={...rehearsal,rehearsalId,id:rehearsalId,content:{...rehearsal.content,rehearsal:true,rehearsalId}};
  let active={rehearsalId,claimKey,job,deviceId:connection.deviceId,projectUrl:connection.url,stage:'claimed',validated:false,traceFinished:false};
  await chrome.storage.local.set({activeRehearsal:active});
  try {
    await startTrace('rehearsal',{...job,rehearsalId});
    await flushTraceQueue();
    active={...active,traceId:await traceIdForJob(rehearsalId),traceStarted:true};
    await chrome.storage.local.set({activeRehearsal:active});
    if(!active.traceId)throw new Error('REHEARSAL_TRACE_MISSING');
    await recordTraceStep('rehearsal_claimed','ok',{capture:false,jobKey:rehearsalId});
    const prepared=await facebookAdapter.prepare(job,{...connection,rehearsalId,journalIdentity:active});
    active={...active,...prepared,job,traceId:active.traceId,validated:false};
    await chrome.storage.local.set({activeRehearsal:active});
    await recordTraceStep('rehearsal_form_prepared','ok',{tabId:active.tabId,capture:true,jobKey:rehearsalId});
    await facebookAdapter.action(active.tabId,'validate_submit',job.content,[],active.baseline);
    active={...active,validated:true,stage:'validated'};
    await chrome.storage.local.set({activeRehearsal:active});
    await recordTraceStep('rehearsal_final_validation_passed','ok',{tabId:active.tabId,capture:true,jobKey:rehearsalId});
    await facebookAdapter.discardRehearsalDraft(active);
    active={...active,draftDiscarded:true,stage:'discarded'};
    await chrome.storage.local.set({activeRehearsal:active});
    await closeAutomationTab(active.tabId);
    return await finishRehearsal(connection,active,'rehearsal_ok',null,{validated:true,draft_discarded:true});
  } catch(error) {
    const message=String(error?.message??'REHEARSAL_FAILED').slice(0,160);
    const persisted=(await chrome.storage.local.get('activeRehearsal')).activeRehearsal;
    if(persisted?.rehearsalId===rehearsalId)active={...active,...persisted,job:job};
    let draftClean=!active.tabId;
    if(active.tabId) {
      try{await facebookAdapter.discardRehearsalDraft(active);draftClean=true;await closeAutomationTab(active.tabId);}catch{/* Keep the active journal until Facebook confirms the discard. */}
    }
    if(!draftClean) {
      await chrome.storage.local.set({activeRehearsal:{...active,stage:'needs_review',lastError:message}});
      throw error;
    }
    try{return await finishRehearsal(connection,active,'failed',message,{validated:Boolean(active.validated),draft_discarded:Boolean(active.draftDiscarded)});}
    catch(finishError){
      await chrome.storage.local.set({activeRehearsal:{...active,stage:'needs_review',lastError:String(finishError?.message??'REHEARSAL_FINISH_FAILED').slice(0,160)}});
      throw finishError;
    }
  }
}

async function recoverActiveRehearsal(connection, active) {
  let clean=Boolean(active.draftDiscarded);
  if(active.tabId&&!clean) {
    try { await facebookAdapter.discardRehearsalDraft(active);clean=true; }
    catch { clean=false; }
  }
  if(!clean) {
    await chrome.storage.local.set({activeRehearsal:{...active,stage:'needs_review',lastError:'Facebook no confirmó el descarte del borrador.'},status:'Ensayo interrumpido; no se confirmó el descarte del borrador.'});
    return false;
  }
  if(active.tabId&&clean)await closeAutomationTab(active.tabId);
  const successful=Boolean(active.validated&&clean&&active.traceId);
  await finishRehearsal(connection,active,successful?'rehearsal_ok':'failed',successful?null:'worker_interrupted',
    {validated:Boolean(active.validated),draft_discarded:clean,recovered_after_worker_restart:true});
  return true;
}

async function claimAndProcessRehearsal(connection, saved) {
  const pending=saved.pendingRehearsalClaim;
  const claimKey=pending?.deviceId===connection.deviceId&&pending.projectUrl===connection.url?pending.claimKey:crypto.randomUUID();
  await chrome.storage.local.set({pendingRehearsalClaim:{claimKey,deviceId:connection.deviceId,projectUrl:connection.url}});
  const rehearsal=await rpc(connection,'facebook_rehearsal_worker',{
    p_token:connection.token,p_operation:'claim',p_data:{claimKey},
  });
  if(!rehearsal?.id) {
    await chrome.storage.local.remove('pendingRehearsalClaim');
    return false;
  }
  await processRehearsal(connection,rehearsal,claimKey);
  return true;
}

export async function poll(signal={source:'alarm',received:performance.now(),receivedAt:new Date().toISOString()},chain=false){
  if(polling||reviewingHistorical){pendingSignal=signal;return;}
  polling=true;const lifetime=globalThis.chrome;let heartbeatTimer;let drain=false;
  try{
    const saved=await chrome.storage.local.get(['connection','paused','activeJob','activeRehearsal','lastIssue','status','queueCommandAt','pendingClaim','pendingRehearsalClaim','ownContentTrackers','workerProtocol','serverFeatures']);
    let serverFeatures=saved.serverFeatures??[];
    const {connection,activeJob}=saved;if(!connection)return;
    const hasInProgressWork=Boolean(activeJob||saved.activeRehearsal||saved.pendingClaim||saved.pendingRehearsalClaim||Object.keys(saved.ownContentTrackers??{}).length>0);
    if(shouldSkipPausedQueuePoll(saved,signal)){
      await chrome.alarms.clear('rivastock-queue');
      await chrome.storage.local.set({status:'Conectada. Cola pausada.'});
      return;
    }
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
    if(paused!==false&&!hasInProgressWork){
      await chrome.alarms.clear('rivastock-queue');
      await chrome.storage.local.set({status:'Conectada. Cola pausada.'});
      return;
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
    },30_000);
    await flushPendingPostSubmitObservations(connection);
    if(activeJob){
      if(activeJob.deviceId!==connection.deviceId||activeJob.projectUrl!==connection.url){await chrome.storage.local.set({paused:true,status:'Hay un envío de otra conexión pendiente de revisar. No se ejecutó con esta cuenta.'});return;}
      // Captured evidence must be persisted before asking whether the attempt was retired.
      if(activeJob.stage==='result'){await finishTrace('completed',{result:'captured'});await persistResult(connection,activeJob,serverFeatures);drain=true;return;}
      try{
        if(activeJob.attemptId){
          await startTrace('real',{...activeJob.job,attemptId:activeJob.attemptId});
          const recovery=await workerRpc(connection,'recover',{protocol:2,delivery:activeJob.job.id,attempt:activeJob.attemptId});
          if(recovery?.action==='retire'){await finishTrace('aborted',{reason:'attempt_retired'});await closeAutomationTab(activeJob.tabId);await chrome.storage.local.remove('activeJob');await chrome.storage.local.set({status:'Intento anterior registrado para revisión; la cola puede continuar.'});drain=true;return;}
          if(recovery?.action!=='reconcile_only')throw new Error('ATTEMPT_STALE');
        }else if(activeJob.stage!=='submitting'&&activeJob.stage!=='authorizing'){
          await finishTrace('aborted',{reason:'preparation_interrupted'});
          await markAttention(connection,activeJob,'Preparación interrumpida. No se repitió el envío.',{serverFeatures});drain=true;return;
        }
        if(activeJob.stage==='submitting')await completePostSubmitCapture(connection,activeJob);
        await recordTraceStep('reconciliation_started','ok',{capture:false});
        const result=await facebookAdapter.reconcile(activeJob,{
          requestVerifyResult:snapshot=>requestFacebookResultVerification(connection,activeJob,snapshot),
          recordTraceStep:(step,status,options)=>recordTraceStep(step,status,{...options,jobKey:activeJob.attemptId}),
        });
        const completed={...activeJob,stage:'result',result};await chrome.storage.local.set({activeJob:completed});await finishTrace('completed',{result_status:result.status});await persistResult(connection,completed,serverFeatures);drain=true;
      }catch(error){
        if((await chrome.storage.local.get('activeJob')).activeJob?.stage==='result')throw error;
        if(activeJob.tabId)await recordTraceStep('worker_failure','failed',{tabId:activeJob.tabId,capture:true});
        await finishTrace(['submitting','authorizing'].includes(activeJob.stage)?'failed':'aborted',{stage:activeJob.stage});
        await markAttention(connection,activeJob,error.message,{issue:error.issue,code:error.code,candidateUrl:error.candidateUrl,receipt:error.receipt,serverFeatures});drain=true;
      }
      return;
    }
    if(saved.activeRehearsal) {
      drain=await recoverActiveRehearsal(connection,saved.activeRehearsal);
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
    if(!job){
      await chrome.storage.local.remove('pendingClaim');
      const rehearsalProcessed=await claimAndProcessRehearsal(connection,saved);
      if(rehearsalProcessed){drain=true;return;}
      if(chain)void maintainGroups(connection);
      await chrome.storage.local.set({status:saved.lastIssue?'Cola activa. Último envío requiere revisión: '+saved.lastIssue:'Conectada. Sin trabajos pendientes.'});
      return;
    }
    const identity={schemaVersion:2,claimKey,attemptId:job.attemptId,protocol};
    let active={...identity,job,deviceId:connection.deviceId,projectUrl:connection.url,stage:'preparing'};
    await chrome.storage.local.set({activeJob:active});await chrome.storage.local.remove('pendingClaim');
    await startTrace('real',{...job,attemptId:job.attemptId});
    await recordTraceStep('job_claimed','ok',{capture:false});
    if(job.recovered){pendingSignal={source:'drain',received:performance.now(),receivedAt:new Date().toISOString()};return;}
    try{
      await chrome.storage.local.set({status:'Preparando '+(job.destination.name??'publicación')+' en una pestaña de Facebook…'});
      void workerRpc(connection,'progress',{protocol,delivery:job.id,attempt:job.attemptId,message:'Preparando '+(job.destination.name??'publicación')}).catch(()=>{});
      const preparationStart=performance.now();
      const timing={source:signal.source,receivedAt:signal.receivedAt,receipt_to_claim_ms:preparationStart-signal.received,claim_rpc_ms:preparationStart-claimStart,receipt_to_preparation_ms:preparationStart-signal.received};
      const reportTiming=()=>rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'latency',p_delivery:job.id,p_message:JSON.stringify(timing)}).catch(()=>{});
      if(protocol<2)void reportTiming();
      await recordTraceStep('facebook_navigation_started','ok',{capture:false});
      active={...await facebookAdapter.prepare(job,{
        ...connection,journalIdentity:identity,onTiming:(phase,elapsed)=>{timing[phase]=elapsed;},
        loadSupervisionHints:step=>loadFacebookSupervisionHints(connection,step),
        requestSupervision:descriptor=>requestFacebookSupervision(connection,descriptor),
        reportSupervisionOutcome:(id,success,match,step,observation,tabId)=>reportFacebookSupervisionOutcome(connection,id,success,match,step,observation,tabId),
        onLearnedHintUsed:(step,tabId)=>recordLearnedHintUse(step,tabId),
      }),...identity};
      timing.preparation_ms=performance.now()-preparationStart;if(protocol<2)void reportTiming();
      await chrome.storage.local.set({activeJob:active});
      await recordTraceStep('form_prepared','ok',{tabId:active.tabId,capture:true});
      if(active.existing){const completed={...active,stage:'result'};await chrome.storage.local.set({activeJob:completed});await finishTrace('completed',{result:'existing_content'});await saveResult(connection,completed);drain=true;return;}
      const before=await chrome.storage.local.get(['paused','connection']);
      if(before.paused!==false||before.connection?.token!==connection.token)throw new Error('Cola pausada o conexión cambiada antes del envío. No se publicó.');
      const finalValidation=await facebookAdapter.action(active.tabId,'validate_submit',job.content,[],active.baseline);
      active={...active,postSubmitBaselineUrls:Array.isArray(finalValidation?.visible_urls)?finalValidation.visible_urls:[]};
      await chrome.storage.local.set({activeJob:active});
      await recordTraceStep('final_validation_passed','ok',{capture:false});
      const afterValidation=await chrome.storage.local.get(['paused','connection']);
      if(afterValidation.paused!==false||afterValidation.connection?.token!==connection.token)throw new Error('Cola pausada o conexión cambiada antes del envío. No se publicó.');
      await chrome.storage.local.set({activeJob:{...active,stage:'authorizing'}});
      await recordTraceStep('checkpoint_requested','ok',{capture:false});
      const checkpoint=await workerRpc(connection,'checkpoint',{protocol,delivery:job.id,attempt:job.attemptId});
      if(checkpoint?.authorized!==true||(protocol>=2&&checkpoint.phase!=='authorized_now'))throw new Error('RESULT_UNKNOWN: no se concedió una nueva autorización de envío.');
      await recordTraceStep('checkpoint_authorized','ok',{capture:false});
      active={...active,stage:'submitting',postSubmitStartedAt:Date.now()};
      await chrome.storage.local.set({activeJob:active,status:'Enviando a Facebook; resultado todavía sin confirmar…'});
      // A click that navigates destroys the frame before replying; reconcile instead of failing.
      try{await facebookAdapter.action(active.tabId,'submit',job.content,[],active.baseline);}
      catch(error){if(errorCode(error)!=='TAB_LOST'&&error.message!=='No se pudo verificar el formulario de Facebook.')throw error;}
      const observationStart=performance.now();
      await collectPostSubmitObservations({
        startedAt:observationStart,
        sample:async({sampleOffsetMs,elapsedMs})=>await facebookAdapter.action(active.tabId,'post_submit_observe',{
          sample_offset_ms:sampleOffsetMs,elapsed_ms:elapsedMs,baseline_urls:active.postSubmitBaselineUrls??[],
        },[],active.baseline),
        persist:async observations=>{
          active={...active,postSubmitObservations:observations};
          await chrome.storage.local.set({activeJob:active});
        },
      });
      active=await completePostSubmitCapture(connection,active);
      await recordTraceStep('post_click_observation','ok',{tabId:active.tabId,capture:true});
      const result=await facebookAdapter.reconcile(active,{
        requestVerifyResult:snapshot=>requestFacebookResultVerification(connection,active,snapshot),
        recordTraceStep:(step,status,options)=>recordTraceStep(step,status,{...options,jobKey:active.attemptId}),
      });
      const completed={...active,stage:'result',result};await chrome.storage.local.set({activeJob:completed});await finishTrace('completed',{result_status:result.status});await persistResult(connection,completed,serverFeatures);drain=true;
    }catch(error){
      const journal=(await chrome.storage.local.get('activeJob')).activeJob;
      if(journal?.stage==='result')throw error;
      if((journal??active).tabId)await recordTraceStep('worker_failure','failed',{tabId:(journal??active).tabId,capture:true});
      await finishTrace(['submitting','authorizing'].includes(journal?.stage??active.stage)?'failed':'aborted',{stage:journal?.stage??active.stage});
      await markAttention(connection,journal??active,error.message,{issue:error.issue,code:error.code,candidateUrl:error.candidateUrl,receipt:error.receipt,serverFeatures});drain=true;
    }
  }catch(error){
    const code=errorCode(error);await chrome.storage.local.set({lastErrorCode:code,status:code==='NETWORK_TEMPORARY'?'Sin conexión momentánea. Se reintentará automáticamente.':code==='DEVICE_REVOKED'||code==='TOKEN_EXPIRED'?'La vinculación venció o fue revocada. Revisá la conexión antes de continuar.':'La ejecución requiere revisión: '+code});
  }finally{
    clearInterval(heartbeatTimer);polling=false;const next=pendingSignal;pendingSignal=null;
    void ensureQueueAlarm().catch(()=>{});
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
 if(connection)await chrome.permissions.remove({origins:[connection.url+'/*','<all_urls>']});
 await chrome.storage.local.set({status:'Desconectada localmente. Revocá la PC anterior en RivaStock; la recuperación pendiente se conserva.'});
 return {done:true};
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'rivastock-queue') void poll(undefined,true);
  if (alarm.name === 'rivastock-trace-upload') void flushTraceQueue();
});
chrome.runtime.onInstalled.addListener(() => { void ensureQueueAlarm().then(()=>{void flushTraceQueue();return poll();}).catch(()=>{}); });
chrome.runtime.onStartup.addListener(() => { void ensureQueueAlarm().then(()=>{void flushTraceQueue();return poll({source:'startup',received:performance.now(),receivedAt:new Date().toISOString()},true);}).catch(()=>{}); });
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
  if(message.type==='trace-step'&&sender.id===chrome.runtime.id&&sender.tab&&typeof message.step==='string'){
    void chrome.storage.local.get(['activeJob','activeRehearsal','historicalReview','automationTabIds']).then(async({activeJob,activeRehearsal,historicalReview,automationTabIds})=>{
      const postSubmitStep=['post_click_observation','post_submit_0ms','post_submit_3000ms','post_submit_8000ms'].includes(message.step);
      const supervisedResultStep=message.step==='supervised_result_list'&&activeJob?.stage==='submitting'
        &&Boolean(activeJob.attemptId)&&Number.isSafeInteger(sender.tab.id)
        &&Array.isArray(automationTabIds)&&automationTabIds.includes(sender.tab.id)
        &&isResultListUrl(activeJob.job,sender.tab.url);
      const supervisedReviewStep=message.step==='supervised_result_list'&&historicalReview?.stage==='reviewing'
        &&Boolean(historicalReview.attemptId)&&Number.isSafeInteger(sender.tab.id)
        &&Array.isArray(automationTabIds)&&automationTabIds.includes(sender.tab.id)
        &&isResultListUrl(historicalReview.job,sender.tab.url);
      const real=(activeJob?.tabId===sender.tab.id&&(activeJob.stage==='preparing'||(activeJob.stage==='submitting'&&postSubmitStep))
        ||supervisedResultStep)?activeJob:supervisedReviewStep?historicalReview:null;
      const rehearsal=activeRehearsal?.tabId===sender.tab.id?activeRehearsal:null;
      const jobKey=real?.traceJobKey??real?.attemptId??rehearsal?.rehearsalId;
      if(!jobKey){reply({queued:false});return;}
      const seq=await stepWithSequence(message.step,message.status??'ok',{
        capture:message.capture===true,domSummary:message.domSummary,tabId:sender.tab.id,jobKey,
      });
      if(!postSubmitStep)await flushTraceQueue();
      else void flushTraceQueue();
      const traceId=jobKey?await traceIdForJob(jobKey):null;
      reply({queued:typeof seq==='number',seq,traceId});
    }).catch(()=>reply({queued:false}));
    return true;
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
  void poll({source:'local',received:performance.now(),receivedAt:new Date().toISOString()}).then(() => reply({ done: true }));
  return true;
});
