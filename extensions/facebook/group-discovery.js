import { openAutomationTab, closeAutomationTab } from './automation-tabs.js';

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

// Extract only a visible rules/about section from the requested group page.
// This reads rendered public DOM and never inspects posts, cookies, or app state.
export async function readGroupRules(expectedUrl=location.href) {
  const pageUrl = new URL(location.href);
  const expected = new URL(expectedUrl);
  const canonical = path => path.replace(/\/$/,'').replace('/PicoVendedeTodo','/710102875717376');
  if (pageUrl.origin !== 'https://www.facebook.com' || expected.origin !== pageUrl.origin
    || !/^\/groups\/[A-Za-z0-9._-]+\/?$/.test(pageUrl.pathname)
    || canonical(pageUrl.pathname) !== canonical(expected.pathname)) return null;
  const visible = element => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const heading = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
    .find(node => visible(node) && /^(?:reglas(?: del grupo)?|group rules|informaci[oó]n|about)$/i.test((node.innerText??node.textContent??'').trim()));
  if (!heading) return null;
  let section = heading.closest('[role="dialog"],section,[role="region"]') ?? heading.parentElement;
  for (let level=0;section&&section!==document.body&&level<5;level++,section=section.parentElement) {
    if (section.querySelector('[role="feed"],[role="article"],article')) continue;
    const text=(section.innerText??'').replace(/\r/g,'').split('\n').map(line=>line.trim()).filter(Boolean);
    const marker=text.findIndex(line=>/^(?:reglas(?: del grupo)?|group rules|informaci[oó]n|about)$/i.test(line));
    const candidate=(marker>=0?text.slice(marker+1):text).join('\n').slice(0,6000).trim();
    if(candidate.length>=10)return candidate;
  }
  return null;
}

export async function discoverGroupMembers(urls) {
  const counts=[];
  for(const url of [...new Set(urls)].slice(0,3)){
    if(!/^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9._-]+$/.test(url))continue;
    let tab;
    try{
      tab=await openAutomationTab(url);
      for(let attempt=0;attempt<20;attempt++){
        if((await chrome.tabs.get(tab.id)).status==='complete')break;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readGroupMembers,args:[url]});
      counts.push({url,memberCount:results[0]?.result??null});
    }catch{counts.push({url,memberCount:null});/* Keep the batch moving past unreadable groups. */}
    finally{if(tab)await closeAutomationTab(tab.id);}
  }
  return counts;
}

export async function discoverGroupRules(targets) {
  const results=[];
  for(const target of (Array.isArray(targets)?targets:[]).slice(0,3)){
    const groupId=typeof target?.group_id==='string'?target.group_id:'';
    const url=typeof target?.url==='string'?target.url:'';
    if(!/^[0-9a-f-]{36}$/i.test(groupId)||!/^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9._-]+$/.test(url))continue;
    let tab;
    try{
      tab=await openAutomationTab(url);
      for(let attempt=0;attempt<20;attempt++){
        if((await chrome.tabs.get(tab.id)).status==='complete')break;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      const read=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readGroupRules,args:[url]});
      results.push({group_id:groupId,rules_text:typeof read[0]?.result==='string'?read[0].result:''});
    }catch{results.push({group_id:groupId,rules_text:''});}
    finally{if(tab)await closeAutomationTab(tab.id);}
  }
  return results;
}

export async function discoverJoinedGroups(){
  const tab=await openAutomationTab('https://www.facebook.com/groups/joins/');
  try{
    for(let attempt=0;attempt<60;attempt++){
      if((await chrome.tabs.get(tab.id)).status==='complete')break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readJoinedGroups});
    if(results.length!==1||!Array.isArray(results[0].result?.groups))throw new Error('No se pudo leer Tus grupos.');
    return results[0].result;
  }finally{await closeAutomationTab(tab.id);}
}
