// Connection approval and permission request stay inside the extension page.
const form=document.querySelector('#connect');
document.querySelector('#version').textContent=`Versión ${chrome.runtime.getManifest().version}`;
const supplierStart=document.querySelector('#supplier-start');
const supplierStatus=document.querySelector('#supplier-status');
const supplierProgress=document.querySelector('#supplier-progress');
const supplierCount=document.querySelector('#supplier-count');
const supplierBadge=document.querySelector('#supplier-badge');
const supplierFinish=document.querySelector('#supplier-finish');
const supplierAllCategories=document.querySelector('#supplier-all-categories');
let activeSupplierTab=null;
async function refreshActiveSupplierTab(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  activeSupplierTab=tab?.id===undefined?null:tab;
  return activeSupplierTab;
}
function supportedSupplierOrigin(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password)return null;
    const host=url.hostname.toLowerCase();
    if(host.includes(':')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
      ||host==='rivastock.vercel.app'||host==='facebook.com'||host.endsWith('.facebook.com')||/(?:bank|banco|bancaria|homebanking|bbva|santander|galicia|macro|icbc|brubank|hsbc|itau|supervielle|nacion|provincia)/i.test(host))return null;
    return url.origin;
  }catch{return null;}
}
async function renderSupplierCapture(){
  const tab=await refreshActiveSupplierTab();
  if(!tab?.id){supplierStart.disabled=true;supplierStatus.textContent='Abrí una tienda de proveedores en esta pestaña.';return;}
  const response=await chrome.runtime.sendMessage({type:'supplier-capture-state',tabId:tab.id}).catch(()=>null);
  const state=response?.state;
  if(!state){supplierStart.hidden=false;supplierStart.disabled=!supportedSupplierOrigin(tab.url);supplierProgress.hidden=true;supplierBadge.textContent='Listo';return;}
  supplierStart.hidden=true;supplierProgress.hidden=false;
  const count=state.items?.length??0;
  supplierCount.textContent=state.status==='complete'?`Lectura lista: ${count} productos`:`Leyendo… ${count} productos`;
  supplierBadge.textContent=state.status==='complete'?'Lista':state.status==='categories-available'?'Categorías':'Leyendo';
  supplierBadge.className=`badge ${state.status==='complete'?'active':'working'}`;
  supplierFinish.disabled=count===0;
  supplierAllCategories.hidden=state.status!=='categories-available';
  supplierAllCategories.textContent=`Leer todas las categorías (${Math.max(0,(state.categoryUrls?.length??0)-(state.pagesVisited?.length??0))})`;
  if(state.status==='complete'&&count===0)supplierStatus.textContent='No encontramos productos. Ingresá primero con tu clave en la página del proveedor y después tocá Importar.';
  else if(state.warnings?.length)supplierStatus.textContent=state.warnings.slice(0,2).join(' ');
  else supplierStatus.textContent=state.status==='categories-available'?'Encontramos categorías. Podés recorrerlas sin usar flechas de carrusel.':'';
}
supplierStart.addEventListener('click',async()=>{
  supplierStart.disabled=true;
  try{
    const tab=activeSupplierTab??await refreshActiveSupplierTab();
    const origin=supportedSupplierOrigin(tab?.url);
    if(!origin||tab?.id===undefined)throw new Error('Abrí una página de productos de un proveedor en Chrome.');
    // Request host access for this site only; never request a wildcard here.
    const granted=await chrome.permissions.request({origins:[`${origin}/*`]});
    if(!granted)throw new Error('No se dio permiso para leer esta tienda. Podés volver a intentarlo cuando quieras.');
    const [current]=await chrome.tabs.query({active:true,currentWindow:true});
    if(current?.id!==tab.id||supportedSupplierOrigin(current?.url)!==origin)throw new Error('La pestaña activa cambió. Volvé a la tienda e intentá de nuevo.');
    const response=await chrome.runtime.sendMessage({type:'supplier-capture-start',tabId:tab.id,origin});
    if(response?.error)throw new Error(response.error);
    supplierStatus.textContent='Preparando la lectura segura de esta tienda…';
    await renderSupplierCapture();
  }catch(error){supplierStatus.textContent=error?.message??'No se pudo iniciar la lectura.';supplierStart.disabled=false;}
});
supplierFinish.addEventListener('click',async()=>{
  supplierFinish.disabled=true;
  try{
    const response=await chrome.runtime.sendMessage({type:'supplier-capture-finish',tabId:activeSupplierTab?.id});
    if(response?.error)throw new Error(response.error);
    supplierStatus.textContent='Abriendo RivaStock con la lista leída…';
  }catch(error){supplierStatus.textContent=error?.message??'No se pudo llevar la lista a RivaStock.';supplierFinish.disabled=false;}
});
supplierAllCategories.addEventListener('click',async()=>{
  supplierAllCategories.disabled=true;
  try{
    const response=await chrome.runtime.sendMessage({type:'supplier-capture-read-categories',tabId:activeSupplierTab?.id});
    if(response?.error)throw new Error(response.error);
    supplierStatus.textContent='Leyendo las categorías una por una…';
    await renderSupplierCapture();
  }catch(error){supplierStatus.textContent=error?.message??'No se pudieron leer las categorías.';}
  finally{supplierAllCategories.disabled=false;}
});
document.querySelector('#supplier-cancel').addEventListener('click',async()=>{
  const response=await chrome.runtime.sendMessage({type:'supplier-capture-cancel',tabId:activeSupplierTab?.id}).catch(()=>null);
  supplierStatus.textContent=response?.error??'Lectura cancelada.';
  await renderSupplierCapture();
});
chrome.storage.onChanged.addListener((_changes,area)=>{if(area==='session'||area==='local')void renderSupplierCapture();});
void renderSupplierCapture();
const captureButton=document.querySelector('#capture-permission');
const captureStatus=document.querySelector('#capture-status');
async function renderCapturePermission() {
  const granted=await chrome.permissions.contains({origins:['<all_urls>']});
  captureButton.disabled=granted;
  captureStatus.textContent=granted?'Capturas habilitadas. La grabación solo se activa durante una automatización de Facebook.':'Sin permiso de capturas; se registrará solo el resumen del formulario.';
}
captureButton.addEventListener('click',async()=>{
  captureButton.disabled=true;
  try {
    const granted=await chrome.permissions.request({origins:['<all_urls>']});
    if(!granted)throw new Error('No se habilitaron las capturas. La extensión seguirá registrando solo el resumen del formulario.');
    captureStatus.textContent='Capturas habilitadas. La grabación solo se activa durante una automatización de Facebook.';
  } catch(error) {
    captureStatus.textContent=error.message;
  } finally {
    await renderCapturePermission();
  }
});
chrome.permissions.onAdded.addListener(()=>{void renderCapturePermission();});
chrome.permissions.onRemoved.addListener(()=>{void renderCapturePermission();});
void renderCapturePermission();
const diagnose=document.querySelector('#diagnose');
const report=document.querySelector('#report');
diagnose.addEventListener('click',async()=>{
  diagnose.disabled=true;
  try {
    const details=await chrome.runtime.sendMessage({type:'diagnose'});
    report.textContent=JSON.stringify(details,null,2);report.hidden=false;
  } catch(error){report.textContent=error.message;report.hidden=false;}
  finally{diagnose.disabled=false;}
});
const status = document.querySelector('#status');
const saved = await chrome.storage.local.get(['connection', 'status','paused','groupDiscovery','groupDiscoveryIssue']);
const {pendingConnection} = await chrome.storage.session.get('pendingConnection');
if (!saved.connection && pendingConnection?.expiresAt > Date.now()) {
  document.querySelector('#url').value=pendingConnection.url;
  document.querySelector('#key').value=pendingConnection.key;
  document.querySelector('#code').value=pendingConnection.code;
  form.hidden=false;
  document.querySelector('#start').hidden=true;
}
let currentConnection=saved.connection;
let currentPaused=saved.paused!==false;
const toggle = document.querySelector('#toggle');
toggle.disabled = !saved.connection;
toggle.textContent = saved.paused === false ? 'Pausar cola' : 'Activar cola';
const groupsCheck=document.querySelector('#groups-check');
const groupStatus=document.querySelector('#group-status');
function renderConnection(){
  document.querySelector('#connection-label').textContent=currentConnection?'PC vinculada':'PC sin vincular';
  document.querySelector('#connection-dot').className=currentConnection?'dot connected':'dot';
  const badge=document.querySelector('#queue-badge');badge.textContent=!currentConnection?'Sin conexión':currentPaused?'Pausada':'Activa';badge.className=`badge ${currentConnection&&!currentPaused?'active':''}`;
  document.querySelector('#disconnect').disabled=!currentConnection;groupsCheck.disabled=!currentConnection;
  document.querySelector('#start').hidden=Boolean(currentConnection)||!form.hidden;
}
function renderGroups(state){
  const group=state.groupDiscovery;const error=group?.phase==='error'?group.message:!group?state.groupDiscoveryIssue:null;
  const badge=document.querySelector('#group-badge');
  const names={checking:'Consultando',reading:'Leyendo',done:'Actualizados',waiting:'Sin pedido nuevo',error:'Requiere atención'};
  badge.textContent=error?'Requiere atención':names[group?.phase]??'Sin consultar';badge.className=`badge ${error?'error':['checking','reading'].includes(group?.phase)?'working':group?.phase==='done'?'active':''}`;
  groupStatus.textContent=error??group?.message??'Pedí la actualización de grupos desde RivaStock.';groupStatus.className=`activity ${error?'error':''}`;groupStatus.setAttribute('role',error?'alert':'status');
  const previous=document.querySelector('#group-last-error');previous.hidden=!state.groupDiscoveryIssue||Boolean(error);previous.textContent=state.groupDiscoveryIssue?`Último error de grupos: ${state.groupDiscoveryIssue}`:'';
  document.querySelector('#group-checked').textContent=group?.checkedAt?`Última comprobación: ${new Date(group.checkedAt).toLocaleTimeString('es-AR')}`:'';
}
async function checkGroups(refresh=false){
  if(!currentConnection)return;groupsCheck.disabled=true;
  try{const result=await chrome.runtime.sendMessage({type:refresh?'groups-refresh':'groups-check'});if(result?.error)throw new Error(result.error);await chrome.storage.local.get(['groupDiscovery','groupDiscoveryIssue']).then(renderGroups);}
  catch(error){groupStatus.textContent=error.message;groupStatus.className='activity error';groupStatus.setAttribute('role','alert');}
  finally{groupsCheck.disabled=!currentConnection;}
}
groupsCheck.addEventListener('click',()=>void checkGroups(true));renderConnection();renderGroups(saved);
if(currentConnection)void checkGroups();
toggle.addEventListener('click',async () => {
  if(!currentConnection)return;
  toggle.disabled=true;
  try {
    // Request optional hosts again when activating an older reloaded copy.
    // Keep this first asynchronous API inside the explicit click gesture.
    if(currentPaused) {
      const granted=await chrome.permissions.request({origins:[`${currentConnection.url}/*`,'https://www.facebook.com/*']});
      if(!granted)throw new Error('Para publicar, Chrome necesita permiso para Facebook y tu proyecto de RivaStock.');
    }
    const result=await chrome.runtime.sendMessage({type:'queue-control',paused:!currentPaused});
    if(result?.error)throw new Error(result.error);
    status.textContent=(await chrome.storage.local.get('status')).status;
  } catch(error) { status.textContent=error.message; }
  finally {toggle.disabled=!currentConnection;}
});
chrome.storage.onChanged.addListener((changes,area) => {
  if(area!=='local')return;
  if(changes.connection)currentConnection=changes.connection.newValue;
  if(changes.paused)currentPaused=changes.paused.newValue!==false;
  if(changes.status)status.textContent=changes.status.newValue??'';
  if(changes.connection||changes.paused)renderConnection();
  if(changes.groupDiscovery||changes.groupDiscoveryIssue)void chrome.storage.local.get(['groupDiscovery','groupDiscoveryIssue']).then(renderGroups);
  toggle.textContent=currentPaused?'Activar cola':'Pausar cola';
});
status.textContent = saved.status ?? (saved.connection ? 'Computadora vinculada.' : 'Sin conexión.');
if (saved.connection) form.hidden = true;
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    if(!pendingConnection || pendingConnection.expiresAt <= Date.now()) throw new Error('La conexión venció. Presioná Conectar esta PC en RivaStock otra vez.');
    const local=await chrome.storage.local.get(['connection','activeJob']);
    if(local.connection || local.activeJob) throw new Error('Hay una conexión o envío pendiente. Revisalo antes de conectar otra cuenta.');
    const url = new URL(document.querySelector('#url').value.trim());
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Usá la URL HTTPS de tu proyecto Supabase.');
    const key = document.querySelector('#key').value.trim();
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error('Usá únicamente la clave publishable.');
    const code = document.querySelector('#code').value.trim();
    if (!/^[a-f0-9]{64}$/.test(code)) throw new Error('Código de conexión inválido.');
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`, 'https://www.facebook.com/*'] });
    if (!granted) throw new Error('Se necesita acceso al proyecto para conectar la cola.');
    const response = await fetch(`${url.origin}/rest/v1/rpc/redeem_facebook_device`, {
      method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_code: code }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'No se pudo conectar.');
    await chrome.storage.local.set({ connection: { url: url.origin, key, token: result.token, deviceId: result.deviceId }, status: 'Computadora vinculada. Cola activa.',paused:false });
    await chrome.storage.session.remove('pendingConnection');
    await chrome.storage.local.remove('lastIssue');
    toggle.disabled=false;
    document.querySelector('#code').value = '';
    form.hidden = true;
    await chrome.runtime.sendMessage({ type: 'connection-ready' });
    status.textContent = (await chrome.storage.local.get('status')).status;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
document.querySelector('#disconnect').addEventListener('click',async()=>{
 const button=document.querySelector('#disconnect');button.disabled=true;
 try{
  const result=await chrome.runtime.sendMessage({type:'disconnect-local',archive:document.querySelector('#archive-recovery').checked});
  if(result?.error)throw new Error(result.error);
  status.textContent=(await chrome.storage.local.get('status')).status;
  form.hidden=true;document.querySelector('#start').hidden=false;
 }catch(error){status.textContent=error.message;}
 finally{button.disabled=!currentConnection;}
});
const recovery=(await chrome.storage.local.get('recoveryArchive')).recoveryArchive;
if(recovery){const node=document.querySelector('#recovery-notice');node.hidden=false;node.textContent='Hay una referencia de recuperación archivada. Revisá el intento anterior en RivaStock; no vuelvas a aprobarlo a ciegas.';}
