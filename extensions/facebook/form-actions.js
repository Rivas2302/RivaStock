// Runs in Chrome's isolated content-script world. Only observed Spanish UI
// controls are used; no Facebook credentials, cookies or private endpoints.
export async function facebookFormAction(action, content, photos = [], baseline = []) {
  try {
  const normalize = value => (value ?? '').replace(/\s+/g, ' ').trim();
  const lines = value => (value ?? '').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ');
  const editorText = editor => {
    // innerText inserts layout-dependent separators between Lexical paragraphs.
    // Read paragraph boundaries explicitly, preserving empty lines and inline breaks.
    const paragraphs = Array.from(editor.children);
    if (editor.hasAttribute('data-lexical-editor') && paragraphs.length &&
        Array.from(editor.childNodes).every(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P')) {
      const read = node => node.nodeType === Node.TEXT_NODE ? node.textContent :
        node.nodeName === 'BR' ? '\n' : Array.from(node.childNodes).map(read).join('');
      return paragraphs.map(paragraph => paragraph.childNodes.length === 1 &&
        paragraph.firstChild.nodeName === 'BR' ? '' : read(paragraph)).join('\n');
    }
    return editor.innerText;
  };
  const matchesEditor = (editor, approved) =>
    lines(editorText(editor)).replace(/\n+$/, '') === lines(approved).replace(/\n+$/, '');
  const parsePriceARS=(value,approved)=>{
    const raw=normalize(value).replace(/^(?:ARS\s*|\$\s*)/i,'');
    if(/^\d+\.\d{1,2}$/.test(raw))return Math.abs(Number(raw)-approved)<0.000001;
    if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(raw))return false;
    const amount=Number(raw.replaceAll('.','').replace(',','.'));
    return Number.isFinite(amount)&&Math.abs(amount-approved)<0.000001;
  };
  const photoSnapshot=root=>'prepared-photos:'+JSON.stringify(Array.from(root.querySelectorAll('img')).filter(img=>visible(img)&&img.complete&&img.naturalWidth>0&&/foto|vista previa|photo|^rivastock-\d+\./i.test(img.alt)).map(img=>img.currentSrc||img.src));
  const photoSnapshotEntries=value=>{
    if(!value?.startsWith('prepared-photos:'))return null;
    try{const entries=JSON.parse(value.slice('prepared-photos:'.length));return Array.isArray(entries)?entries:null;}catch{return null;}
  };
  const rememberFlow=variant=>{const id=crypto.randomUUID();document.documentElement.setAttribute('data-rivastock-flow',id);return ['variant:'+variant,'flow:'+id];};
  const checkFlow=()=>{const id=baseline.find(value=>value.startsWith('flow:'))?.slice(5);if(!id||document.documentElement.getAttribute('data-rivastock-flow')!==id)throw new Error('Cambió el formulario después de prepararlo. No se envió.');};
  const issue = (kind,message,details={}) => {const error=new Error(message);error.issue={kind,message,...details};throw error;};
  const visible = element => element.getClientRects().length > 0;
  const text = element => normalize(element.textContent);
  const accessibleName = element => element.getAttribute('aria-label') ??
    ((element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
      .map(id => text(document.getElementById(id) ?? document.createElement('span'))).join(' ') || text(element));
  const one = elements => {
    if (elements.length !== 1) throw new Error('El formulario cambió o hay controles ambiguos. No se repitió el envío.');
    return elements[0];
  };
  const wait = async (find, stage = 'respuesta del formulario') => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = find(); if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Facebook no respondió a tiempo durante: ${stage}. Verificá el resultado antes de repetir.`);
  };
  const progress=stage=>{
    if(typeof chrome!=='undefined'&&chrome.runtime?.id) void chrome.runtime.sendMessage({type:'progress',stage}).catch(()=>{});
  };
  const activate=element=>{
    element.scrollIntoView({block:'nearest'});
    element.focus();
    const box=element.getBoundingClientRect();
    const options={bubbles:true,cancelable:true,view:window,clientX:box.x+box.width/2,clientY:box.y+box.height/2,button:0};
    element.dispatchEvent(new PointerEvent('pointerdown',{...options,pointerId:1,pointerType:'mouse',isPrimary:true}));
    element.dispatchEvent(new MouseEvent('mousedown',options));
    element.dispatchEvent(new PointerEvent('pointerup',{...options,pointerId:1,pointerType:'mouse',isPrimary:true}));
    element.dispatchEvent(new MouseEvent('mouseup',options));
    element.click();
  };
  const buttons = (name, root = document, prefix = false) => Array.from(root.querySelectorAll('button,[role="button"]'))
    .filter(visible).filter(element => prefix ? accessibleName(element).startsWith(name) : accessibleName(element) === name);
  const button = (name, root = document, prefix = false) => one(buttons(name, root, prefix));
  const enabled = element => !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true';
  const field = (label, selector) => one(Array.from(document.querySelectorAll('label')).filter(visible)
    .filter(element => Array.from(element.querySelectorAll('span')).some(span => text(span) === label))
    .flatMap(element => Array.from(element.querySelectorAll(selector))));
  const setValue = (element, value) => {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const safety = () => {
    if (location.hostname !== 'www.facebook.com' || /\/(login|checkpoint|recover)\b/.test(location.pathname)) throw new Error('Sesión de Facebook vencida o verificación requerida.');
    if (document.querySelector('input[type="password"],iframe[src*="captcha"]')) throw new Error('Facebook requiere iniciar sesión o resolver una verificación.');
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map(text).join(' ');
    if(/no (puedes|tenés permiso para|tienes permiso para) publicar/i.test(alerts))throw new Error('Facebook indicó que esta cuenta no tiene permiso para publicar.');
    if (/restring|bloque|verifica|verificaci[oó]n/i.test(alerts)) throw new Error('Facebook mostró una restricción o verificación. Revisá la pestaña.');
  };
  safety();
  const marketplaceSnapshot=async includeIds=>{
    if(location.pathname.replace(/\/$/,'')!=='/marketplace/you/selling'||
      new URLSearchParams(location.search).get('title_search')!==content.title)
      throw new Error('No se abrió la búsqueda exacta en tus publicaciones de Marketplace.');
    const root=document.querySelector('[role="main"][aria-label="Colección de tus artículos de Marketplace"]');
    if(!root)throw new Error('No se encontró la lista de publicaciones propias de Marketplace.');
    const search=()=>root.querySelector('input[aria-label="Buscar en tus publicaciones"]');
    const title=normalize(content.title).toLocaleLowerCase('es');
    const cardScopes=()=>{
      const scopes=new Set();
      for(const trigger of root.querySelectorAll('[role="button"][aria-label]')){
        if(normalize(trigger.getAttribute('aria-label')).toLocaleLowerCase('es')!==title)continue;
        if(!normalize(trigger.innerText).toLocaleLowerCase('es').includes(title))continue;
        let scope=trigger.parentElement;
        while(scope&&scope!==root){
          const titleTriggers=Array.from(scope.querySelectorAll('[role="button"][aria-label]'))
            .filter(node=>normalize(node.getAttribute('aria-label')).toLocaleLowerCase('es')===title&&
              normalize(node.innerText).toLocaleLowerCase('es').includes(title));
          const menuButtons=scope.querySelectorAll('[aria-label^="Más opciones para "]');
          if(titleTriggers.length===1&&menuButtons.length===1){scopes.add(scope);break;}
          scope=scope.parentElement;
        }
      }
      return [...scopes];
    };
    let last='',stable=0;
    for(let attempt=0;attempt<40;attempt++){
      const current=normalize(root.innerText)+'|'+Array.from(root.querySelectorAll('[role="button"][aria-label]')).map(node=>node.getAttribute('aria-label')).join('|');
      stable=current===last?stable+1:0;last=current;
      const empty=Array.from(root.querySelectorAll('h2')).some(node=>text(node)==='No encontramos resultados');
      const loaded=search()?.value===content.title&&Array.from(root.querySelectorAll('h1')).some(node=>text(node)==='Tus publicaciones');
      const busy=Array.from(root.querySelectorAll('[aria-busy="true"],[role="progressbar"]')).some(visible);
      if(loaded&&!busy&&stable>=2&&(empty||root.querySelector('[role="button"][aria-label]')))break;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    const empty=Array.from(root.querySelectorAll('h2')).some(node=>text(node)==='No encontramos resultados');
    const complete=search()?.value===content.title&&stable>=2&&
      !Array.from(root.querySelectorAll('[aria-busy="true"],[role="progressbar"]')).some(visible)&&
      (empty||Boolean(root.querySelector('[role="button"][aria-label]')));
    if(!complete)return {complete:false,items:[]};
    const cards=cardScopes();
    if(!includeIds)return {complete:true,items:cards.map(()=>({title:content.title}))};
    const items=[];
    for(const card of cards){
      const trigger=Array.from(card.querySelectorAll('[role="button"][aria-label]'))
        .find(node=>normalize(node.getAttribute('aria-label')).toLocaleLowerCase('es')===title);
      if(!trigger)return {complete:false,items:[]};
      activate(trigger);
      try{
        const detail=await wait(()=>Array.from(document.querySelectorAll('[role="dialog"]'))
          .find(dialog=>Array.from(dialog.querySelectorAll('h2')).some(node=>text(node)==='Tu publicación')),'abrir el anuncio propio');
        const link=await wait(()=>Array.from(detail.querySelectorAll('a[href]')).find(node=>{
          try{const url=new URL(node.href);return url.origin===location.origin&&/^\/marketplace\/item\/\d+\/?$/.test(url.pathname);}catch{return false;}
        }),'leer el ID del anuncio propio');
        const id=new URL(link.href).pathname.match(/^\/marketplace\/item\/(\d+)/)?.[1];
        if(!id)return {complete:false,items:[]};
        const state=/Esta publicaci[oó]n est[aá] en revisi[oó]n/i.test(detail.innerText)?'pending_approval':
          /(?:no se aprob[oó]|rechazad[ao])/i.test(detail.innerText)?'not_approved':'submitted';
        items.push({id,state,authorMatches:true,titleMatches:true});
      }finally{
        const detail=Array.from(document.querySelectorAll('[role="dialog"]'))
          .find(dialog=>Array.from(dialog.querySelectorAll('h2')).some(node=>text(node)==='Tu publicación'));
        detail?.querySelector('[aria-label="Cerrar"]')?.click();
        await wait(()=>!detail||!visible(detail),'cerrar el detalle del anuncio');
      }
    }
    return {complete:true,items};
  };
  if(action==='diagnose') {
    return {
      path:location.pathname,
      variant:location.pathname.startsWith('/groups/')?'group':'marketplace',
      groupEditors:document.querySelectorAll('[contenteditable="true"][aria-label="Crea una publicación pública..."],[contenteditable="true"][role="textbox"][aria-label="Escribe algo..."]').length,
      categories:Array.from(document.querySelectorAll('button,[role="button"],[role="option"],[role="menuitem"]')).filter(visible).map(accessibleName).filter(name=>name.includes('Envío disponible')||name==='Salud y belleza'),
      combos:Array.from(document.querySelectorAll('label[role="combobox"]')).filter(visible).map(element=>({label:accessibleName(element),display:text(element),expanded:element.getAttribute('aria-expanded')})),
      descriptionCount:Array.from(document.querySelectorAll('textarea')).filter(element=>visible(element)&&element.closest('label')?.textContent.includes('Descripción')).length,
      photoInputs:Array.from(document.querySelectorAll('input[type="file"]')).map(element=>({accept:element.getAttribute('accept'),multiple:element.multiple,count:element.files.length})),
      next:buttons('Siguiente').map(element=>({enabled:enabled(element)})),
      publish:buttons('Publicar').map(element=>({enabled:enabled(element)})),
    };
  }
  if(action==='own_content_snapshot') {
    const path=location.pathname.replace(/\/$/,'');
    const groupMatch=path.match(/^\/groups\/([A-Za-z0-9._-]+)\/(my_pending_content|my_posted_content|my_declined_content|my_removed_content)$/);
    if(groupMatch) {
      const groupSegment=groupMatch[1];
      const state={my_pending_content:'pending_approval',my_posted_content:'published',my_declined_content:'not_approved',my_removed_content:'not_approved'}[groupMatch[2]];
      const expectedPath=content.targetGroupUrl?new URL(content.targetGroupUrl).pathname.replace(/\/$/,''):baseline.find(value=>value.startsWith('group:'))?.slice(6);
      if(expectedPath&&expectedPath.split('/')[2]!==groupSegment)throw new Error('Se abrió la lista de otro grupo.');
      const root=document.querySelector('main,[role="main"]')??document.body;
      const signature=()=>normalize(root.innerText)+'|'+Array.from(root.querySelectorAll('a[href]')).map(link=>link.getAttribute('href')).join('|');
      let last='',stable=0;
      for(let attempt=0;attempt<60;attempt++) {
        const current=signature();stable=current===last?stable+1:0;last=current;
        const headings=Array.from(root.querySelectorAll('h3,[role="heading"]')).filter(visible).filter(heading=>/publicó en/i.test(text(heading)));
        const empty=/No hay publicaciones para mostrar/i.test(root.innerText);
        const loading=Array.from(root.querySelectorAll('[aria-busy="true"],[role="progressbar"]')).some(visible)||/\bCargando(?:…|\.{3})?/i.test(root.innerText);
        if(stable>=2&&(headings.length>0||(empty&&!loading)))break;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      const loading=Array.from(root.querySelectorAll('[aria-busy="true"],[role="progressbar"]')).some(visible)||/\bCargando(?:…|\.{3})?/i.test(root.innerText);
      const headings=Array.from(root.querySelectorAll('h3,[role="heading"]')).filter(visible).filter(heading=>/publicó en/i.test(text(heading)));
      const empty=/No hay publicaciones para mostrar/i.test(root.innerText);
      const authorId=baseline.find(value=>value.startsWith('author:'))?.slice(7);
      const approvedTitle=normalize(content.title??'').toLocaleLowerCase('es');
      const itemIds=scope=>[...new Set(Array.from(scope.querySelectorAll('a[href]')).filter(visible).flatMap(link=>{
        try {
          const url=new URL(link.href);if(url.origin!==location.origin)return [];
          const set=url.searchParams.get('set')?.match(/^(?:gm|pcb)\.(\d+)$/)?.[1];
          const path=url.pathname.match(new RegExp(`^/groups/${groupSegment}/(?:posts|permalink)/(\\d+)/?$`))?.[1];
          const permalink=state==='published'?url.searchParams.get('multi_permalinks')?.match(/^\d+$/)?.[0]:null;
          return [set,path,permalink].filter(Boolean);
        } catch {return [];}
      }))];
      const items=[];
      for(const heading of headings) {
        const headingLinks=Array.from(heading.querySelectorAll('a[href]'));
        const groupLink=headingLinks.some(link=>{try{return new URL(link.href).origin===location.origin&&new URL(link.href).pathname.replace(/\/$/,'')===`/groups/${groupSegment}`;}catch{return false;}});
        if(!groupLink)continue;
        let scope=heading.parentElement;
        while(scope&&scope!==root) {
          const nested=Array.from(scope.querySelectorAll('h3,[role="heading"]')).filter(visible).filter(node=>/publicó en/i.test(text(node)));
          if(nested.length===1) {
            const ids=itemIds(scope);
            if(ids.length===1) {
              const authorMatches=Boolean(authorId&&Array.from(scope.querySelectorAll('a[href]')).some(link=>{
                try{return new URL(link.href).origin===location.origin&&new URL(link.href).pathname.replace(/\/$/,'')===`/groups/${groupSegment}/user/${authorId}`;}catch{return false;}
              }));
              const titleMatches=Boolean(approvedTitle&&normalize(scope.innerText).toLocaleLowerCase('es').includes(approvedTitle));
              const itemState=state==='published'&&/Esta publicaci[oó]n est[aá] en revisi[oó]n/i.test(scope.innerText)?'pending_approval':state;
              items.push({id:ids[0],state:itemState,authorMatches,titleMatches});
              break;
            }
          }
          scope=scope.parentElement;
        }
      }
      // Facebook keeps a loader below older posts. A stable visible first page
      // is enough to compare the newest IDs before and after one submission.
      return {complete:stable>=2&&(headings.length>0||empty)&&(!loading||headings.length>0),items};
    }
    if(path==='/marketplace/you/selling') {
      return await marketplaceSnapshot(true);
    }
    throw new Error('No se abrió una lista de contenido propio compatible.');
  }
  // Result pages and feed notices are not causal evidence. Only the adapter's
  // before/after snapshots of owned-content lists may resolve a new attempt.
  if(action==='result')return {waiting:true};
  if(action==='result_search')return {notFound:true};
  const photoIds = () => Array.from(document.querySelectorAll('a[href]')).flatMap(element => {
    try { const value = new URL(element.href).searchParams.get('set'); return value?.startsWith('gm.') ? [value.slice(3)] : []; } catch { return []; }
  });
  const attach = input => {
    if (input.files.length) throw new Error('El formulario ya tiene fotos. Revisá la pestaña antes de continuar.');
    const transfer = new DataTransfer();
    photos.forEach((photo, index) => transfer.items.add(new File([Uint8Array.from(atob(photo.data), char => char.charCodeAt(0))], `rivastock-${index + 1}.${photo.extension}`, { type: photo.type })));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const combo = label => one(Array.from(document.querySelectorAll('label[role="combobox"]')).filter(visible).filter(element => accessibleName(element) === label));
  if (action === 'check_existing') {
    const snapshot=await marketplaceSnapshot(false);
    if(!snapshot.complete)throw new Error('No se pudo verificar la búsqueda de anuncios propios. No se envió.');
    if(snapshot.items.length)issue('marketplace_conflict','Ya existe un anuncio de Marketplace con el título aprobado. Revisá su identidad antes de volver a publicar.',{candidates:[]});
    return {ready:true};
  }
  if (action === 'marketplace_prepare') {
    if (location.pathname !== '/marketplace/create/item' || location.search) throw new Error('No se abrió un formulario nuevo de Marketplace.');
    await wait(() => buttons('Guardar borrador').length);
    const title = field('Título', 'input[type="text"]'); const price = field('Precio', 'input[type="text"]');
    if (title.value || price.value) throw new Error('Hay un borrador existente. No se sobrescribió.');
    setValue(title, content.title); setValue(price, String(content.price));
    if(!parsePriceARS(price.value, content.price))throw new Error('El precio del formulario no coincide con el aprobado. No se envió.');
    progress('Seleccionando categoría');
    const scrollable=()=>Array.from(document.querySelectorAll('*')).filter(element=>visible(element)&&element.scrollHeight>element.clientHeight+8&&/auto|scroll/.test(getComputedStyle(element).overflowY));
    const previousScrollers=new Set(scrollable());
    const categoryControl=combo('Categoría');
    activate(categoryControl);
    const categoryName=element=>normalize(accessibleName(element).replace(/\s*Envío disponible$/,''));
    const choices=()=>Array.from(document.querySelectorAll('button,[role="button"],[role="option"],[role="menuitem"]')).filter(visible).filter(element=>categoryName(element)===normalize(content.category));
    let found=false;
    // Some menus render category rows only as their own scroll area moves.
    // Scroll only a newly opened menu, never the page or the form sidebar.
    for(let attempt=0;attempt<40;attempt++) {
      safety();
      const matches=choices();
      if(matches.length) {
        const choice=one(matches);
        choice.scrollIntoView({block:'nearest'});
        activate(choice);found=true;break;
      }
      const menus=scrollable().filter(element=>!previousScrollers.has(element)&&element.querySelector('button,[role="button"],[role="option"],[role="menuitem"]'));
      if(menus.length>1)throw new Error('Hay más de un menú de categorías. No se eligió una categoría a ciegas.');
      if(menus.length===1) {
        const menu=menus[0];
        menu.scrollTop=Math.min(menu.scrollTop+Math.max(80,menu.clientHeight*0.7),menu.scrollHeight-menu.clientHeight);
        menu.dispatchEvent(new Event('scroll',{bubbles:true}));
      }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!found)throw new Error(`No se encontró la categoría «${content.category}» en el menú de Facebook. No se envió.`);
    await wait(()=>text(categoryControl).includes(content.category)&&categoryControl.getAttribute('aria-expanded')!=='true','confirmar la categoría seleccionada');
    progress('Seleccionando estado');
    const conditionControl=combo('Estado');
    activate(conditionControl);
    const condition = { new: 'Nuevo', like_new: 'Usado - Como nuevo', good: 'Usado - Buen estado', fair: 'Usado - Aceptable' }[content.condition];
    await wait(() => Array.from(document.querySelectorAll('[role="option"]')).some(element => visible(element) && text(element) === condition),'buscar el estado del producto');
    activate(one(Array.from(document.querySelectorAll('[role="option"]')).filter(visible).filter(element => text(element) === condition)));
    await wait(()=>text(conditionControl).includes(condition)&&conditionControl.getAttribute('aria-expanded')!=='true','confirmar el estado seleccionado');
    if(!text(categoryControl).includes(content.category))throw new Error('La categoría seleccionada no coincide con la aprobada. No se envió.');
    if(!text(conditionControl).includes(condition))throw new Error('El estado seleccionado no coincide con el aprobado. No se envió.');
    progress('Completando descripción y ubicación');
    if (!Array.from(document.querySelectorAll('textarea')).some(element => visible(element) && element.closest('label')?.textContent.includes('Descripción'))) button('Más detalles', document, true).click();
    await wait(()=>Array.from(document.querySelectorAll('textarea')).some(element=>visible(element)&&element.closest('label')?.textContent.includes('Descripción')),'abrir los detalles del producto');
    const description=field('Descripción', 'textarea');
    setValue(description, content.description);
    const place = one(Array.from(document.querySelectorAll('input[aria-label="Ubicación"][role="combobox"]')).filter(visible));
    if (normalize(place.value) !== normalize(content.location)) {
      setValue(place,content.location);
      const options=()=>Array.from(document.querySelectorAll('li[role="option"]')).filter(visible).filter(element=>normalize(text(element).replace(/Ciudad$/,'')).toLowerCase()===normalize(content.location).toLowerCase());
      await wait(()=>options().length>0,'buscar la ciudad');
      one(options()).click();
      await wait(()=>normalize(place.value).toLowerCase()===normalize(content.location).toLowerCase()&&place.getAttribute('aria-expanded')!=='true');
    }
    for (const label of ['Promocionar tras publicar', 'Ocultar a amigos']) {
      const control = document.querySelector(`input[aria-label="${label}"]`);
      if (control?.checked || control?.getAttribute('aria-checked') === 'true') throw new Error('Facebook cambió las preferencias de publicación. Revisá la pestaña.');
    }
    const input = one(Array.from(document.querySelectorAll('input[type="file"][multiple]')).filter(element => (element.getAttribute('accept') ?? '').split(',').includes('image/*')));
    progress('Cargando fotos');
    attach(input);
    await wait(() => enabled(button('Siguiente')) && !buttons('Guardar borrador').some(element => !enabled(element)),'cargar fotos y habilitar Siguiente');
    const previews=()=>Array.from(document.querySelectorAll('img')).filter(img=>visible(img)&&/^(foto|photo)\b/i.test(img.alt));
    // Facebook's own "Fotos · N/10" counter is authoritative; a background tab may
    // not have decoded the thumbnails yet, so either signal may confirm the count.
    const photoCounter=()=>Number(normalize(document.body.innerText).match(/Fotos\s*·\s*(\d+)\s*\/\s*10\b/)?.[1]??NaN);
    const photosConfirmed=()=>photoCounter()===photos.length||(previews().length===photos.length&&previews().every(img=>img.complete&&img.naturalWidth>0));
    try{await wait(photosConfirmed,'verificar las fotos cargadas');}
    catch{throw new Error(`Se esperaban ${photos.length} fotos cargadas; Facebook indica ${Number.isNaN(photoCounter())?'sin contador':photoCounter()} y se observaron ${previews().length} vistas previas${previews().some(img=>!img.complete||img.naturalWidth===0)?' (alguna sin terminar de cargar)':''}. No se envió.`);}
    if(title.value!==content.title||!parsePriceARS(price.value,content.price)||lines(description.value)!==lines(content.description)||normalize(place.value).toLowerCase()!==normalize(content.location).toLowerCase()) throw new Error('Los valores del formulario no coinciden con el contenido aprobado. No se envió.');
    progress('Verificando destinos antes de publicar');
    button('Siguiente').click();
    await wait(() => /Publicar en más lugares/.test(document.body.innerText) && buttons('Publicar').length === 1,'abrir el paso final de Marketplace');
    if (document.querySelector('[role="checkbox"][aria-checked="true"],input[type="checkbox"]:checked')) throw new Error('Facebook seleccionó destinos adicionales. No se envió.');
    const baselineMarketplaceUrls=()=>Array.from(document.querySelectorAll('a[href]')).flatMap(element=>{try{const url=new URL(element.href);return url.origin===location.origin&&/^\/marketplace\/item\/\d+\/?$/.test(url.pathname)?[url.origin+url.pathname]:[];}catch{return [];}});
    const baselineMarketplaceNotices=()=>Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).filter(visible).map(node=>'notice:'+text(node));
    const baseline=[...rememberFlow('marketplace'),photoSnapshot(document),'photos:'+photos.length,...(content.allowRepublish===true?['marketplace:new-explicit']:[]),...new Set(baselineMarketplaceUrls()),...baselineMarketplaceNotices()];
    return { ready: true, baseline };
  }
  const saleOriginName=target=>{
    if(location.pathname.replace(/\/$/,'')!==target)return null;
    const main=document.querySelector('main,[role="main"]');if(!main)return null;
    const headings=Array.from(main.querySelectorAll('h1,[role="heading"][aria-level="1"]')).filter(visible);
    const members=Array.from(main.querySelectorAll('a[href]')).some(link=>{const url=new URL(link.href);return url.origin===location.origin&&url.pathname.replace(/\/$/,'')===target+'/members';});
    return members&&headings.length===1?text(headings[0]):null;
  };
  const verifySaleAudience=(root,target,originName)=>{
    const selected=Array.from(root.querySelectorAll('[role="checkbox"][aria-checked="true"],input[type="checkbox"]:checked'));
    if(selected.length!==1)return false;
    const row=selected[0].closest('label')??selected[0].parentElement;
    const links=Array.from(row.querySelectorAll('a[href]'));
    if(links.length===1){const url=new URL(links[0].href);return url.origin===location.origin&&url.pathname.replace(/\/$/,'')===target;}
    // Observed group sale confirmation omits group URLs. Identify its source
    // from the unchanged page URL + members link, then its dedicated primary
    // choice before the additional-group section. Names alone never identify it.
    if(links.length||!originName||saleOriginName(target)!==originName)return false;
    const headings=Array.from(root.querySelectorAll('h1,h2,[role="heading"]'));
    const title=headings.filter(node=>text(node)==='Compartir en más lugares');
    const others=headings.filter(node=>text(node)==='Agrega tu publicación en otros grupos');
    if(title.length!==1||others.length!==1)return false;
    const before=(a,b)=>Boolean(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING);
    const primary=Array.from(root.querySelectorAll('[role="checkbox"],input[type="checkbox"]')).filter(node=>before(title[0],node)&&before(node,others[0]));
    const offer=buttons('Marketplace',root,true);
    return primary.length===1&&primary[0]===selected[0]&&normalize(primary[0].innerText).startsWith(originName+' ')&&offer.length===1&&offer[0].getAttribute('aria-pressed')!=='true'&&offer[0].getAttribute('aria-checked')!=='true'&&text(root).includes('Agrega tu publicación en Marketplace');
  };
  if(action==='group_sale_prepare') {
    const target=new URL(content.targetGroupUrl).pathname.replace(/\/$/,'');
    if(location.pathname.replace(/\/$/,'')!==target)throw new Error('El grupo no corresponde al destino aprobado.');
    const originName=saleOriginName(target);
    if(Array.from(document.querySelectorAll('[role="dialog"]')).some(visible))throw new Error('Hay un formulario abierto. No se sobrescribió.');
    await wait(()=>buttons('Vender algo').length===1,'cargar Vender algo');activate(button('Vender algo'));
    const sale=await wait(()=>buttons('Artículo en venta',document,true).length===1&&buttons('Artículo en venta',document,true)[0],'elegir Artículo en venta');activate(sale);
    const dialog=await wait(()=>Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).find(node=>text(node).includes('Artículo en venta')&&node.querySelector('input[type="file"]')),'abrir el formulario de venta');
    const saleField=(label,selector)=>one(Array.from(dialog.querySelectorAll('label')).filter(visible).filter(node=>Array.from(node.querySelectorAll('span')).some(span=>text(span)===label)).flatMap(node=>node.matches(selector)?[node]:Array.from(node.querySelectorAll(selector))));
    const title=saleField('Título','input');const price=saleField('Precio','input');
    if(title.value||price.value)throw new Error('El formulario de venta contiene un borrador.');
    setValue(title,content.title);setValue(price,String(content.price));
    if(!parsePriceARS(price.value, content.price))throw new Error('El precio de venta no coincide con el aprobado. No se envió.');
    const conditionControl=saleField('Estado','[role="combobox"]');
    // Facebook uses the label itself as the combobox in this composer.
    activate(conditionControl);
    const condition={new:'Nuevo',like_new:'Usado - Como nuevo',good:'Usado - Buen estado',fair:'Usado - Aceptable'}[content.condition];
    activate(await wait(()=>Array.from(document.querySelectorAll('[role="option"]')).filter(visible).find(node=>text(node)===condition),'elegir el estado'));
    await wait(()=>text(conditionControl).includes(condition),'confirmar el estado de la venta');
    if(!text(conditionControl).includes(condition))throw new Error('El estado de la venta no coincide con el aprobado. No se envió.');
    if(!Array.from(dialog.querySelectorAll('textarea')).some(visible))activate(button('Más detalles',dialog,true));
    const description=await wait(()=>{try{return saleField('Descripción','textarea');}catch{return null;}},'abrir la descripción');
    setValue(description,content.description);
    const place=one(Array.from(dialog.querySelectorAll('input[aria-label="Ubicación"]')).filter(visible));
    if(normalize(place.value).toLowerCase()!==normalize(content.location).toLowerCase()) {
      setValue(place,content.location);
      const options=await wait(()=>{const options=Array.from(document.querySelectorAll('[role="option"]')).filter(visible).filter(node=>normalize(text(node).replace(/Ciudad$/,'')).toLowerCase()===normalize(content.location).toLowerCase());return options.length===1?options[0]:null;},'confirmar la ubicación');activate(options);
    }
    const extraFields=Array.from(dialog.querySelectorAll('input[required],textarea[required],select[required],[aria-required="true"]')).filter(visible).filter(node=>![title,price,description,place,conditionControl].includes(node));
    const missing=[];
    for(const control of extraFields) {
      const label=control.getAttribute('aria-label')||text(control.closest('label')??control);
      const value=content.deliveryResolution?.fields?.[label];
      const options=control.tagName==='SELECT'?Array.from(control.options).map(option=>({value:option.value,label:option.text})):null;
      if(!value||!['INPUT','TEXTAREA','SELECT'].includes(control.tagName)||(control.tagName==='INPUT'&&!['text','number','search','tel'].includes(control.type))||options&&!options.some(option=>option.value===value))missing.push({label,options,supported:['INPUT','TEXTAREA','SELECT'].includes(control.tagName)&&!['file','checkbox','radio'].includes(control.type)});
      else if(control.tagName==='SELECT'){control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));}else setValue(control,value);
    }
    if(missing.length)issue('group_sale_fields','El formulario requiere datos adicionales. Completalos y aprobá el formato de venta desde RivaStock.',{fields:missing.slice(0,12)});
    attach(one(Array.from(dialog.querySelectorAll('input[type="file"][multiple]')).filter(node=>(node.accept??'').split(',').includes('image/*'))));
    progress('Verificando fotos del artículo en venta');
    await wait(()=>{
      const controls=Array.from(dialog.querySelectorAll('button,[role="button"]')).filter(visible).map(accessibleName).map(name=>name.match(/^Eliminar foto (\d+) de (\d+)$/)).filter(Boolean);
      const indexes=new Set(controls.map(match=>Number(match[1])));
      const images=Array.from(dialog.querySelectorAll('img[alt="Foto de la publicación"]')).filter(visible);
      const counter=text(dialog).match(/Fotos\s*[·:]?\s*(\d+)\s*\/\s*(\d+)/);
      return controls.length===photos.length&&indexes.size===photos.length&&controls.every(match=>Number(match[2])===photos.length&&Number(match[1])>=1&&Number(match[1])<=photos.length)&&images.length===photos.length&&images.every(image=>image.complete&&image.naturalWidth>0)&&counter&&Number(counter[1])===photos.length&&enabled(button('Siguiente',dialog));
    },'verificar fotos del formulario de venta');
    if(title.value!==content.title||!parsePriceARS(price.value,content.price)||lines(description.value)!==lines(content.description)||normalize(place.value).toLowerCase()!==normalize(content.location).toLowerCase())throw new Error('Los datos de venta no coinciden con los aprobados.');
    const notices=Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map(node=>'notice:'+text(node));
    activate(button('Siguiente',dialog));
    await wait(()=>buttons('Publicar').length===1,'abrir la confirmación de venta');
    const final=button('Publicar').closest('[role="dialog"]');
    if(!final||!verifySaleAudience(final,target,originName))issue('group_sale_audience','No se pudo verificar que la venta se enviará únicamente al grupo aprobado. Revisá el formulario; no se autorizó Publicar.');
    return {ready:true,baseline:[...rememberFlow('group_sale'),photoSnapshot(dialog),'salephotos:'+photos.length,...notices,'group:'+target,'sale:approved',...(originName?['sale:origin:'+originName]:[])]};
  }
  if (action === 'group_prepare') {
    const target=content.targetGroupUrl?new URL(content.targetGroupUrl).pathname.replace(/\/$/,''):location.pathname.replace(/\/$/,'');
    const actual=location.pathname.replace(/\/$/,'');
    if(!/^\/groups\/[A-Za-z0-9._-]+$/.test(actual))throw new Error('El grupo abierto no corresponde a la URL aprobada. No se envió.');
    if(document.querySelector('[role="dialog"] [contenteditable="true"]'))throw new Error('Hay un borrador abierto en el grupo. No se sobrescribió.');
    const before = [...new Set(photoIds())];
    if(Array.from(document.querySelectorAll('h2,h3,[role="heading"]')).some(h=>visible(h)&&/este grupo está en pausa/i.test(text(h))))throw new Error('Este grupo está en pausa. No se puede publicar hasta que un administrador lo reactive.');
    await wait(() => {
      if(buttons('Vender algo').length===1&&buttons('Escribe algo...').length!==1)issue('group_sale_required','Este grupo utiliza un formulario de venta. Revisá y aprobá ese formato desde RivaStock.');
      const denial=Array.from(document.querySelectorAll('[role="alert"]')).filter(visible).some(node=>/no (puedes|tenés permiso para|tienes permiso para) publicar/i.test(text(node)));
      if(denial)throw new Error('Facebook indicó que esta cuenta no tiene permiso para publicar en el grupo.');
      return buttons('Escribe algo...').length===1;
    },'cargar el editor del grupo; no se pudo determinar su disponibilidad');
    if(normalize(document.body.innerText).includes(normalize(content.groupText)))throw new Error('El grupo ya muestra el contenido aprobado. Verificá el post antes de publicar otro.');
    // A landing segment other than the approved one is a trusted alias only when
    // the page shows the approved group's name; otherwise it may be another group.
    const targetSeg=target.split('/')[2],actualSeg=actual.split('/')[2];
    if(actualSeg!==targetSeg){
      const approvedName=normalize(content.targetGroupName||'').toLowerCase();
      const showsApprovedName=Boolean(approvedName)&&[document.title,...Array.from(document.querySelectorAll('h1')).filter(visible).map(text)].some(value=>normalize(value).toLowerCase().includes(approvedName));
      if(!showsApprovedName)throw new Error('El grupo abierto no corresponde a la URL aprobada. No se envió.');
    }
    let authorId=null,authorGroupSeg=null;
    let authorScope=button('Escribe algo...');
    while(authorScope&&authorScope!==document.body) {
      const authorLinks=Array.from(authorScope.querySelectorAll('a[href]')).map(element => new URL(element.href).pathname.match(/^\/groups\/([^/]+)\/user\/([0-9]+)\/?$/)).filter(Boolean);
      const authors=authorLinks.map(match=>match[2]);
      // The composer's own author link names this group by the id Facebook uses in post URLs.
      if(authors.length===1){authorId=authors[0];authorGroupSeg=authorLinks[0][1];break;}
      if(authors.length>1)break;
      authorScope=authorScope.parentElement;
    }
    if(!authorId)throw new Error('No se pudo verificar el perfil que publica en el grupo.');
    button('Escribe algo...').click();
    let editor = await wait(() => document.querySelector('[contenteditable="true"][role="textbox"][aria-label="Crea una publicación pública..."],[contenteditable="true"][role="textbox"][aria-label="Escribe algo..."]'));
    const dialog = editor.closest('[role="dialog"]');
    if (!dialog || text(editor)) throw new Error('El editor del grupo contiene un borrador. No se sobrescribió.');
    const anonymous = dialog.querySelector('[role="switch"][aria-label="Publicar de forma anónima"]');
    if (anonymous?.getAttribute('aria-checked') === 'true') throw new Error('El editor está en modo anónimo. No se envió.');
    const liveEditor = () => {
      if (!dialog.isConnected) throw new Error('Facebook reemplazó el formulario. No se envió.');
      return one(Array.from(dialog.querySelectorAll('[contenteditable="true"][role="textbox"][aria-label="Crea una publicación pública..."],[contenteditable="true"][role="textbox"][aria-label="Escribe algo..."]')));
    };
    editor.focus();
    const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
    await new Promise(resolve=>setTimeout(resolve,0));
    const approved=lines(content.groupText);
    if(editor.hasAttribute('data-lexical-editor')) {
      // Use Lexical's public paste handler so paragraph nodes enter its model.
      const transfer=new DataTransfer();transfer.setData('text/plain',approved);
      // Lexical's HTML importer collapses ordinary HTML whitespace, including
      // trailing title spaces. NBSP survives import; lines() compares it as space.
      const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/(^ +| +$| {2,})/g,spaces=>'&nbsp;'.repeat(spaces.length));
      transfer.setData('text/html',approved.split('\n').map(l=>'<p>'+(l?escape(l):'<br>')+'</p>').join(''));
      editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));
      await new Promise(resolve=>setTimeout(resolve,0));
    } else {
      const edit=async(command,value)=>{
        editor=liveEditor();editor.focus();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
        if(!document.execCommand(command,false,value))throw new Error('Facebook no aceptó la escritura del contenido.');
        await new Promise(resolve=>setTimeout(resolve,0));
      };
      for(const [index,line] of approved.split('\n').entries()) {
        if(index)await edit('insertLineBreak');
        if(line)await edit('insertText',line);
      }
    }
    editor=liveEditor();
    if(!matchesEditor(editor,approved))throw new Error('El texto del editor no coincide con el aprobado. Se detuvo antes de cargar fotos y de enviar.');
    const inputs = Array.from(dialog.querySelectorAll('input[type="file"][multiple]')).filter(element => (element.getAttribute('accept') ?? '').split(',').includes('image/*'));
    // Observed composer has equivalent image inputs. Upload exactly once using
    // the input closest to Foto/video; refuse ties instead of guessing.
    const photoButton = button('Foto/video', dialog);
    let scope = photoButton;
    while (scope !== dialog && !scope.querySelector('input[type="file"][multiple]')) scope = scope.parentElement;
    const associated = inputs.filter(input => scope.contains(input));
    attach(one(associated));
    await wait(() => {
      const previews=Array.from(dialog.querySelectorAll('img')).filter(img=>/^rivastock-\d+\.(?:jpe?g|png|webp)$/i.test(img.alt));
      return enabled(button('Publicar', dialog))&&previews.length===photos.length&&
        previews.every((img,index)=>img.alt===`rivastock-${index+1}.${photos[index].extension}`&&visible(img)&&img.complete&&img.naturalWidth>0);
    },'carga y verificación de todas las fotos del grupo');
    if(dialog.querySelector('[role="checkbox"][aria-checked="true"],input[type="checkbox"]:checked'))throw new Error('El editor seleccionó otros grupos. No se envió.');
    const alerts=Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map(node=>`notice:${text(node)}`);
    const existingPostUrls=Array.from(document.querySelectorAll('a[href]')).flatMap(element=>{try{const url=new URL(element.href);return url.origin===location.origin&&/^\/groups\/[A-Za-z0-9._-]+\/(posts|permalink)\/\d+\/?$/.test(url.pathname)?[url.origin+url.pathname]:[];}catch{return [];}});
    return { ready: true, baseline: [...rememberFlow('group'),photoSnapshot(dialog),...before,...new Set(existingPostUrls),...alerts,`author:${authorId}`,`group:${actual}`,`photos:${photos.length}`,`target:${target}`,...new Set([targetSeg,actualSeg,/^\d+$/.test(authorGroupSeg??'')?authorGroupSeg:null].filter(Boolean).map(seg=>'groupseg:'+seg))] };
  }
  if (action === 'submit') {
    // One final click per tab and flow: a repeated submit never clicks again.
    const submitFlow=baseline.find(value=>value.startsWith('flow:'))?.slice(5);
    const priorSubmit=(()=>{try{return JSON.parse(document.documentElement.getAttribute('data-rivastock-submit'));}catch{return null;}})();
    if(submitFlow&&priorSubmit?.flow===submitFlow&&Date.now()-priorSubmit.started<120000)throw new Error('El envío ya se realizó en esta pestaña. No se repitió.');
    const previousPhotos=baseline.find(value=>value.startsWith('prepared-photos:'));
    const currentPhotos=photoSnapshot(document.querySelector('[role="dialog"]')??document);
    const photoCount=baseline.find(value=>value.startsWith('photos:'))?.slice(7);
    if(photoCount!==undefined){
      const expected=Number(photoCount);
      const prepared=photoSnapshotEntries(previousPhotos);
      const current=photoSnapshotEntries(currentPhotos);
      if(!Number.isSafeInteger(expected)||expected<0||!prepared||!current||prepared.length!==expected||current.length!==expected||JSON.stringify(prepared)!==JSON.stringify(current))
        throw new Error('Cambió el orden o la carga de las fotos después de preparar. No se envió.');
    }else if(previousPhotos&&previousPhotos!==currentPhotos)throw new Error('Cambió el orden o la carga de las fotos después de preparar. No se envió.');
    // The worker must obtain an atomic database checkpoint before calling this
    // action. This function never retries the final click.
    const marketplace=baseline.includes('variant:marketplace');
    if (marketplace) {
      checkFlow();
      if(location.pathname!=='/marketplace/create/item'||!/Publicar en más lugares/.test(document.body.innerText))throw new Error('Cambió el paso final de Marketplace. No se envió.');
      const read=(label,selector)=>Array.from(document.querySelectorAll('label')).filter(node=>Array.from(node.querySelectorAll('span')).some(span=>text(span)===label)).flatMap(node=>Array.from(node.querySelectorAll(selector)));
      const titles=read('Título','input'),prices=read('Precio','input'),descriptions=read('Descripción','textarea');
      if(titles.length&&titles.some(node=>node.value!==content.title)||prices.length&&prices.some(node=>!parsePriceARS(node.value,content.price))||descriptions.length&&descriptions.some(node=>lines(node.value)!==lines(content.description)))throw new Error('Los datos cambiaron antes del clic final. No se envió.');
      for(const [label,expected] of [['Categoría',content.category],['Estado',{new:'Nuevo',like_new:'Usado - Como nuevo',good:'Usado - Buen estado',fair:'Usado - Aceptable'}[content.condition]]]){
        const controls=Array.from(document.querySelectorAll('label[role="combobox"]')).filter(node=>accessibleName(node)===label);
        if(controls.length&&(controls.length!==1||!text(controls[0]).includes(expected)))throw new Error('Cambió una selección aprobada. No se envió.');
      }
      const places=Array.from(document.querySelectorAll('input[aria-label="Ubicación"]'));if(places.some(node=>normalize(node.value).toLowerCase()!==normalize(content.location).toLowerCase()))throw new Error('Cambió la ubicación. No se envió.');
      for(const label of ['Promocionar tras publicar','Ocultar a amigos']){const control=document.querySelector('input[aria-label="'+label+'"]');if(control?.checked||control?.getAttribute('aria-checked')==='true')throw new Error('Cambió una preferencia de publicación. No se envió.');}
      // Same rule as preparation: the "Vista previa" panel image is not an uploaded photo.
      const previews=Array.from(document.querySelectorAll('img')).filter(img=>visible(img)&&/^(foto|photo)\b/i.test(img.alt));
      const approvedPhotos=Number(baseline.find(value=>value.startsWith('photos:'))?.slice(7));
      const counted=Number(normalize(document.body.innerText).match(/Fotos\s*·\s*(\d+)\s*\/\s*10\b/)?.[1]??NaN);
      // The same rule as preparation: Facebook's counter, or loaded thumbnails, must match.
      if(!Number.isNaN(counted)?counted!==approvedPhotos:previews.length&&(previews.length!==approvedPhotos||previews.some(img=>!img.complete||!img.naturalWidth)))throw new Error('Cambió la carga de fotos. No se envió.');

      if (document.querySelector('[role="checkbox"][aria-checked="true"],input[type="checkbox"]:checked')) throw new Error('Facebook seleccionó destinos adicionales. No se envió.');

      const publish = button('Publicar');
      if (!enabled(publish)) throw new Error('Facebook no habilitó Publicar.');
      if(submitFlow)document.documentElement.setAttribute('data-rivastock-submit',JSON.stringify({flow:submitFlow,started:Date.now(),notices:[]}));
      publish.click(); return { clicked: true };
    }
    const editor = document.querySelector('[aria-label="Crea una publicación pública..."][contenteditable="true"],[role="textbox"][aria-label="Escribe algo..."][contenteditable="true"]');
    const group=baseline.find(value=>value.startsWith('group:'))?.slice(6);
    const sale=baseline.includes('sale:approved');
    if(group&&((!editor&&!sale)||location.pathname.replace(/\/$/,'')!==group))throw new Error('Cambió el editor o el grupo antes de enviar. No se envió.');
    const root = editor?.closest('[role="dialog"]') ?? (sale?button('Publicar').closest('[role="dialog"]'):document);
    if(!root)throw new Error('Cambió el formulario antes de enviar.');
    if(!sale&&root.querySelector('[role="checkbox"][aria-checked="true"],input[type="checkbox"]:checked'))throw new Error('Cambió la selección de destinos. No se envió.');
    if(sale)checkFlow();
    if(sale&&!verifySaleAudience(root,group,baseline.find(value=>value.startsWith('sale:origin:'))?.slice(12)))throw new Error('Cambió el destino de la venta.');
    if(editor&&root.querySelector('[role="switch"][aria-label="Publicar de forma anónima"][aria-checked="true"]'))throw new Error('Cambió el perfil de publicación. No se envió.');
    if (editor && !matchesEditor(editor,content.groupText)) throw new Error('El contenido cambió después de aprobarlo.');
    if(editor&&photoCount!==undefined&&Array.from(root.querySelectorAll('img')).filter(img=>visible(img)&&! /perfil|profile|avatar/i.test(img.alt)&&img.complete&&img.naturalWidth>0).length<Number(photoCount))throw new Error('No están cargadas todas las fotos aprobadas. No se envió.');
    // Facebook can expose a single remove control for a multi-photo attachment set.
    // The prepared preview snapshot above verifies the exact approved photo set.
    const publish = button('Publicar', root);
    if (!enabled(publish)) throw new Error('Facebook no habilitó Publicar.');
    const flow=baseline.find(value=>value.startsWith('flow:'))?.slice(5);
    if(group&&flow){
      checkFlow();
      const record={flow,started:Date.now(),notices:[]};
      const old=new Set(Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map(text));
      const save=()=>document.documentElement.setAttribute('data-rivastock-submit',JSON.stringify(record));
      save();
      // Observe before clicking: a toast may disappear between reconciliation polls.
      const observer=new MutationObserver(()=>{
        for(const node of Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).filter(visible)){
          const message=text(node);
          if(old.has(message)||!/^Tu publicación (se publicó|se creó|está pendiente de aprobación|se envió a los administradores)([.!\s]|$)/i.test(message))continue;
          record.notices.push({message,urls:Array.from(node.querySelectorAll('a[href]')).map(link=>link.href)});
        }
        if(record.notices.length){observer.disconnect();save();}
      });
      observer.observe(document.body,{childList:true,subtree:true,characterData:true});
      setTimeout(()=>observer.disconnect(),30000);
    }
    publish.click(); return { clicked: true };
  }
  throw new Error('Acción no autorizada.');
  } catch(error) { return { error: error.message, code:error.issue?'FORM_VARIANT_UNSUPPORTED':/destino|audiencia/i.test(error.message)?'AUDIENCE_MISMATCH':/coincid|cambi|precio|fotos/i.test(error.message)?'CONTENT_MISMATCH':'FORM_VARIANT_UNSUPPORTED', ...(error.issue?{issue:error.issue}:{}) }; }
}
