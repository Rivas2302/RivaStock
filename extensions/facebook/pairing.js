export function publicConnection(message) {
  const url = new URL(message.url);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Proyecto inválido.');
  const key = message.key;
  if (typeof key !== 'string') throw new Error('Clave pública inválida.');
  if (key.startsWith('ey')) {
    let payload;
    try { payload = JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))); } catch { throw new Error('Clave pública inválida.'); }
    if (payload.role !== 'anon') throw new Error('Solo se permiten claves públicas.');
  } else if (!key.startsWith('sb_publishable_')) throw new Error('Solo se permiten claves públicas.');
  if (!/^[a-f0-9]{64}$/.test(message.code)) throw new Error('Código inválido.');
  return {url:url.origin,key,code:message.code,expiresAt:Date.now()+5*60*1000};
}

export function trustedPairingSender(sender) {
  try {
    const url = new URL(sender.url);
    return !sender.id && sender.tab?.id !== undefined && sender.frameId === 0 && url.origin === 'https://rivastock.vercel.app' && ['/stock','/config'].includes(url.pathname);
  } catch { return false; }
}

export function registerPairing() {
  chrome.runtime.onMessageExternal?.addListener((message,sender,reply) => {
    if (!trustedPairingSender(sender)) return;
    if (message?.type === 'rivastock-installed') { reply({installed:true}); return; }
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
