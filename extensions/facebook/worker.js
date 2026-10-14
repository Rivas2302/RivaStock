import { facebookAdapter } from './adapter.js';
import { registerPairing } from './pairing.js';
registerPairing();

let polling = false;
export async function rpc(config, name, args) {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: config.key, ...(config.key.startsWith('ey') ? { Authorization: `Bearer ${config.key}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(20000), credentials: 'omit', redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'No se pudo conectar con RivaStock.');
  return data;
}
async function poll() {
  if (polling) return;
  polling = true;
  let heartbeatTimer;
  try {
    const { connection, paused, activeJob } = await chrome.storage.local.get(['connection','paused','activeJob']);
    if (!connection) return;
    await rpc(connection, 'facebook_worker', { p_token: connection.token, p_operation: 'heartbeat' });
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
          await chrome.storage.local.set({paused:true,status:error.message});
          await chrome.storage.local.remove('activeJob');
        }
      } else {
        await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'attention',p_delivery:activeJob.job.id,p_message:'Preparación interrumpida. Revisá la pestaña; no se repitió el envío.'});
        await chrome.storage.local.set({paused:true,status:'Preparación interrumpida. Revisá Facebook.'});
        await chrome.storage.local.remove('activeJob');
      }
      return;
    }
    if (paused !== false) { await chrome.storage.local.set({status:'Conectada. Cola pausada.'}); return; }
    const job = await rpc(connection, 'facebook_worker', { p_token: connection.token, p_operation: 'claim' });
    if (!job) { await chrome.storage.local.set({ status: 'Conectada. Sin trabajos pendientes.' }); return; }
    await chrome.storage.local.set({status:`Preparando ${job.destination.name ?? 'publicación'} en una pestaña de Facebook…`});
    try {
      // Persist the claim before any fetch/navigation so a service-worker restart
      // cannot forget an assigned job. Never resubmit a recovered active job.
      await chrome.storage.local.set({activeJob:{job,deviceId:connection.deviceId,projectUrl:connection.url,stage:'preparing'}});
      const active = await facebookAdapter.prepare(job,connection);
      await chrome.storage.local.set({activeJob:active});
      await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'checkpoint',p_delivery:job.id});
      await chrome.storage.local.set({activeJob:{...active,stage:'submitting'}});
      await chrome.storage.local.set({status:`Enviando ${job.destination.name ?? 'publicación'}… No cierres Chrome.`});
      await facebookAdapter.action(active.tabId,'submit',job.content);
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
      await chrome.storage.local.set({ status: error.message,paused:true });
      await chrome.storage.local.remove('activeJob');
    }
  } catch (error) {
    await chrome.storage.local.set({ status: `Conexión pausada: ${error.message}` });
  } finally { clearInterval(heartbeatTimer); polling = false; }
}
async function saveResult(connection, active) {
  await rpc(connection,'facebook_worker',{p_token:connection.token,p_operation:'result',p_delivery:active.job.id,p_status:active.result.status,p_url:active.result.url,p_message:active.result.message});
  await chrome.storage.local.set({status:`Resultado guardado: ${active.result.message}`});
  await chrome.storage.local.remove('activeJob');
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'rivastock-queue') void poll(); });
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create('rivastock-queue', { periodInMinutes: 1 }); });
chrome.runtime.onStartup.addListener(() => { void chrome.alarms.create('rivastock-queue', { periodInMinutes: 1 }); void poll(); });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.type !== 'poll') return;
  void poll().then(() => reply({ done: true }));
  return true;
});
