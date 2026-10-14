import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

for(const mobile of [false,true]) test(`downloads extension from settings (${mobile?'mobile':'desktop'})`,async({page},testInfo)=>{
  if(mobile)await page.setViewportSize({width:390,height:844});
  const owner='10000000-0000-4000-8000-000000000001';
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1')return route.continue();
    if(url.hostname!=='rivastock-test.invalid')return route.abort();
    const name=url.pathname.split('/').pop();
    const data=name==='get_owner_profile'?[{id:owner,email:'test@test.invalid',role:'admin',business_name:'Test',display_name:'Owner'}]:[];
    await route.fulfill({json:data});
  });
  await page.addInitScript(id=>{
    const exp=Math.floor(Date.now()/1000)+3600;
    const encode=(value:unknown)=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    localStorage.setItem('rivastock-auth',JSON.stringify({access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,exp,role:'authenticated'})}.fixture`,refresh_token:'fixture',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id,email:'test@test.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}));
  },owner);
  await page.goto('/config?tab=facebook');
  await expect(page.getByRole('heading',{name:'Publicaciones en Facebook'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Conectar esta PC',exact:true})).toBeDisabled();
  await expect(page.getByText('Extensión sin detectar en este navegador')).toBeVisible();
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('link',{name:'Descargar extensión'}).click();
  const download=await downloadEvent;
  expect(download.suggestedFilename()).toBe('rivastock-facebook.zip');
  const archive=readFileSync((await download.path())!);
  expect(archive.readUInt32LE(0)).toBe(0x04034b50);
  expect(archive.toString()).toContain('manifest.json');
  expect(archive.toString()).not.toContain('fixture-secret');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await testInfo.attach(`facebook-settings-${mobile?'mobile':'desktop'}`,{body:await page.screenshot(),contentType:'image/png'});
  expect(errors).toEqual([]);
});
