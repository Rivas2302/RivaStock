import {test,expect} from '@playwright/test';
import {facebookFormAction} from '../extensions/facebook/form-actions.js';

for(const scenario of ['toast','permalink','wrong-author','wrong-text','missing-photo','old-post','wrong-group','silent-close']) {
  test(`group notices and redirects do not resolve a result without an owned ID: ${scenario}`,async({page})=>{
    await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`
      <div role="dialog"><div role="textbox" contenteditable="true" aria-label="Escribe algo...">Monopoly</div>
      <img alt="Foto" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
      <button>Eliminar archivo adjunto de la publicación</button><button id="publish">Publicar</button></div>
      <script>
      document.documentElement.setAttribute('data-rivastock-flow','fixture');
      document.querySelector('#publish').onclick=()=>{
        document.querySelector('[role=dialog]').remove();
        const scenario=${JSON.stringify(scenario)};
        if(scenario==='silent-close')return;
        if(scenario==='toast'){
          const notice=document.createElement('div');notice.role='status';notice.textContent='Tu publicación se publicó.';
          document.body.append(notice);setTimeout(()=>notice.remove(),80);return;
        }
        history.pushState({},'',scenario==='wrong-group'?'/groups/456/permalink/987/':'/groups/123/permalink/987/');
        const post=document.createElement('div');
        post.innerHTML='<div><a href="/groups/123/user/'+(scenario==='wrong-author'?'222':'111')+'/">Perfil</a><button aria-label="Acciones en esta publicación de Perfil">...</button></div><div>'+(scenario==='wrong-text'?'Otro producto':'Monopoly')+'</div>'+(scenario==='missing-photo'?'':'<div><a href="/photo/?fbid=555&set=gm.987">Foto</a></div>');
        document.body.append(post);
      };
      </script>`}));
    await page.goto('https://www.facebook.com/groups/123');
    const baseline=['flow:fixture','group:/groups/123','author:111','photos:1',...(scenario==='old-post'?['https://www.facebook.com/groups/123/posts/987']:[])];
    const content={groupText:'Monopoly',selection:{marketplace:false}};
    const run=(action:string)=>page.evaluate(({source,content,baseline,action})=>new Function('return ('+source+')')()(action,content,[],baseline),{source:facebookFormAction.toString(),content,baseline,action});
    expect(await run('submit')).toEqual({clicked:true});
    if(scenario==='toast')await expect(page.getByRole('status')).toHaveCount(0);
    const result=await run('result');
    expect(result).toEqual({waiting:true});
  });
}

test('a previously present success notice does not establish receipt',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div role="status">Tu publicación se publicó.</div>'}));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(source=>new Function('return ('+source+')')()('result',{groupText:'Monopoly'},[],['group:/groups/123','notice:Tu publicación se publicó.']),facebookFormAction.toString());
  expect(result).toEqual({waiting:true});
});

const reviewPage=(withReceipt:boolean)=>`<div role="dialog"><h2>Esta publicación está en revisión</h2></div>
  <script>${withReceipt?"document.documentElement.setAttribute('data-rivastock-submit',JSON.stringify({flow:'fixture',started:Date.now(),notices:[]}));":''}</script>`;
const runResult=(page:any,baseline:string[])=>page.evaluate(({source,baseline}:any)=>new Function('return ('+source+')')()('result',{groupText:'Monopoly'},[],baseline),{source:facebookFormAction.toString(),baseline});
const reviewBaseline=['flow:fixture','group:/groups/123','target:/groups/123','groupseg:123','author:111','photos:1'];

test('review dialog on an old permalink is not evidence',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:reviewPage(true)}));
  await page.goto('https://www.facebook.com/groups/123/posts/50');
  const result=await runResult(page,[...reviewBaseline,'https://www.facebook.com/groups/123/posts/50']);
  expect(result.status).toBeUndefined();
});

test('review dialog without a click receipt is not evidence',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:reviewPage(false)}));
  await page.goto('https://www.facebook.com/groups/123/posts/50');
  const result=await runResult(page,reviewBaseline);
  expect(result.status).toBeUndefined();
});

test('review dialog alone does not establish a pending owned-content ID',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:reviewPage(true)}));
  await page.goto('https://www.facebook.com/groups/123/posts/50');
  expect(await runResult(page,reviewBaseline)).toEqual({waiting:true});
});

test('cross-post dialog: only an exact Cerrar button is clicked',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div role="dialog"><h2>Publicación realizada</h2>
    <button aria-label="Cerrar y compartir" onclick="window.clicks=(window.clicks||0)+1">Compartir</button></div>`}));
  await page.goto('https://www.facebook.com/groups/123');
  expect(await runResult(page,reviewBaseline)).toMatchObject({waiting:true});
  expect(await page.evaluate(()=>(window as any).clicks??0)).toBe(0);
});

test('submit refuses a second click in the same tab',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`
    <div role="dialog"><div role="textbox" contenteditable="true" aria-label="Escribe algo...">Monopoly</div>
    <button id="publish" onclick="window.submits=(window.submits||0)+1">Publicar</button></div>
    <script>document.documentElement.setAttribute('data-rivastock-flow','fixture');</script>`}));
  await page.goto('https://www.facebook.com/groups/123');
  const run=()=>page.evaluate(({source}:any)=>new Function('return ('+source+')')()('submit',{groupText:'Monopoly'},[],['flow:fixture','group:/groups/123']),{source:facebookFormAction.toString()});
  expect(await run()).toEqual({clicked:true});
  expect(await run()).toMatchObject({error:expect.stringContaining('ya se realizó')});
  expect(await page.evaluate(()=>(window as any).submits)).toBe(1);
});

test('an inconclusive group result reports only sanitized diagnostics',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Aviso viejo</div><p>Texto personal</p>'}));
  await page.goto('https://www.facebook.com/groups/123');
  expect(await runResult(page,reviewBaseline)).toEqual({waiting:true});
});
