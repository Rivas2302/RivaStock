import { facebookFormAction, validateSupervisorDecision } from './form-actions.js';
import { openAutomationTab, closeAutomationTab } from './automation-tabs.js';
import { resolveSupervisedResult } from './result-verification.js';
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
async function readMarketplaceCandidates(job,baseline) {
  const tab=await openAutomationTab(marketplaceSearchUrl(job.content.title));
  try {
    await waitForFacebookTab(tab.id,'/marketplace/you/selling');
    return await facebookAdapter.action(tab.id,'own_content_candidates',job.content,[],baseline);
  } finally { await closeAutomationTab(tab.id); }
}
async function readGroupCandidates(job,baseline,state) {
  const group=new URL(job.destination.url);
  const groupPath=group.pathname.replace(/\/$/,'');
  const path=`${groupPath}/${state}`;
  const tab=await openAutomationTab(`https://www.facebook.com${path}`);
  try {
    await waitForFacebookTab(tab.id,path);
    return await facebookAdapter.action(tab.id,'own_content_candidates',{
      ...job.content,targetGroupUrl:job.destination.url,
    },[],baseline);
  } finally { await closeAutomationTab(tab.id); }
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
function decisionMatch(descriptor, decision) {
  const index = Number.isInteger(decision?.element_index) ? decision.element_index : descriptor?.intent?.target?.element_index;
  const control = descriptor?.domSummary?.controls?.find(item => item.index === index);
  if (!control?.role) return null;
  return {
    role: control.role,
    ...(control.name ? { accessible_name: control.name } : {}),
    ...(control.text ? { text: control.text } : {}),
    ...(control.headingPath?.at(-1) ? { nearby_heading: control.headingPath.at(-1) } : {}),
  };
}

function withSupervisionObservation(error, observation, traceId) {
  const suffix = [
    observation ? `Observación de IA: ${observation}` : '',
    traceId ? `Traza: ${traceId}` : '',
  ].filter(Boolean).join('. ');
  const wrapped = new Error(`${error.message}${suffix ? ` ${suffix}` : ''}`);
  wrapped.code = error.code;
  wrapped.issue = error.issue;
  wrapped.supervision = error.supervision;
  return wrapped;
}

async function reloadTabAndWait(tabId) {
  const tabs = globalThis.chrome?.tabs;
  if (!tabs?.reload || !tabs?.onUpdated?.addListener) throw new Error('No se pudo reiniciar la pestaña de preparación de forma segura.');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('La pestaña no terminó de recargar a tiempo.')), 60_000);
    const finish = error => {
      clearTimeout(timeout);
      tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    tabs.onUpdated.addListener(onUpdated);
    Promise.resolve(tabs.reload(tabId)).catch(finish);
  });
}

