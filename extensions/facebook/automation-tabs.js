// Keep extension-owned Facebook pages in one unfocused window, away from the
// browser window the user is working in. The registry survives worker restarts.
let operations=Promise.resolve();
const serial=task=>{
  const result=operations.then(task,task);
  operations=result.catch(()=>{});
  return result;
};

export function openAutomationTab(url){
  return serial(async()=>{
    const saved=await chrome.storage.local.get(['automationWindowId','automationTabIds']);
    let windowId=saved.automationWindowId;
    if(windowId){
      try{await chrome.windows.get(windowId);}
      catch{windowId=null;}
    }
    if(!windowId){
      const window=await chrome.windows.create({url:chrome.runtime.getURL('connect.html'),focused:false});
      windowId=window?.id;
      if(!windowId)throw new Error('No se pudo abrir la ventana de automatización de Facebook.');
    }
    // Active in the automation window helps Facebook finish rendering photos;
    // it does not focus that window or change the user's active tab.
    const tab=await chrome.tabs.create({windowId,url,active:true});
    const ids=windowId===saved.automationWindowId?saved.automationTabIds??[]:[];
    await chrome.storage.local.set({automationWindowId:windowId,automationTabIds:[...new Set([...ids,tab.id])]});
    return tab;
  });
}

export function closeAutomationTab(tabId){
  return serial(async()=>{
    if(!tabId)return;
    const saved=await chrome.storage.local.get(['automationWindowId','automationTabIds']);
    const ids=saved.automationTabIds??[];
    if(!ids.includes(tabId))return;
    try{
      const tab=await chrome.tabs.get(tabId);
      if(tab.windowId===saved.automationWindowId&&/^https:\/\/www\.facebook\.com\/(groups\/|marketplace\/)/.test(tab.url??''))
        await chrome.tabs.remove(tabId);
    }catch{/* The user may already have closed the tab. */}
    const remaining=ids.filter(id=>id!==tabId);
    await chrome.storage.local.set({automationTabIds:remaining});
  });
}
