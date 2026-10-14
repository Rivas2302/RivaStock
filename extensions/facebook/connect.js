// Extension-owned page only: no externally_connectable or web page bridge.
const form = document.querySelector('#connect');
const status = document.querySelector('#status');
const saved = await chrome.storage.local.get(['connection', 'status','paused']);
const toggle = document.querySelector('#toggle');
toggle.disabled = !saved.connection;
toggle.textContent = saved.paused === false ? 'Pausar cola' : 'Activar cola';
toggle.addEventListener('click',async () => {
  const {paused}=await chrome.storage.local.get('paused');
  await chrome.storage.local.set({paused:paused===false});
  toggle.textContent=paused===false?'Activar cola':'Pausar cola';
  await chrome.runtime.sendMessage({type:'poll'});
  status.textContent=(await chrome.storage.local.get('status')).status;
});
status.textContent = saved.status ?? (saved.connection ? 'Computadora vinculada.' : 'Sin conexión.');
if (saved.connection) form.hidden = true;
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
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
    await chrome.storage.local.set({ connection: { url: url.origin, key, token: result.token, deviceId: result.deviceId }, status: 'Computadora vinculada. Cola pausada.',paused:true });
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
  form.hidden = false;
});
