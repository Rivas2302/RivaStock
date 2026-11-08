export function publicSupabaseProjectUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Proyecto inválido.');
  return url.origin;
}

export function isPublishableSupabaseKey(value) {
  return typeof value === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(value);
}

export function publicConnection(message) {
  const projectUrl = publicSupabaseProjectUrl(message.url);
  const key = message.key;
  if (!isPublishableSupabaseKey(key)) throw new Error('Usá únicamente la clave publishable.');
  if (!/^[a-f0-9]{64}$/.test(message.code)) throw new Error('Código inválido.');
  return {url:projectUrl,key,code:message.code,expiresAt:Date.now()+5*60*1000};
}

export function trustedPairingSender(sender) {
  try {
    const url = new URL(sender.url);
    return !sender.id && sender.tab?.id !== undefined && sender.frameId === 0 && url.origin === 'https://rivastock.vercel.app' && ['/stock','/config','/automatizaciones','/revendedores'].includes(url.pathname);
  } catch { return false; }
}

function trustedSupplierCaptureSender(sender) {
  return trustedPairingSender(sender) && new URL(sender.url).pathname === '/revendedores';
}

export function registerPairing({wakeGroups,wakePublications,reviewUnknown,getCapture,getCaptureImage,acknowledgeCapture} = {}) {
  chrome.runtime.onMessageExternal?.addListener((message,sender,reply) => {
    if (!trustedPairingSender(sender)) return;
    if (trustedSupplierCaptureSender(sender) && message?.type === 'rivastock-get-capture' && typeof getCapture === 'function') {
      void Promise.resolve(getCapture(message.captureId, message.offset)).then(reply).catch(error => reply({ error: error?.message ?? 'La captura ya no está disponible.' }));
      return true;
    }
    if (trustedSupplierCaptureSender(sender) && message?.type === 'rivastock-capture-received' && typeof acknowledgeCapture === 'function') {
      void Promise.resolve(acknowledgeCapture(message.captureId)).then(reply).catch(() => reply({ received: false }));
      return true;
    }
    if (trustedSupplierCaptureSender(sender) && message?.type === 'supplier-capture-read-image' && typeof getCaptureImage === 'function') {
      void Promise.resolve(getCaptureImage(message.captureId, message.imageUrl)).then(reply).catch(error => reply({ error: error?.message ?? 'La foto no está disponible.' }));
      return true;
    }
    if (message?.type === 'rivastock-installed') { reply({installed:true,protocol:2,connectionStatus:true,publicKeyRefresh:true,version:chrome.runtime.getManifest?.().version,groupsWake:typeof wakeGroups==='function',publicationsWake:typeof wakePublications==='function',historicalReview:typeof reviewUnknown==='function'}); return; }
    if (message?.type === 'rivastock-update-public-key') {
      void (async () => {
        try {
          const projectUrl = publicSupabaseProjectUrl(message.projectUrl);
          if (projectUrl !== message.projectUrl || !isPublishableSupabaseKey(message.key)) throw new Error();
          const { connection, activeJob } = await chrome.storage.local.get(['connection', 'activeJob']);
          if (!connection || connection.url !== projectUrl) { reply({ updated: false, keyChanged: false }); return; }
          if (activeJob) { reply({ updated: false, keyChanged: false, busy: true }); return; }
          const keyChanged = connection.key !== message.key;
          if (keyChanged) await chrome.storage.local.set({ connection: { ...connection, key: message.key } });
          reply({ updated: true, keyChanged });
        } catch {
          reply({ error: 'No se pudo actualizar la clave pública de esta conexión.' });
        }
      })();
      return true;
    }
    if(['rivastock-connection-status','rivastock-open-connection'].includes(message?.type)){
      void (async()=>{
        try{
          if(message.type==='rivastock-open-connection'){await chrome.tabs.create({url:chrome.runtime.getURL('connect.html'),active:true});reply({opened:true});return;}
          const state=await chrome.storage.local.get(['connection','activeJob','paused','lastErrorCode','recoveryArchive']);
          const pending=await chrome.storage.session?.get('pendingConnection');
          const matches=Boolean(state.connection&&state.connection.url===message.projectUrl&&Array.isArray(message.deviceIds)&&message.deviceIds.includes(state.connection.deviceId));
          reply({pairingPending:Boolean(pending?.pendingConnection?.expiresAt>Date.now()),hasConnection:Boolean(state.connection),matches,hasActiveJob:Boolean(state.activeJob),paused:state.paused!==false,errorCode:state.lastErrorCode??null,recoveryPending:Boolean(state.recoveryArchive)});
        }catch{reply({error:'No se pudo consultar el estado local de la extensión.'});}
      })();return true;
    }
    if(message?.type==='rivastock-wake-publications'&&typeof wakePublications==='function'){
      const received=performance.now();
      const receivedAt=new Date().toISOString();
      void (async()=>{
        try{
          const {connection}=await chrome.storage.local.get('connection');
          if(!connection||connection.url!==message.projectUrl||!Array.isArray(message.deviceIds)||!message.deviceIds.includes(connection.deviceId))throw new Error('La extensión no corresponde a las computadoras vinculadas de esta cuenta.');
          // This is a scheduling hint only. Claim/checkpoint still enforce
          // account, explicit approval, pause and duplicate protection.
          wakePublications({source:'local',received,receivedAt});
          reply({accepted:true,receivedAt});
        }catch(error){reply({error:error.message});}
      })();
      return true;
    }
    if(message?.type==='rivastock-wake-groups'&&typeof wakeGroups==='function'){
      void (async()=>{
        try{
          const {connection}=await chrome.storage.local.get('connection');
          if(!connection||connection.deviceId!==message.deviceId||connection.url!==message.projectUrl)throw new Error('Esta extensión no está vinculada a la PC elegida y a esta cuenta. Revisá la conexión en Configuración.');
          // Only wake the read-only group request, never the publication queue.
          const result=await wakeGroups(connection);reply({accepted:true,...result});
        }catch(error){reply({error:error.message});}
      })();
      return true;
    }
    if(message?.type==='rivastock-review-unknown'&&typeof reviewUnknown==='function'){
      void (async()=>{
        try{
          const {connection}=await chrome.storage.local.get('connection');
          if(!connection||connection.url!==message.projectUrl||connection.deviceId!==message.deviceId
            ||!Array.isArray(message.deviceIds)||!message.deviceIds.includes(connection.deviceId))
            throw new Error('La extensión no corresponde a la PC que registró este intento.');
          const result=await reviewUnknown(connection,message.review);
          reply({accepted:true,...result});
        }catch(error){reply({error:error?.message??'No se pudo revisar el resultado histórico.'});}
      })();
      return true;
    }
    if (message?.type !== 'rivastock-connect') return;
    void (async () => {
      try {
        const pending = publicConnection(message);
        const {connection,activeJob} = await chrome.storage.local.get(['connection','activeJob']);
        if (connection || activeJob) throw new Error('Desconectá la vinculación anterior antes de conectar otra cuenta.');
        await chrome.storage.session.set({pendingConnection:pending});
        await chrome.tabs.create({url:chrome.runtime.getURL('connect.html'),active:true});
        reply({pending:true});
      } catch(error) { reply({error:error.message}); }
    })();
    return true;
  });
}
