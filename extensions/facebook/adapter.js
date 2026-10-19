import { facebookFormAction } from './form-actions.js';
import { openAutomationTab, closeAutomationTab } from './automation-tabs.js';
export function validateFacebookDestination(destination) {
  if (destination.mechanism === 'marketplace' && destination.url === 'https://www.facebook.com/marketplace/create/item') return;
  if (destination.mechanism === 'group_direct' && /^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9._-]+\/?$/.test(destination.url)) return;
  throw new Error('Este destino todavía no tiene un formulario verificado. No se envió.');
}
export async function fetchPublicationPhotos(content, projectUrl) {
  const origin = new URL(projectUrl).origin;
  const photos = [];
  let total = 0;
  for (const photoUrl of content.photos) {
    const url = new URL(photoUrl);
    if (url.origin !== origin || !url.pathname.startsWith('/storage/v1/object/public/')) throw new Error('La foto debe estar en el almacenamiento de esta cuenta de RivaStock.');
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('No se pudo descargar una foto del producto.');
    const type = response.headers.get('content-type')?.split(';')[0];
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
    if (!extension) throw new Error('Formato de foto no compatible. Usá JPG, PNG o WebP.');
    if (Number(response.headers.get('content-length') || 0) > 10000000) throw new Error('La foto supera 10 MB.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 10000000) throw new Error('Foto vacía o demasiado grande.');
    // The base64 copies live in the service worker and the page at once.
    total += bytes.length;
    if (total > 60000000) throw new Error('Las fotos superan 60 MB en total. No se envió.');
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    photos.push({ data: btoa(binary), type, extension });
  }
  return photos;
}
const groupOwnContentPaths=['my_pending_content','my_posted_content'];
const groupTrackingPaths=['my_pending_content','my_posted_content','my_declined_content','my_removed_content'];
const marketplaceSearchUrl=title=>`https://www.facebook.com/marketplace/you/selling?title_search=${encodeURIComponent(title)}`;
async function waitForFacebookTab(tabId,expectedPath) {
  for(let attempt=0;attempt<60;attempt++) {
    const tab=await chrome.tabs.get(tabId);
    if(tab.status==='complete'&&new URL(tab.url).pathname.replace(/\/$/,'')===expectedPath)return;
    if(tab.status==='complete'&&/\/(login|checkpoint|recover)\b/.test(new URL(tab.url).pathname))throw new Error('La sesión de Facebook venció o requiere una verificación.');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('La lista de contenido propio no terminó de cargar. No se autorizó el envío.');
}
async function readGroupOwnContent(job,baseline,states) {
  const group=new URL(job.destination.url);
  const groupPath=group.pathname.replace(/\/$/,'');
  const firstUrl=`https://www.facebook.com${groupPath}/${states[0]}`;
  const tab=await openAutomationTab(firstUrl);
  try {
    const snapshots=[];
    for(const state of states) {
      const path=`${groupPath}/${state}`;
      const url=`https://www.facebook.com${path}`;
      if(state!==states[0])await chrome.tabs.update(tab.id,{url});
      await waitForFacebookTab(tab.id,path);
      snapshots.push(await facebookAdapter.action(tab.id,'own_content_snapshot',{
        ...job.content,targetGroupUrl:job.destination.url,
      },[],baseline));
    }
    return snapshots;
  } finally {
    await closeAutomationTab(tab.id);
  }
}
async function readMarketplaceOwnContent(job,baseline) {
  const tab=await openAutomationTab(marketplaceSearchUrl(job.content.title));
  try {
    await waitForFacebookTab(tab.id,'/marketplace/you/selling');
    return await facebookAdapter.action(tab.id,'own_content_snapshot',job.content,[],baseline);
  } finally {
    await closeAutomationTab(tab.id);
  }
}
export function ownedGroupResult(job,baseline,snapshots) {
  if(!baseline.includes('own-baseline:group')||snapshots.length!==2||snapshots.some(snapshot=>snapshot.complete!==true))return null;
  const seen=new Set(baseline.filter(value=>value.startsWith('own:')).map(value=>value.slice(4)));
  const candidates=snapshots.flatMap(snapshot=>snapshot.items??[])
    .filter(item=>/^\d+$/.test(item.id)&&!seen.has(item.id)&&item.authorMatches===true&&item.titleMatches===true);
  const ids=[...new Set(candidates.map(item=>item.id))];
  if(ids.length!==1)return null;
  const matches=candidates.filter(item=>item.id===ids[0]);
  if(!matches.length||matches.some(item=>item.state!==matches[0].state))return null;
  const item=matches[0];
  if(item.state==='pending_approval')return {status:'pending_approval',url:null,pendingPostId:item.id,message:'Facebook mostró el nuevo envío en la lista de publicaciones pendientes.'};
  if(item.state==='published') {
    const segment=new URL(job.destination.url).pathname.split('/')[2];
    return {status:'published',url:`https://www.facebook.com/groups/${segment}/permalink/${item.id}/`,message:'El ID nuevo coincide con el autor y el título aprobados en la lista de publicaciones del grupo.'};
  }
  return null;
}
export function ownedGroupTrackingResult(job,pendingPostId,snapshots) {
  if(!/^\d+$/.test(pendingPostId)||snapshots.length!==4||snapshots.some(snapshot=>snapshot.complete!==true))return null;
  const matches=snapshots.flatMap(snapshot=>snapshot.items??[])
    .filter(item=>item.id===pendingPostId&&item.authorMatches===true&&item.titleMatches===true);
  if(!matches.length||matches.some(item=>item.state!==matches[0].state))return null;
  const item=matches[0];
  if(item.state==='pending_approval')return {status:'pending_approval',url:null,pendingPostId,message:'La publicación todavía figura como pendiente de aprobación.'};
  if(item.state==='published') {
    const segment=new URL(job.destination.url).pathname.split('/')[2];
    return {status:'published',url:`https://www.facebook.com/groups/${segment}/permalink/${pendingPostId}/`,pendingPostId,message:'La publicación pendiente apareció en las publicaciones del grupo.'};
  }
  if(item.state==='not_approved')return {status:'not_approved',url:null,pendingPostId,message:'Facebook movió la publicación a rechazadas o eliminadas.'};
  return null;
}
export const facebookAdapter = {
  ready: true,
  async action(tabId, action, content, photos = [], baseline = []) {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: facebookFormAction, args: [action, content, photos, baseline] });
    if (results.length !== 1 || !results[0].result) throw new Error('No se pudo verificar el formulario de Facebook.');
    if(results[0].result.error) {
      const stage={check_existing:'Revisión de anuncios existentes',marketplace_prepare:'Preparación del formulario de Marketplace',group_prepare:'Preparación del grupo',validate_submit:'Verificación final antes de autorizar el envío',submit:'Envío a Facebook',result:'Comprobación del resultado'}[action]??action;
      const error=new Error(`${stage}: ${results[0].result.error}`);error.issue=results[0].result.issue;error.code=results[0].result.code??'FORM_VARIANT_UNSUPPORTED';throw error;
    }
    return results[0].result;
  },
  async prepare(job, config) {
    const started=performance.now();
    validateFacebookDestination(job.destination);
    const photos = await fetchPublicationPhotos(job.content, config.url);
    config.onTiming?.('photos_ms',performance.now()-started);
    const marketplace=job.destination.mechanism==='marketplace';
    const tab = await openAutomationTab(marketplace?marketplaceSearchUrl(job.content.title):job.destination.url);
    await chrome.storage.local.set({ activeJob: { ...config.journalIdentity, job, deviceId:config.deviceId,projectUrl:config.url,tabId: tab.id, stage: 'preparing', baseline: [] } });
    for (let attempt = 0; attempt < 60; attempt++) {
      if ((await chrome.tabs.get(tab.id)).status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if(marketplace) {
      if(job.content.allowRepublish!==true) {
        await this.action(tab.id,'check_existing',job.content);
      }
      await chrome.tabs.update(tab.id,{url:job.destination.url});
      for(let attempt=0;attempt<60;attempt++) {
        const current=await chrome.tabs.get(tab.id);
        if(current.status==='complete'&&current.url===job.destination.url)break;
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    }
    config.onTiming?.('navigation_ms',performance.now()-started);
    const result = await this.action(tab.id, job.destination.mechanism === 'marketplace' ? 'marketplace_prepare' : job.content.deliveryResolution?.action==='group_sale'?'group_sale_prepare':'group_prepare', {...job.content,targetGroupUrl:marketplace?null:job.destination.url,targetGroupName:marketplace?null:job.destination.name??null}, photos);
    if (!result.ready) throw new Error('El formulario no está listo.');
    let baseline=result.baseline;
    if(!marketplace) {
      const snapshots=await readGroupOwnContent(job,baseline,groupOwnContentPaths);
      if(snapshots.some(snapshot=>snapshot.complete!==true))throw new Error('No se pudo capturar una lista completa de contenido propio antes del envío. No se autorizó el clic.');
      baseline=[...baseline,'own-baseline:group',...new Set(snapshots.flatMap(snapshot=>snapshot.items??[]).map(item=>item.id).filter(id=>/^\d+$/.test(id)).map(id=>'own:'+id))];
    } else {
      const snapshot=await readMarketplaceOwnContent(job,baseline);
      if(snapshot.complete!==true)throw new Error('«Tus publicaciones» no expone una lista completa con IDs de anuncio verificables. No se autorizó el clic.');
      baseline=[...baseline,'own-baseline:marketplace',...new Set((snapshot.items??[]).map(item=>item.id).filter(id=>/^\d+$/.test(id)).map(id=>'own:'+id))];
    }
    return { job,deviceId:config.deviceId,projectUrl:config.url,tabId: tab.id, stage: 'prepared', baseline };
  },
  async reconcile(active) {
    if(active.job.destination.mechanism==='marketplace') {
      if(!active.baseline.includes('own-baseline:marketplace'))throw new Error('Resultado desconocido. No había un baseline causal de Marketplace para este intento; no se repetirá el envío.');
      for(let attempt=0;attempt<4;attempt++){
        const snapshot=await readMarketplaceOwnContent(active.job,active.baseline);
        if(snapshot.complete===true){
          const seen=new Set(active.baseline.filter(value=>value.startsWith('own:')).map(value=>value.slice(4)));
          const fresh=(snapshot.items??[]).filter(item=>/^\d+$/.test(item.id)&&!seen.has(item.id)&&item.authorMatches&&item.titleMatches);
          if(fresh.length===1){
            const item=fresh[0];const url=`https://www.facebook.com/marketplace/item/${item.id}/`;
            const status=item.state==='pending_approval'?'pending_approval':item.state==='not_approved'?'not_approved':'submitted';
            return {status,url,pendingPostId:item.id,
              message:status==='pending_approval'?'Facebook recibió el anuncio y lo está revisando.':status==='not_approved'?'Facebook rechazó el anuncio.':'El anuncio nuevo apareció en tus publicaciones de Marketplace.'};
          }
        }
        if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1000));
      }
      throw new Error('Resultado desconocido. No apareció exactamente un anuncio nuevo con ID verificable; no se repetirá el envío.');
    }
    if(active.job.destination.mechanism!=='group_direct')throw new Error('Resultado desconocido. El destino no tiene un lector de contenido propio verificado; no se repetirá el envío.');
    let lastError=null;
    for(let attempt=0;attempt<4;attempt++) {
      try {
        const snapshots=await readGroupOwnContent(active.job,active.baseline,groupOwnContentPaths);
        const result=ownedGroupResult(active.job,active.baseline,snapshots);
        if(result)return result;
      } catch(error) {lastError=error;}
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1000));
    }
    const suffix=lastError?` Último error: ${String(lastError.message).slice(0,160)}`:'';
    throw new Error(`Resultado desconocido. No hubo exactamente un ID nuevo identificable en las listas de contenido propio; no se repetirá el envío.${suffix}`);
  },
  async track(job,tracker,pendingPostId) {
    if(job.destination.mechanism==='group_direct') {
      if(!/^\d+$/.test(tracker?.authorId??''))return null;
      const baseline=[`author:${tracker.authorId}`];
      const snapshots=await readGroupOwnContent(job,baseline,groupTrackingPaths);
      return ownedGroupTrackingResult(job,pendingPostId,snapshots);
    }
    if(job.destination.mechanism==='marketplace') {
      const snapshot=await readMarketplaceOwnContent(job,[]);
      if(snapshot.complete!==true)return null;
      const matches=(snapshot.items??[]).filter(item=>item.id===pendingPostId&&item.authorMatches===true&&item.titleMatches===true);
      if(matches.length!==1)return null;
      const status=matches[0].state;
      const url=`https://www.facebook.com/marketplace/item/${pendingPostId}/`;
      if(status==='pending_approval')return {status:'pending_approval',url,pendingPostId,message:'El anuncio continúa en revisión.'};
      if(status==='submitted')return {status:'submitted',url,pendingPostId,message:'El anuncio pasó a activo en Marketplace.'};
      if(status==='not_approved')return {status:'not_approved',url,pendingPostId,message:'Facebook rechazó el anuncio de Marketplace.'};
    }
    return null;
  },
};
