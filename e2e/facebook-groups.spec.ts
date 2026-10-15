import {test,expect} from '@playwright/test';
import {readJoinedGroups} from '../extensions/facebook/group-discovery.js';
import {facebookFormAction} from '../extensions/facebook/form-actions.js';

test('reads joined groups by identity, excludes pending requests and reports a partial list',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<main>
    <section><h2>Solicitudes de grupos pendientes (1)</h2><ul><li><a href="/groups/999/">Pending</a></li></ul></section>
    <section><h2>Todos los grupos a los que te uniste (4)</h2><ul>
    <li><a href="/groups/123/">Same name</a><a href="/groups/123/?ref=test">Same name</a></li>
    <li><a href="/groups/456/">Same name</a></li><li><a href="/groups/PicoVendedeTodo/">Inspected</a></li>
    <li>Group without identity</li><li><a href="https://evil.test/groups/777">External</a></li></ul></section></main>`}));
  await page.goto('https://www.facebook.com/groups/joins/');
  const result=await page.evaluate(readJoinedGroups);
  expect(result.groups).toEqual([{name:'Same name',url:'https://www.facebook.com/groups/123'},{name:'Same name',url:'https://www.facebook.com/groups/456'},{name:'Inspected',url:'https://www.facebook.com/groups/710102875717376'}]);
  expect(result.partial).toBe(true);expect(result.total).toBe(4);
});

test('does not infer approval from old notices or generic feed text',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Tu publicación está pendiente de aprobación.</div>'}));
  await page.goto('https://www.facebook.com/groups/123');
  const args={action:'result',content:{selection:{marketplace:false}},baseline:['group:/groups/123']};
  const result=await page.evaluate(({action,content,baseline,source})=>new Function(`return (${source})` )()(action,content,[],baseline),{...args,source:facebookFormAction.toString()});
  expect(result).toMatchObject({status:'pending_approval',url:null});
  const old=await page.evaluate(({content,source})=>new Function(`return (${source})`)()('result',content,[],['group:/groups/123','notice:Tu publicación está pendiente de aprobación.']),{content:args.content,source:facebookFormAction.toString()});
  expect(old).toEqual({waiting:true});
});
