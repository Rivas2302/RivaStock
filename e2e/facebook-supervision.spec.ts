import { test, expect } from '@playwright/test';
import { facebookFormAction } from '../extensions/facebook/form-actions.js';
import { facebookAdapter, prepareWithSupervision } from '../extensions/facebook/adapter.js';

const fixture = `<!doctype html><html lang="es"><body><form id="composer">
  <h1>Publicar producto</h1>
  <button type="button">Guardar borrador</button>
  <label><span>Título</span><input type="text"></label>
  <label><span>Precio</span><input type="text"></label>
  <label role="combobox" aria-expanded="false" aria-labelledby="category"><span id="category">Categoría del artículo</span></label>
  <label role="combobox" aria-expanded="false" aria-labelledby="condition"><span id="condition">Estado</span></label>
  <button type="button">Más detalles</button>
  <label><span>Descripción</span><textarea></textarea></label>
  <input aria-label="Ubicación" role="combobox" value="Buenos Aires">
  <input aria-label="Promocionar tras publicar" role="switch" type="checkbox">
  <input aria-label="Ocultar a amigos" role="switch" type="checkbox">
  <input type="file" multiple accept="image/*">
  <p>Fotos · 0/10</p>
  <button type="button" id="next">Siguiente</button>
  <script>
    const category=document.querySelector('[aria-labelledby="category"]');
    category.addEventListener('click',()=>{
      category.setAttribute('aria-expanded','true');
      if(document.querySelector('[role="option"]'))return;
      const option=document.createElement('button');option.type='button';option.setAttribute('role','option');option.textContent='Salud y belleza';
      option.addEventListener('click',()=>{category.append(document.createTextNode('Salud y belleza'));category.setAttribute('aria-expanded','false');option.remove()});
      document.body.append(option);
    });
    const condition=document.querySelector('[aria-labelledby="condition"]');
    condition.addEventListener('click',()=>{
      condition.setAttribute('aria-expanded','true');
      if(document.querySelector('[role="option"]'))return;
      const option=document.createElement('div');option.setAttribute('role','option');option.textContent='Nuevo';
      option.addEventListener('click',()=>{condition.append(document.createTextNode('Nuevo'));condition.setAttribute('aria-expanded','false');option.remove()});
      document.body.append(option);
    });
    document.querySelector('#next').addEventListener('click',()=>{
      const heading=document.createElement('h2');heading.textContent='Publicar en más lugares';document.body.append(heading);
      const publish=document.createElement('button');publish.type='button';publish.textContent='Publicar';publish.addEventListener('click',()=>window.__published=(window.__published||0)+1);document.body.append(publish);
    });
  </script>
</form></body></html>`;

const content = {
  title: 'Perfume de prueba',
  price: 43000,
  category: 'Salud y belleza',
  condition: 'new',
  description: 'Descripción aprobada',
  location: 'Buenos Aires',
  photos: [],
};

async function installForm(page: any) {
  await page.addInitScript(() => {
    (window as any).__traceSeq=0;
    (window as any).chrome={runtime:{id:'fixture-extension',sendMessage:async()=>({queued:true,seq:++(window as any).__traceSeq,traceId:'11111111-1111-4111-8111-111111111111'})}};
  });
  await page.route('https://www.facebook.com/**', route => route.fulfill({contentType:'text/html; charset=utf-8',body:fixture}));
  await page.goto('https://www.facebook.com/marketplace/create/item');
}

async function invoke(page: any, action: string, suppliedContent: any) {
  return page.evaluate(({source,action,content}: any) => new Function(`return (${source})`)()(action,content,[],[]), {
    source: facebookFormAction.toString(), action, content: suppliedContent,
  });
}

test('a renamed category control fails deterministically, recovers with one supervised click, and learns a reusable hint', async ({page}) => {
  await installForm(page);
  const firstFailure = await invoke(page,'marketplace_prepare',content);
  expect(firstFailure).toMatchObject({error:expect.any(String),supervision:{stepName:'marketplace.category'}});
  expect(firstFailure.supervision.intent.target).toMatchObject({role:'combobox',name:'Categoría del artículo'});
  expect(await page.locator('#composer input[type="text"]').nth(0).inputValue()).toBe(content.title);

  const persistedHints: any[]=[];
  let supervisorRequests=0;
  let outcomes=0;
  const adapter={action:async(_tabId:number,action:string,nextContent:any)=>{
    const result=await invoke(page,action,nextContent);
    if(result?.error){const error:any=new Error(result.error);error.supervision=result.supervision;error.issue=result.issue;error.code=result.code;throw error;}
    return result;
  }};
  const repaired=await prepareWithSupervision(adapter,1,'marketplace_prepare',content,[],[],{
    loadSupervisionHints:async()=>persistedHints,
    requestSupervision:async(descriptor:any)=>{
      supervisorRequests++;
      return {id:'supervision-request-1',decision:{action:'click',element_index:descriptor.intent.target.element_index,confidence:0.95,observation:'El control de categoría tiene una etiqueta ampliada.',reason:'Es el único selector de categoría del formulario.'}};
    },
    reportSupervisionOutcome:async(_id:string,success:boolean,match:any,step:string)=>{
      outcomes++;
      if(success)persistedHints.push({step,intent_key:step,match});
    },
  });
  expect(repaired.ready).toBe(true);
  expect(supervisorRequests).toBe(1);
  expect(outcomes).toBe(1);
  expect(await page.locator('label[role="combobox"]').first().innerText()).toContain(content.category);
  expect(await page.evaluate(()=>(window as any).__published??0)).toBe(0);

  await installForm(page);
  const reused=await prepareWithSupervision(adapter,1,'marketplace_prepare',content,[],[],{
    loadSupervisionHints:async()=>persistedHints,
    requestSupervision:async()=>{supervisorRequests++;throw new Error('A learned hint should avoid another request.');},
    reportSupervisionOutcome:async()=>{outcomes++;},
  });
  expect(reused.ready).toBe(true);
  expect(supervisorRequests).toBe(1);
  expect(await page.evaluate(()=>(window as any).__published??0)).toBe(0);
});

