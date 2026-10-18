import {test,expect} from '@playwright/test';
import {facebookFormAction} from '../extensions/facebook/form-actions.js';
import {ownedGroupResult,ownedGroupTrackingResult} from '../extensions/facebook/adapter.js';

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

test('reads a group item exposed as an ARIA heading',async({page})=>{
  const body=`<main><div class="observed-own-content-item">
    <div role="heading" aria-level="3"><a href="/groups/123/user/${authorId}/">Cuenta de prueba</a> publicó en <a href="/groups/123">Grupo de prueba</a></div>
    <div><a href="/photo/?fbid=200000000000004&set=gm.300000000000004"><img alt="Foto"></a></div>
    <div>${content.title}<br>Descripción aprobada</div>
  </div></main>`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body}));
  await page.goto('https://www.facebook.com/groups/123/my_posted_content');

  const result=await snapshot(page,[`author:${authorId}`]);

  expect(result).toMatchObject({complete:true,items:[{id:'300000000000004',state:'published',authorMatches:true,titleMatches:true}]});
});

test('waits for the group list instead of treating its initial shell as complete',async({page})=>{
  const item=groupItem('300000000000005','gm');
  const body=`<main><div role="progressbar">Cargando...</div></main><script>
    setTimeout(()=>{document.querySelector('main').innerHTML=${JSON.stringify(item)}},1200);
  </script>`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body}));
  await page.goto('https://www.facebook.com/groups/123/my_posted_content');

  const result=await snapshot(page,[`author:${authorId}`]);

  expect(result).toMatchObject({complete:true,items:[{id:'300000000000005',state:'published',authorMatches:true,titleMatches:true}]});
});

test('does not use a pending permalink without an observed media ID',async({page})=>{
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
  const title=content.title;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div role="main" aria-label="Colección de tus artículos de Marketplace"><h1>Tus publicaciones</h1><input aria-label="Buscar en tus publicaciones" placeholder="Buscar en tus publicaciones" value="${title}"><div>${rows}<a href="/marketplace/item/399999999999999/">Enlace fuera de la lista</a><span role="progressbar">Cargando…</span></div></div>`}));
  await page.goto(`https://www.facebook.com/marketplace/you/selling?title_search=${encodeURIComponent(title)}`);
  await page.evaluate(()=>{(window as any).controlClicks=0;document.addEventListener('click',()=>{(window as any).controlClicks++;});});

  const result=await snapshot(page,[]);

  expect(result).toMatchObject({complete:false,items:[]});
  const checkExisting=await page.evaluate(({source,content}:any)=>new Function('return ('+source+')')()('check_existing',content,[],[]),{source:facebookFormAction.toString(),content});
  expect(checkExisting.error).toContain('No se envió.');
  expect(await page.getByPlaceholder('Buscar en tus publicaciones').inputValue()).toBe(content.title);
  expect(await page.evaluate(()=>((window as any).controlClicks))).toBe(0);
});

test('leaves group-sale content unknown when the observed own-content card structure is absent',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<main><p>No hay publicaciones para mostrar.</p></main>'}));
  await page.goto('https://www.facebook.com/groups/549198298521944/my_pending_content');

  const result=await snapshot(page,[]);

  expect(result).toMatchObject({complete:true,items:[]});
});

test('accepts exactly one new pending ID with the account author and approved title',()=>{
  const job={destination:{url:'https://www.facebook.com/groups/123'}};
  const baseline=['own-baseline:group','own:300000000000000'];
  const result=ownedGroupResult(job,baseline,[
    {complete:true,items:[{id:'300000000000004',state:'pending_approval',authorMatches:true,titleMatches:true}]},
    {complete:true,items:[]},
  ]);

  expect(result).toMatchObject({status:'pending_approval',url:null,pendingPostId:'300000000000004'});
});

test('does not use a pre-existing ID, an unverified author, or multiple new IDs as evidence',()=>{
  const job={destination:{url:'https://www.facebook.com/groups/123'}};
  const baseline=['own-baseline:group','own:300000000000005'];
  expect(ownedGroupResult(job,baseline,[
    {complete:true,items:[{id:'300000000000005',state:'published',authorMatches:true,titleMatches:true}]},
    {complete:true,items:[]},
  ])).toBeNull();
  expect(ownedGroupResult(job,baseline,[
    {complete:true,items:[{id:'300000000000006',state:'published',authorMatches:false,titleMatches:true}]},
    {complete:true,items:[]},
  ])).toBeNull();
  expect(ownedGroupResult(job,baseline,[
    {complete:true,items:[
      {id:'300000000000007',state:'published',authorMatches:true,titleMatches:true},
      {id:'300000000000008',state:'published',authorMatches:true,titleMatches:true},
    ]},
    {complete:true,items:[]},
  ])).toBeNull();
});

test('builds a group permalink only from the one new verified published item',()=>{
  const result=ownedGroupResult({destination:{url:'https://www.facebook.com/groups/123'}},['own-baseline:group'],[
    {complete:true,items:[{id:'300000000000009',state:'published',authorMatches:true,titleMatches:true}]},
    {complete:true,items:[]},
  ]);

  expect(result).toMatchObject({status:'published',url:'https://www.facebook.com/groups/123/permalink/300000000000009/'});
});

test('tracks the same pending ID through published and not-approved group lists',()=>{
  const job={destination:{url:'https://www.facebook.com/groups/123'}};
  const snapshots=[
    {complete:true,items:[]},
    {complete:true,items:[{id:'300000000000010',state:'published',authorMatches:true,titleMatches:true}]},
    {complete:true,items:[]},
    {complete:true,items:[]},
  ];
  expect(ownedGroupTrackingResult(job,'300000000000010',snapshots)).toMatchObject({
    status:'published',url:'https://www.facebook.com/groups/123/permalink/300000000000010/',pendingPostId:'300000000000010',
  });
  const rejected=[
    {complete:true,items:[]},{complete:true,items:[]},
    {complete:true,items:[{id:'300000000000010',state:'not_approved',authorMatches:true,titleMatches:true}]},
    {complete:true,items:[]},
  ];
  expect(ownedGroupTrackingResult(job,'300000000000010',rejected)).toMatchObject({status:'not_approved',pendingPostId:'300000000000010'});
  expect(ownedGroupTrackingResult(job,'300000000000010',snapshots.map(snapshot=>({...snapshot,complete:false})))).toBeNull();
});