export async function prepareWithSupervision(adapter, tabId, action, content, photos, baseline, config) {
  const stepCounts = new Map();
  const allHints = [];
  const hintAttempts = new Set();
  let decisions = 0;
  let latestObservation = '';
  let lastError;
  const reportOutcome = (...args) => Promise.resolve(config.reportSupervisionOutcome?.(...args)).catch(() => {});
  const noteHintUse = (...args) => Promise.resolve(config.onLearnedHintUsed?.(...args)).catch(() => {});

  for (let cycle = 0; cycle < 24; cycle++) {
    try {
      return await adapter.action(tabId, action, { ...content, ...(allHints.length ? { supervisionHints: allHints } : {}) }, photos, baseline);
    } catch (error) {
      lastError = error;
      let descriptor = error.supervision;
      if (!descriptor || !config.loadSupervisionHints || !config.requestSupervision
        || !descriptor.traceId || !descriptor.stepSeq || !descriptor.intent?.target) throw error;

      if (!hintAttempts.has(descriptor.stepName)) {
        hintAttempts.add(descriptor.stepName);
        try {
          const hints = await config.loadSupervisionHints(descriptor.stepName);
          const usable = (Array.isArray(hints) ? hints : []).filter(hint => hint?.step === descriptor.stepName
            && hint?.intent_key === descriptor.stepName && hint?.match && typeof hint.match.role === 'string'
            && (typeof hint.match.accessible_name === 'string' || typeof hint.match.text === 'string'));
          allHints.push(...usable);
          if (usable.length) {
            try {
              const hintedResult = await adapter.action(tabId, action, { ...content, supervisionHints: allHints }, photos, baseline);
              await noteHintUse(descriptor.stepName, tabId);
              return hintedResult;
            } catch (hintError) {
              lastError = hintError;
              if (hintError.supervision?.stepName !== descriptor.stepName) {
                await noteHintUse(descriptor.stepName, tabId);
                continue;
              }
              descriptor = hintError.supervision;
            }
          }
        } catch {
          // The regular deterministic path remains available if learned hints cannot be read.
        }
      }

      const stepCount = stepCounts.get(descriptor.stepName) ?? 0;
      if (stepCount >= 3 || decisions >= 8) throw withSupervisionObservation(lastError, latestObservation, descriptor.traceId);
      let response;
      try {
        response = await config.requestSupervision(descriptor);
      } catch {
        throw lastError;
      }
      if (!response?.id || !response.decision || !validateSupervisorDecision(response.decision, descriptor.domSummary, descriptor.intent)) {
        throw lastError;
      }
      decisions += 1;
      stepCounts.set(descriptor.stepName, stepCount + 1);
      latestObservation = String(response.decision.observation ?? '').slice(0, 300);
      const match = decisionMatch(descriptor, response.decision);
      if (!match) {
        await reportOutcome(response.id, false, null, descriptor.stepName, latestObservation, tabId);
        throw withSupervisionObservation(lastError, latestObservation, descriptor.traceId);
      }

      let applied;
      try {
        applied = await adapter.action(tabId, 'apply_supervisor_decision', {
          supervision: { decision: response.decision, domSummary: descriptor.domSummary, intent: descriptor.intent },
        });
      } catch (applyError) {
        await reportOutcome(response.id, false, match, descriptor.stepName, latestObservation, tabId);
        if (applyError.stale) {
          try {
            return await adapter.action(tabId, action, { ...content, supervisionHints: allHints }, photos, baseline);
          } catch (freshError) {
            lastError = freshError;
            continue;
          }
        }
        throw withSupervisionObservation(lastError, latestObservation, descriptor.traceId);
      }
      if (!applied?.applied) {
        await reportOutcome(response.id, false, match, descriptor.stepName, latestObservation, tabId);
        throw withSupervisionObservation(lastError, latestObservation, descriptor.traceId);
      }
      if (applied.skipDestination) {
        await reportOutcome(response.id, false, null, descriptor.stepName, latestObservation, tabId);
        const skipped = new Error('La IA recomendó omitir este destino. Se dejó la entrega para revisión; no se enviará automáticamente.');
        skipped.code = 'SUPERVISOR_SKIP_DESTINATION';
        throw withSupervisionObservation(skipped, latestObservation, descriptor.traceId);
      }

      const resolvedMatch = applied.reload ? null : applied.match ?? match;
      const learned = resolvedMatch ? {
        step: descriptor.stepName,
        intent_key: descriptor.stepName,
        match: resolvedMatch,
      } : null;
      if (learned?.match?.role && (learned.match.accessible_name || learned.match.text)) allHints.push(learned);
      try {
        const result = await adapter.action(tabId, action, { ...content, supervisionHints: allHints }, photos, baseline);
        await reportOutcome(response.id, true, resolvedMatch, descriptor.stepName, latestObservation, tabId);
        return result;
      } catch (retryError) {
        const retryStep = retryError.supervision?.stepName;
        const resolvedStep = Boolean(retryStep) && retryStep !== descriptor.stepName;
        await reportOutcome(response.id, resolvedStep, resolvedMatch, descriptor.stepName, latestObservation, tabId);
        if (retryStep) {
          lastError = retryError;
          continue;
        }
        throw withSupervisionObservation(retryError, latestObservation, descriptor.traceId);
      }
    }
  }
  throw withSupervisionObservation(lastError ?? new Error('La preparación excedió el límite de reintentos supervisados.'), latestObservation, lastError?.supervision?.traceId);
}
export const facebookAdapter = {
  ready: true,
  async action(tabId, action, content, photos = [], baseline = []) {
    if (action === 'apply_supervisor_decision') {
      const { decision, domSummary, intent } = content?.supervision ?? {};
      if (!validateSupervisorDecision(decision, domSummary, intent)) throw new Error('La decisión del supervisor no cumple el contrato seguro de la extensión.');
      if (['click', 'type', 'select_option', 'scroll_container'].includes(decision.action)
        && (!intent?.target || intent.target.element_index !== decision.element_index)) {
        throw new Error('La decisión no apunta al único control objetivo del paso supervisado.');
      }
    }
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: facebookFormAction, args: [action, content, photos, baseline] });
    if (results.length !== 1 || !results[0].result) throw new Error('No se pudo verificar el formulario de Facebook.');
    if(results[0].result.error) {
      const stage={check_existing:'Revisión de anuncios existentes',marketplace_prepare:'Preparación del formulario de Marketplace',group_prepare:'Preparación del grupo',validate_submit:'Verificación final antes de autorizar el envío',submit:'Envío a Facebook',result:'Comprobación del resultado'}[action]??action;
      const error=new Error(`${stage}: ${results[0].result.error}`);error.issue=results[0].result.issue;error.code=results[0].result.code??'FORM_VARIANT_UNSUPPORTED';error.supervision=results[0].result.supervision;error.stale=results[0].result.stale===true;throw error;
    }
    if (action === 'apply_supervisor_decision' && results[0].result.reload === true) {
      await reloadTabAndWait(tabId);
    }
    return results[0].result;
  },
  async prepare(job, config) {
    const started=performance.now();
    validateFacebookDestination(job.destination);
    const photos = await fetchPublicationPhotos(job.content, config.url);
    config.onTiming?.('photos_ms',performance.now()-started);
    const marketplace=job.destination.mechanism==='marketplace';
    const rehearsal=Boolean(config.rehearsalId);
    const journalKey=rehearsal?'activeRehearsal':'activeJob';
    const journal={...config.journalIdentity,job,deviceId:config.deviceId,projectUrl:config.url,stage:'preparing',baseline:[],...(rehearsal?{rehearsalId:config.rehearsalId,validated:false}: {})};
    const tab = await openAutomationTab(marketplace?(rehearsal?job.destination.url:marketplaceSearchUrl(job.content.title)):job.destination.url);
    journal.tabId=tab.id;
    await chrome.storage.local.set({ [journalKey]: journal });
    for (let attempt = 0; attempt < 60; attempt++) {
      if ((await chrome.tabs.get(tab.id)).status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if(marketplace) {
      const rehearsalContent={...job.content,rehearsal:true,rehearsalMechanism:'marketplace'};
      if(rehearsal) {
        const preflight={...rehearsalContent,rehearsalId:config.rehearsalId,rehearsalPhase:'preflight'};
        const checked=await this.action(tab.id,'discard_draft',preflight);
        if(checked.requiresBlankVerification)await this.action(tab.id,'verify_draft_blank',preflight);
        await chrome.tabs.update(tab.id,{url:marketplaceSearchUrl(job.content.title)});
        for(let attempt=0;attempt<60;attempt++) {
          const current=await chrome.tabs.get(tab.id);
          if(current.status==='complete'&&new URL(current.url).pathname.replace(/\/$/,'')==='/marketplace/you/selling')break;
          await new Promise(resolve=>setTimeout(resolve,500));
        }
      }
      if(job.content.allowRepublish!==true) {
        await this.action(tab.id,'check_existing',job.content);
      }
      await chrome.tabs.update(tab.id,{url:job.destination.url});
      for(let attempt=0;attempt<60;attempt++) {
        const current=await chrome.tabs.get(tab.id);
        if(current.status==='complete'&&current.url===job.destination.url)break;
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      if(rehearsal) {
        const preflight={...rehearsalContent,rehearsalId:config.rehearsalId,rehearsalPhase:'preflight'};
        const checked=await this.action(tab.id,'discard_draft',preflight);
        if(checked.requiresBlankVerification)await this.action(tab.id,'verify_draft_blank',preflight);
      }
    } else if(rehearsal) {
      await this.action(tab.id,'discard_draft',{...job.content,rehearsal:true,rehearsalMechanism:'group_direct',rehearsalId:config.rehearsalId,rehearsalPhase:'preflight'});
    }
    config.onTiming?.('navigation_ms',performance.now()-started);
    const preparedContent={...job.content,...(rehearsal?{rehearsal:true,rehearsalId:config.rehearsalId}:{}),targetGroupUrl:marketplace?null:job.destination.url,targetGroupName:marketplace?null:job.destination.name??null};
    const prepareAction = job.destination.mechanism === 'marketplace' ? 'marketplace_prepare' : job.content.deliveryResolution?.action==='group_sale'?'group_sale_prepare':'group_prepare';
    const result = await prepareWithSupervision(this, tab.id, prepareAction, preparedContent, photos, [], config);
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
    const prepared={...journal,job,deviceId:config.deviceId,projectUrl:config.url,tabId: tab.id, stage: 'prepared', baseline};
    await chrome.storage.local.set({ [journalKey]: prepared });
    return prepared;
  },
  async discardRehearsalDraft(active) {
    if(!active?.tabId||!active?.job?.content)throw new Error('No se identificó la pestaña del ensayo para descartar el borrador.');
    const content={...active.job.content,rehearsal:true,rehearsalId:active.rehearsalId,rehearsalMechanism:active.job.destination.mechanism};
    const result=await this.action(active.tabId,'discard_draft',content);
    if(result.requiresBlankVerification) {
      if(result.discarded) {
        await chrome.tabs.update(active.tabId,{url:'https://www.facebook.com/marketplace/create/item'});
        for(let attempt=0;attempt<60;attempt++) {
          const current=await chrome.tabs.get(active.tabId);
          if(current.status==='complete'&&current.url==='https://www.facebook.com/marketplace/create/item')break;
          await new Promise(resolve=>setTimeout(resolve,500));
        }
      }
      await this.action(active.tabId,'verify_draft_blank',content);
    }
    return result;
  },
  async reconcile(active, options = {}) {
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
      const assisted=await verifyResultWithSupervisor(active,options,()=>readMarketplaceCandidates(active.job,active.baseline));
      if(assisted?.result)return assisted.result;
      const error=new Error('Resultado desconocido. No apareció exactamente un anuncio nuevo con ID verificable; no se repetirá el envío.');
      if(assisted?.candidateUrl)error.candidateUrl=assisted.candidateUrl;
      throw error;
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
    let assistedCandidateUrl=null;
    for(const state of groupOwnContentPaths){
      const assisted=await verifyResultWithSupervisor(active,options,()=>readGroupCandidates(active.job,active.baseline,state));
      if(assisted?.result)return assisted.result;
      assistedCandidateUrl=assisted?.candidateUrl??assistedCandidateUrl;
    }
    const error=new Error(`Resultado desconocido. No hubo exactamente un ID nuevo identificable en las listas de contenido propio; no se repetirá el envío.${suffix}`);
    if(assistedCandidateUrl)error.candidateUrl=assistedCandidateUrl;
    throw error;
  },
  async reviewHistoricalResult(active, options = {}) {
    if (active.job.destination.mechanism === 'marketplace') {
      const assisted = await verifyResultWithSupervisor(active, { ...options, requireHumanConfirmation: true },
        () => readMarketplaceCandidates(active.job, active.baseline ?? []));
      return assisted ?? { result: null, candidateUrl: null, reason: 'review_unavailable' };
    }
    if (active.job.destination.mechanism !== 'group_direct') {
      return { result: null, candidateUrl: null, reason: 'unsupported_destination' };
    }
    for (const state of groupOwnContentPaths) {
      const assisted = await verifyResultWithSupervisor(active, { ...options, requireHumanConfirmation: true },
        () => readGroupCandidates(active.job, active.baseline ?? [], state));
      if (assisted?.candidateUrl) return assisted;
      if (assisted?.reason === 'review_unavailable') return assisted;
    }
    return { result: null, candidateUrl: null, reason: 'not_found' };
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

async function verifyResultWithSupervisor(active,options,loadSnapshot){
  if(typeof options.requestVerifyResult!=='function')return null;
  let snapshot;
  try{snapshot=await loadSnapshot();}catch{return null;}
  if(snapshot?.complete!==true||!Array.isArray(snapshot.items)||!snapshot.items.length
    ||!snapshot.dom_summary||!Number.isSafeInteger(snapshot.trace_seq))return null;
  let assessment;
  try{assessment=await options.requestVerifyResult(snapshot);}catch{return null;}
  const resolved=resolveSupervisedResult(active.job,active.baseline,snapshot,assessment,{
    requireHumanConfirmation:options.requireHumanConfirmation===true,
  });
  if(resolved.result){
    await options.recordTraceStep?.('supervised_result_verified','supervised',{
      tabId:active.tabId,capture:false,note:resolved.result.message,
    }).catch(()=>{});
  }else if(resolved.reason!=='not_found'){
    await options.recordTraceStep?.('supervised_result_requires_confirmation','retry',{
      tabId:active.tabId,capture:false,note:`${resolved.reason}: ${String(assessment?.observation??'').slice(0,240)}`,
    }).catch(()=>{});
  }
  return resolved;
}