test('reload restarts the full deterministic preparation and does not learn a reload hint', async ({page}) => {
  await installForm(page);
  const requests: any[]=[];
  const outcomes: boolean[]=[];
  let reloads=0;
  const adapter={action:async(_tabId:number,action:string,nextContent:any)=>{
    if(action==='apply_supervisor_decision'&&nextContent.supervision.decision.action==='reload') {
      reloads++;
      return {applied:true,reload:true,match:null};
    }
    const result=await invoke(page,action,nextContent);
    if(result?.error){const error:any=new Error(result.error);error.supervision=result.supervision;error.issue=result.issue;error.code=result.code;throw error;}
    return result;
  }};
  const result=await prepareWithSupervision(adapter,1,'marketplace_prepare',content,[],[],{
    loadSupervisionHints:async()=>[],
    requestSupervision:async(descriptor:any)=>{
      requests.push(descriptor);
      return {id:`reload-request-${requests.length}`,decision:requests.length===1
        ? {action:'reload',confidence:0.9,observation:'El formulario requiere una recarga controlada.',reason:'El paso se reintentará con el contenido aprobado.'}
        : {action:'click',element_index:descriptor.intent.target.element_index,confidence:0.95,observation:'La etiqueta ampliada identifica el control de categoría.',reason:'Es el selector único del formulario.'}};
    },
    reportSupervisionOutcome:async(_id:string,success:boolean)=>{outcomes.push(success);},
  });
  expect(result.ready).toBe(true);
  expect(reloads).toBe(1);
  expect(requests).toHaveLength(2);
  expect(outcomes).toEqual([false,true]);
  expect(await page.evaluate(()=>(window as any).__published??0)).toBe(0);
});

test('skip_destination leaves the delivery for review and never submits', async ({page}) => {
  await installForm(page);
  let outcomes=0;
  const adapter={action:async(_tabId:number,action:string,nextContent:any)=>{
    if(action==='apply_supervisor_decision') {
      const result=await invoke(page,action,nextContent);
      return result;
    }
    const result=await invoke(page,action,nextContent);
    if(result?.error){const error:any=new Error(result.error);error.supervision=result.supervision;error.issue=result.issue;error.code=result.code;throw error;}
    return result;
  }};
  let failure:any;
  try {
    await prepareWithSupervision(adapter,1,'marketplace_prepare',content,[],[],{
      loadSupervisionHints:async()=>[],
      requestSupervision:async(descriptor:any)=>({id:'skip-request',decision:{action:'skip_destination',confidence:0.9,observation:'El destino no presenta el formulario aprobado.',reason:'No debe iniciarse una publicación con un formulario diferente.'}}),
      reportSupervisionOutcome:async(_id:string,success:boolean)=>{expect(success).toBe(false);outcomes++;},
    });
  } catch(error) { failure=error; }
  expect(failure).toMatchObject({code:'SUPERVISOR_SKIP_DESTINATION'});
  expect(failure.message).toContain('Se dejó la entrega para revisión');
  expect(outcomes).toBe(1);
  expect(await page.evaluate(()=>(window as any).__published??0)).toBe(0);
});

test('a reload decision waits for the extension tab to finish loading', async () => {
  const previous=(globalThis as any).chrome;
  const listeners=new Set<(tabId:number,changeInfo:any)=>void>();
  let reloadCount=0;
  (globalThis as any).chrome={
    scripting:{executeScript:async()=>[{result:{applied:true,reload:true,match:null}}]},
    tabs:{
      onUpdated:{addListener:(listener:any)=>listeners.add(listener),removeListener:(listener:any)=>listeners.delete(listener)},
      reload:async(tabId:number)=>{reloadCount++;setTimeout(()=>{for(const listener of listeners)listener(tabId,{status:'complete'});},0);},
    },
  };
  try {
    const result=await facebookAdapter.action(42,'apply_supervisor_decision',{
      supervision:{decision:{action:'reload',confidence:0.9,observation:'Reload',reason:'Retry'},domSummary:{scope:'dialog',controls:[]},intent:{}},
    });
    expect(result).toMatchObject({applied:true,reload:true});
    expect(reloadCount).toBe(1);
    expect(listeners.size).toBe(0);
  } finally {
    if(previous===undefined)delete (globalThis as any).chrome;
    else (globalThis as any).chrome=previous;
  }
});
