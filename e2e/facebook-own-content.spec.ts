import {test,expect} from '@playwright/test';
import {facebookFormAction} from '../extensions/facebook/form-actions.js';

const content={
  title:'Artículo de prueba aprobado',
  groupText:'Artículo de prueba aprobado\n\nDescripción aprobada',
};
const authorId='100000000000001';

async function snapshot(page:any,baseline:string[]=[]) {
  return page.evaluate(({source,baseline,content}:any)=>
    new Function('return ('+source+')')()('own_content_snapshot',content,[],baseline),
  {source:facebookFormAction.toString(),baseline,content});
}

function groupItem(id:string,set:'pcb'|'gm',title=content.title) {
  return `<div class="observed-own-content-item">
    <h3><a href="/groups/123/user/${authorId}/">Cuenta de prueba</a> publicó en <a href="/groups/123">Grupo de prueba</a></h3>
    <div><a href="/photo/?fbid=200000000000001&set=${set}.${id}"><img alt="Foto"></a></div>
    <div>${title}<br>Descripción aprobada</div>
    <button aria-label="Acciones">Menú</button><button>Editar</button><button>Eliminar</button>
  </div>`;
}

test('reads an approval-pending group item from its observed pcb media set',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<main>${groupItem('300000000000001','pcb')}</main>`}));
  await page.goto('https://www.facebook.com/groups/123/my_pending_content');
  await page.evaluate(()=>{(window as any).controlClicks=0;document.addEventListener('click',()=>{(window as any).controlClicks++;});});

  const result=await snapshot(page,[`author:${authorId}`]);

  expect(result).toMatchObject({complete:true,items:[{id:'300000000000001',state:'pending_approval',authorMatches:true,titleMatches:true}]});
  expect(await page.evaluate(()=>((window as any).controlClicks))).toBe(0);
});

test('reads a direct-published group item from its observed gm media set',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<main>${groupItem('300000000000002','gm')}</main>`}));
  await page.goto('https://www.facebook.com/groups/123/my_posted_content');

  const result=await snapshot(page,[`author:${authorId}`]);

  expect(result).toMatchObject({complete:true,items:[{id:'300000000000002',state:'published',authorMatches:true,titleMatches:true}]});
});

test('does not identify a group item without a stable post ID',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<main><div class="observed-own-content-item">
    <h3><a href="/groups/123/user/${authorId}/">Cuenta de prueba</a> publicó en <a href="/groups/123">Grupo de prueba</a></h3>
    <a href="/groups/123/?multi_permalinks=300000000000003">Ver en el grupo</a>
    <div>${content.title}<br>Descripción aprobada</div>
    <button aria-label="Acciones">Menú</button><button>Editar</button><button>Eliminar</button>
  </div></main>`}));
  await page.goto('https://www.facebook.com/groups/123/my_pending_content');

  const result=await snapshot(page,[`author:${authorId}`]);

  expect(result).toMatchObject({complete:true,items:[]});
});

test('does not treat Marketplace controls or unrelated links as listing IDs',async({page})=>{
  const rows=Array.from({length:14},(_,index)=>`<div class="observed-listing-row">
    <img alt="Producto"><span>${index%2?'Vendido':'Activo'}</span>
    <button>${index%2?'Marcar como agotado':'Marcar como vendido'}</button>
  </div>`).join('');
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<main>${rows}<a href="/marketplace/item/399999999999999/">Enlace fuera de la lista</a><span>Cargando…</span></main>`}));
  await page.goto('https://www.facebook.com/marketplace/you/selling');
  await page.evaluate(()=>{(window as any).controlClicks=0;document.addEventListener('click',()=>{(window as any).controlClicks++;});});

  const result=await snapshot(page,[]);

  expect(result).toMatchObject({complete:false,items:[]});
  expect(await page.evaluate(()=>((window as any).controlClicks))).toBe(0);
});

test('leaves group-sale content unknown when the observed own-content card structure is absent',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<main><p>No hay publicaciones para mostrar.</p></main>'}));
  await page.goto('https://www.facebook.com/groups/549198298521944/my_pending_content');

  const result=await snapshot(page,[]);

  expect(result).toMatchObject({complete:true,items:[]});
});
