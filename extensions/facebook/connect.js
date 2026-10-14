// Connection approval and permission request stay inside the extension page.
const form = document.querySelector('#connect');
const version=document.createElement('p');
version.textContent=`Versión ${chrome.runtime.getManifest().version}`;
document.querySelector('h1').after(version);
const diagnose=document.createElement('button');
diagnose.type='button';diagnose.textContent='Revisar formulario de Facebook';
const report=document.createElement('pre');report.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';report.hidden=true;
document.querySelector('main').append(diagnose,report);
diagnose.addEventListener('click',async()=>{
  diagnose.disabled=true;
  try {
    const details=await chrome.runtime.sendMessage({type:'diagnose'});
    report.textContent=JSON.stringify(details,null,2);report.hidden=false;
  } catch(error){report.textContent=error.message;report.hidden=false;}
  finally{diagnose.disabled=false;}
});
const status = document.querySelector('#status');
const saved = await chrome.storage.local.get(['connection', 'status','paused']);
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
    if (key.startsWith('sb_secret_')) throw new Error('Usá únicamente la clave pública anon.');
    if (key.startsWith('ey')) {
      let payload;
      try { payload = JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))); } catch { throw new Error('Clave pública inválida.'); }
      if (payload.role !== 'anon') throw new Error('No se permiten claves de servicio ni sesiones de usuario.');
    } else if (!key.startsWith('sb_publishable_')) throw new Error('Clave pública inválida.');
    const code = document.querySelector('#code').value.trim();
    if (!/^[a-f0-9]{64}$/.test(code)) throw new Error('Código de conexión inválido.');
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`, 'https://www.facebook.com/*'] });
    if (!granted) throw new Error('Se necesita acceso al proyecto para conectar la cola.');
    const response = await fetch(`${url.origin}/rest/v1/rpc/redeem_facebook_device`, {
      method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { apikey: key, ...(key.startsWith('ey') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ p_code: code }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'No se pudo conectar.');
    await chrome.storage.local.set({ connection: { url: url.origin, key, token: result.token, deviceId: result.deviceId }, status: 'Computadora vinculada. Cola activa.',paused:false });
    await chrome.storage.session.remove('pendingConnection');
    await chrome.storage.local.remove('lastIssue');
    toggle.disabled=false;
    document.querySelector('#code').value = '';
    form.hidden = true;
    await chrome.alarms.create('rivastock-queue', { periodInMinutes: 1 });
    await chrome.runtime.sendMessage({ type: 'poll' });
    status.textContent = (await chrome.storage.local.get('status')).status;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
document.querySelector('#disconnect').addEventListener('click', async () => {
  const { connection } = await chrome.storage.local.get('connection');
  await chrome.storage.local.remove('connection');
  toggle.disabled=true;
  await chrome.alarms.clear('rivastock-queue');
  if (connection) await chrome.permissions.remove({ origins: [`${connection.url}/*`] });
  await chrome.storage.local.set({ status: 'Desconectada. Revocá el dispositivo en RivaStock.' });
  status.textContent = 'Desconectada. Revocá el dispositivo en RivaStock.';
  form.hidden = true;
  document.querySelector('#start').hidden=false;
});
