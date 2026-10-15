import {test,expect} from '@playwright/test';
import {facebookFormAction} from '../extensions/facebook/form-actions.js';

for(const scenario of ['toast','permalink','wrong-author','wrong-text','missing-photo','old-post','wrong-group','silent-close']) {
  test(`group receipt recognizes only causal evidence: ${scenario}`,async({page})=>{
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
    if(scenario==='toast')expect(result).toMatchObject({status:'submitted',url:null});
    else if(scenario==='permalink')expect(result).toMatchObject({status:'submitted',url:'https://www.facebook.com/groups/123/permalink/987/'});
    else expect(result.status).toBeUndefined();
  });
}

test('a previously present success notice does not establish receipt',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div role="status">Tu publicación se publicó.</div>'}));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(source=>new Function('return ('+source+')')()('result',{groupText:'Monopoly'},[],['group:/groups/123','notice:Tu publicación se publicó.']),facebookFormAction.toString());
  expect(result).toEqual({waiting:true});
});
