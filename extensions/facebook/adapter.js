import { facebookFormAction } from './form-actions.js';
export function validateFacebookDestination(destination) {
  if (destination.mechanism === 'marketplace' && destination.url === 'https://www.facebook.com/marketplace/create/item') return;
  if (destination.mechanism === 'group_direct' && /^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9._-]+\/?$/.test(destination.url)) return;
  throw new Error('Este destino todavía no tiene un formulario verificado. No se envió.');
}
export async function fetchPublicationPhotos(content, projectUrl) {
  const origin = new URL(projectUrl).origin;
  const photos = [];
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
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    photos.push({ data: btoa(binary), type, extension });
  }
  return photos;
}
export const facebookAdapter = {
  ready: true,
  async action(tabId, action, content, photos = [], baseline = []) {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: facebookFormAction, args: [action, content, photos, baseline] });
    if (results.length !== 1 || !results[0].result) throw new Error('No se pudo verificar el formulario de Facebook.');
    if(results[0].result.error) {
      const stage={check_existing:'Revisión de anuncios existentes',marketplace_prepare:'Preparación del formulario de Marketplace',group_prepare:'Preparación del grupo',submit:'Envío a Facebook',result:'Comprobación del resultado'}[action]??action;
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
    const tab = await chrome.tabs.create({ url: marketplace?'https://www.facebook.com/marketplace/you/selling':job.destination.url, active: false });
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
    const result = await this.action(tab.id, job.destination.mechanism === 'marketplace' ? 'marketplace_prepare' : job.content.deliveryResolution?.action==='group_sale'?'group_sale_prepare':'group_prepare', {...job.content,targetGroupUrl:marketplace?null:job.destination.url}, photos);
    if (!result.ready) throw new Error('El formulario no está listo.');
    return { job,deviceId:config.deviceId,projectUrl:config.url,tabId: tab.id, stage: 'prepared', baseline: result.baseline };
  },
  async reconcile(active) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await this.action(active.tabId, 'result', active.job.content, [], active.baseline);
      if (result.status) return result;
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    if(active.job.destination.mechanism==='group_direct'){
      const found=await this.action(active.tabId,'result_search',active.job.content,[],active.baseline).catch(()=>null);
      if(found?.url)return {status:'submitted',url:found.url,message:'Publicación encontrada en el grupo después del plazo del aviso de confirmación.'};
    }
    throw new Error('Resultado desconocido. Revisá la pestaña de Facebook; no se repetirá el envío.');
  },
};
