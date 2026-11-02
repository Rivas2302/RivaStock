import {test,expect} from '@playwright/test';
import {facebookFormAction} from '../extensions/facebook/form-actions.js';

const content={
  title:'[QA] Silla de madera',description:'Descripción de ensayo',price:1200,condition:'new',
  location:'General Pico',category:'Muebles',photos:['https://test.supabase.co/storage/v1/object/public/assets/qa.jpg'],
  groupText:'[QA] Silla de madera\n\nDescripción de ensayo',rehearsal:true,rehearsalId:'test-rehearsal-id',
};
async function run(page:any,action:string,body=content){
  return page.evaluate(({source,action,body})=>new Function('return ('+source+')')()(action,body,[],[]),
    {source:facebookFormAction.toString(),action,body});
}

test('rehearsal submit is blocked before it can click Publish',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<button id="publish">Publicar</button><script>document.querySelector("#publish").onclick=()=>window.sent=true;</script>'}));
  await page.goto('https://www.facebook.com/marketplace/create/item');
  const result=await run(page,'submit');
  expect(result.error).toContain('modo ensayo no permite enviar');
  expect(await page.evaluate(()=>window.sent)).toBeUndefined();
});

test('Marketplace rehearsal discards a populated draft and verifies blank fields after reopening',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><button>Guardar borrador</button>
    <label><span>Título</span><input type="text" value="[QA] Silla de madera"></label>
    <label><span>Precio</span><input type="text" value="1200"></label>
    <label><span>Descripción</span><textarea>Descripción de ensayo</textarea></label>
    <button aria-label="Cerrar" id="close">Cerrar</button><script>
      document.querySelector('#close').onclick=()=>{const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.innerHTML='<h2>¿Descartar el borrador?</h2><button id="discard">Descartar borrador</button>';document.body.append(dialog);dialog.querySelector('#discard').onclick=()=>dialog.remove()};
    </script>`}));
  await page.goto('https://www.facebook.com/marketplace/create/item');
  await page.evaluate(id=>{document.documentElement.dataset.rivastockRehearsalId=id},content.rehearsalId);
  const result=await run(page,'discard_draft',{...content,rehearsalMechanism:'marketplace'});
  expect(result).toEqual({discarded:true,requiresBlankVerification:true});
  await page.goto('https://www.facebook.com/marketplace/create/item');
  await page.setContent(`<!doctype html><meta charset="utf-8"><button>Guardar borrador</button><label><span>Título</span><input type="text"></label><label><span>Precio</span><input type="text"></label>`);
  await page.evaluate(()=>history.replaceState({},'', '/marketplace/create/item'));
  expect(await run(page,'verify_draft_blank',{...content,rehearsalMechanism:'marketplace'})).toEqual({ready:true,blank:true});
});

test('Marketplace rehearsal preserves an existing draft it did not create',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><button>Guardar borrador</button>
    <label><span>Título</span><input type="text" value="Producto personal guardado"></label>
    <label><span>Precio</span><input type="text" value="9000"></label>
    <button aria-label="Cerrar" id="close">Cerrar</button><script>document.querySelector('#close').onclick=()=>window.closedDraft=true;</script>`}));
  await page.goto('https://www.facebook.com/marketplace/create/item');
  const result=await run(page,'discard_draft',{...content,rehearsalMechanism:'marketplace',rehearsalPhase:'preflight'});
  expect(result.error).toContain('Se conservó sin cambios');
  expect(await page.locator('input').first().inputValue()).toBe('Producto personal guardado');
  expect(await page.evaluate(()=>window.closedDraft)).toBeUndefined();
});

test('group rehearsal confirms discard instead of retaining the prepared text',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><div role="dialog" id="editor">
    <div contenteditable="true" data-lexical-editor="true" role="textbox" aria-label="Crea una publicación pública..."><p>[QA] Silla de madera</p><p><br></p><p>Descripción de ensayo</p></div>
    <img alt="rivastock-1.jpg" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" />
    <button aria-label="Cerrar" id="close">Cerrar</button></div><script>
    document.querySelector('#close').onclick=()=>{const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.innerHTML='<h2>¿Descartar la publicación?</h2><button id="discard">Descartar</button>';document.body.append(dialog);dialog.querySelector('#discard').onclick=()=>{dialog.remove();document.querySelector('#editor').remove()}};
  </script>`}));
  await page.goto('https://www.facebook.com/groups/12345');
  await page.evaluate(id=>{document.documentElement.dataset.rivastockRehearsalId=id},content.rehearsalId);
  const result=await run(page,'discard_draft',{...content,rehearsalMechanism:'group_direct'});
  expect(result).toEqual({discarded:true,requiresBlankVerification:false});
  expect(await page.locator('[role="dialog"]').count()).toBe(0);
  expect(await page.evaluate(()=>window.sent)).toBeUndefined();
});

test('group rehearsal preserves an already open editor from outside the rehearsal',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><div role="dialog" id="editor">
    <div contenteditable="true" role="textbox" aria-label="Crea una publicación pública...">Borrador de una publicación real</div>
    <button aria-label="Cerrar" id="close">Cerrar</button></div><script>document.querySelector('#close').onclick=()=>window.closedDraft=true;</script>`}));
  await page.goto('https://www.facebook.com/groups/12345');
  const result=await run(page,'discard_draft',{...content,rehearsalMechanism:'group_direct',rehearsalPhase:'preflight'});
  expect(result.error).toContain('Se conservó sin cambios');
  expect(await page.locator('[contenteditable="true"]').innerText()).toBe('Borrador de una publicación real');
  expect(await page.evaluate(()=>window.closedDraft)).toBeUndefined();
});
