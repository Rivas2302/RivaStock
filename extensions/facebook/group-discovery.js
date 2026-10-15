// Executed in Facebook: public DOM only, no cookies, internal APIs or React state.
export async function readJoinedGroups() {
  if(location.origin!=='https://www.facebook.com'||location.pathname!=='/groups/joins/')throw new Error('Abrí Tus grupos con la sesión iniciada.');
  const heading=()=>Array.from(document.querySelectorAll('h2')).find(node=>/^Todos los grupos a los que te uniste/.test(node.textContent.trim()));
  for(let attempt=0;attempt<30&&!heading();attempt++)await new Promise(resolve=>setTimeout(resolve,500));
  const title=heading();if(!title)throw new Error('No se encontró el listado de grupos. Revisá la sesión o las verificaciones de Facebook.');
  // The joined-groups section has its own list, distinct from pending requests.
  let scope=title.parentElement;
  while(scope&&!scope.querySelector('[role="list"],ul'))scope=scope.parentElement;
  const list=scope?.querySelector('[role="list"],ul');
  if(!list)throw new Error('Facebook cambió el listado de grupos. No se importaron destinos.');
  const groups=new Map();let unchanged=0;
  for(let attempt=0;attempt<25;attempt++){
    const before=groups.size;
    for(const link of list.querySelectorAll('a[href]')){
      const url=new URL(link.href);const name=(link.innerText??'').trim();
      if(url.origin!=='https://www.facebook.com'||!/^\/groups\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)||!name||name==='Ver grupo'||name.length>160)continue;
      const id=url.pathname.split('/')[2];const canonical=id==='PicoVendedeTodo'?'710102875717376':id;
      const row=link.closest('li,[role="listitem"]');
      const memberCount=row?.innerText.match(/[0-9][0-9.,]*(?:\s*(?:mil|millones|M))?(?:\s+de)?\s+(?:miembros|members)\b/i)?.[0]??null;
      groups.set(canonical,{name,url:`https://www.facebook.com/groups/${canonical}`,...(memberCount?{memberCount}:{})});
    }
    unchanged=groups.size===before?unchanged+1:0;
    if(unchanged>=3)break;
    list.lastElementChild?.scrollIntoView({block:'end'});
    await new Promise(resolve=>setTimeout(resolve,600));
  }
  const expected=Number(title.textContent.match(/\((\d+)\)/)?.[1]);
  return {groups:[...groups.values()],partial:!Number.isFinite(expected)||groups.size<expected,total:Number.isFinite(expected)?expected:null};
}

// Self-contained injection: read the visible group header, never feed posts.
export async function readGroupMembers(expectedUrl=location.href) {
  if(location.origin!=='https://www.facebook.com'||!/^\/groups\/[A-Za-z0-9._-]+\/?$/.test(location.pathname))return null;
  const canonical=path=>path.replace(/\/$/,'').replace('/PicoVendedeTodo','/710102875717376');
  if(canonical(new URL(expectedUrl).pathname)!==canonical(location.pathname))return null;
  for(let attempt=0;attempt<12;attempt++){
    let scope=document.querySelector('h1');
    for(let level=0;scope&&scope!==document.body&&scope.tagName!=='MAIN'&&level<4;level++,scope=scope.parentElement){
      if(scope.querySelector('[role="feed"],[role="article"],article'))break;
      const match=scope.innerText.match(/[0-9][0-9.,]*(?:\s*(?:mil|millones|M))?(?:\s+de)?\s+(?:miembros|members)\b/i);
      if(match)return match[0].slice(0,80);
    }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  return null;
}

export async function discoverGroupMembers(urls) {
  const counts=[];
  for(const url of [...new Set(urls)].slice(0,3)){
    if(!/^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9._-]+$/.test(url))continue;
    let tab;
    try{
      tab=await chrome.tabs.create({url,active:false});
      for(let attempt=0;attempt<20;attempt++){
        if((await chrome.tabs.get(tab.id)).status==='complete')break;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readGroupMembers,args:[url]});
      counts.push({url,memberCount:results[0]?.result??null});
    }catch{counts.push({url,memberCount:null});/* Keep the batch moving past unreadable groups. */}
    finally{if(tab)await chrome.tabs.remove(tab.id).catch(()=>{});}
  }
  return counts;
}

export async function discoverJoinedGroups(){
  const tab=await chrome.tabs.create({url:'https://www.facebook.com/groups/joins/',active:false});
  try{
    for(let attempt=0;attempt<60;attempt++){
      if((await chrome.tabs.get(tab.id)).status==='complete')break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readJoinedGroups});
    if(results.length!==1||!Array.isArray(results[0].result?.groups))throw new Error('No se pudo leer Tus grupos.');
    return results[0].result;
  }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
}
