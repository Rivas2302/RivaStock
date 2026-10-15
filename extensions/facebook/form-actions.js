// Runs in Chrome's isolated content-script world. Only observed Spanish UI
// controls are used; no Facebook credentials, cookies or private endpoints.
export async function facebookFormAction(action, content, photos = [], baseline = []) {
  try {
  const normalize = value => (value ?? '').replace(/\s+/g, ' ').trim();
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
    if (/restring|bloque|no puedes publicar|verifica|verificaci[oó]n/i.test(alerts)) throw new Error('Facebook mostró una restricción o verificación. Revisá la pestaña.');
  };
  safety();
  if(action==='diagnose') {
    return {
      path:location.pathname,
      categories:Array.from(document.querySelectorAll('button,[role="button"],[role="option"],[role="menuitem"]')).filter(visible).map(accessibleName).filter(name=>name.includes('Envío disponible')||name==='Salud y belleza'),
      combos:Array.from(document.querySelectorAll('label[role="combobox"]')).filter(visible).map(element=>({label:accessibleName(element),display:text(element),expanded:element.getAttribute('aria-expanded')})),
      descriptionCount:Array.from(document.querySelectorAll('textarea')).filter(element=>visible(element)&&element.closest('label')?.textContent.includes('Descripción')).length,
      photoInputs:Array.from(document.querySelectorAll('input[type="file"]')).map(element=>({accept:element.getAttribute('accept'),multiple:element.multiple,count:element.files.length})),
      next:buttons('Siguiente').map(element=>({enabled:enabled(element)})),
      publish:buttons('Publicar').map(element=>({enabled:enabled(element)})),
    };
  }
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
    if (location.pathname.replace(/\/$/,'') !== '/marketplace/you/selling') throw new Error('No se abrió la lista de publicaciones de Marketplace.');
    // The navigation item and list heading can both say "Tus publicaciones".
    // Wait for the actual list search control, independent of navigation role.
    const searches=()=>Array.from(document.querySelectorAll('input')).filter(visible).filter(element => element.getAttribute('placeholder')==='Buscar en tus publicaciones' || element.getAttribute('aria-label')==='Buscar en tus publicaciones');
    await wait(() => searches().length>0);
    const search=one(searches());
    setValue(search,content.title);
    // Observe a stable filtered UI, including any loading indicators, before
    // deciding that no matching listing is visible. Existing titles require
    // human review instead of publishing another possibly duplicated listing.
    let last=''; let stable=0;
    for(let attempt=0;attempt<40;attempt++) {
      const current=normalize(document.body.innerText);
      stable=current===last?stable+1:0; last=current;
      if(stable>=4&&!Array.from(document.querySelectorAll('[role="progressbar"]')).some(visible))break;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(stable<4)throw new Error('No se pudo verificar la lista de anuncios existentes. No se envió.');
    if(Array.from(document.querySelectorAll('button,[role="button"],a,span,h2,h3')).some(element=>visible(element)&&accessibleName(element)===normalize(content.title))) {
      const matches=buttons(content.title);
      const thumbnails=matches.filter(element=>!text(element));
      const cards=matches.filter(element=>text(element).includes(content.title)&&/\$\s*[\d.,]+/.test(text(element)));
      const candidates=thumbnails.length?thumbnails:cards;
      if(candidates.length!==1)throw new Error('Ya hay anuncios con este título. Revisá Facebook: no se creó otro ni se pudo identificar un enlace único.');
      activate(candidates[0]);
      const links=()=>Array.from(document.querySelectorAll('a[href]')).filter(element=>text(element).includes(content.title)&&/^\/marketplace\/item\/\d+\/?$/.test(new URL(element.href).pathname));
      await wait(()=>links().length>0,'consultar el enlace del anuncio que ya existe');
      const urls=[...new Set(links().map(element=>new URL(element.href).origin+new URL(element.href).pathname))];
      if(urls.length!==1)throw new Error('Hay varios anuncios con este título. No se creó otro.');
      return {existing:true,url:urls[0]};
    }
    return {clear:true};
  }
  if (action === 'marketplace_prepare') {
    if (location.pathname !== '/marketplace/create/item' || location.search) throw new Error('No se abrió un formulario nuevo de Marketplace.');
    await wait(() => buttons('Guardar borrador').length);
    const title = field('Título', 'input[type="text"]'); const price = field('Precio', 'input[type="text"]');
    if (title.value || price.value) throw new Error('Hay un borrador existente. No se sobrescribió.');
    setValue(title, content.title); setValue(price, String(content.price));
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
    if(title.value!==content.title||normalize(description.value)!==normalize(content.description)||normalize(place.value).toLowerCase()!==normalize(content.location).toLowerCase()) throw new Error('Los valores del formulario no coinciden con el contenido aprobado. No se envió.');
    progress('Verificando destinos antes de publicar');
    button('Siguiente').click();
    await wait(() => /Publicar en más lugares/.test(document.body.innerText) && buttons('Publicar').length === 1,'abrir el paso final de Marketplace');
    if (document.querySelector('[role="checkbox"][aria-checked="true"],input[type="checkbox"]:checked')) throw new Error('Facebook seleccionó destinos adicionales. No se envió.');
    return { ready: true, baseline: [] };
  }
  if (action === 'group_prepare') {
    const target=content.targetGroupUrl?new URL(content.targetGroupUrl).pathname.replace(/\/$/,''):location.pathname.replace(/\/$/,'');
    const actual=location.pathname.replace(/\/$/,'');
    const canonical=path=>path.replace('/PicoVendedeTodo','/710102875717376');
    if(!/^\/groups\/[A-Za-z0-9._-]+$/.test(actual)||canonical(target)!==canonical(actual))throw new Error('El grupo abierto no corresponde a la URL aprobada. No se envió.');
    if(document.querySelector('[role="dialog"] [contenteditable="true"]'))throw new Error('Hay un borrador abierto en el grupo. No se sobrescribió.');
    const before = [...new Set(photoIds())];
    await wait(() => buttons('Escribe algo...').length === 1,'grupo sin editor de texto y fotos compatible o sin permiso para publicar');
    if(normalize(document.body.innerText).includes(normalize(content.groupText)))throw new Error('El grupo ya muestra el contenido aprobado. Verificá el post antes de publicar otro.');
    let authorId=null;
    let authorScope=button('Escribe algo...');
    while(authorScope&&authorScope!==document.body) {
      const authors=Array.from(authorScope.querySelectorAll('a[href]')).map(element => new URL(element.href).pathname.match(/^\/groups\/[^/]+\/user\/([0-9]+)\/?$/)?.[1]).filter(Boolean);
      if(authors.length===1){authorId=authors[0];break;}
      if(authors.length>1)break;
      authorScope=authorScope.parentElement;
    }
    if(!authorId)throw new Error('No se pudo verificar el perfil que publica en el grupo.');
    button('Escribe algo...').click();
    const editor = await wait(() => document.querySelector('[contenteditable="true"][role="textbox"][aria-label="Crea una publicación pública..."]'));
    const dialog = editor.closest('[role="dialog"]');
    if (!dialog || text(editor)) throw new Error('El editor del grupo contiene un borrador. No se sobrescribió.');
    const anonymous = dialog.querySelector('[role="switch"][aria-label="Publicar de forma anónima"]');
    if (anonymous?.getAttribute('aria-checked') === 'true') throw new Error('El editor está en modo anónimo. No se envió.');
    // Insert text through the browser editing command so Facebook's editor
    // receives its normal input event instead of replacing its internal DOM.
    editor.focus(); document.execCommand('insertText', false, content.groupText);
    if (normalize(editor.innerText) !== normalize(content.groupText)) throw new Error('El texto del editor no coincide con el aprobado.');
    const inputs = Array.from(dialog.querySelectorAll('input[type="file"][multiple]')).filter(element => (element.getAttribute('accept') ?? '').split(',').includes('image/*'));
    // Observed composer has equivalent image inputs. Upload exactly once using
    // the input closest to Foto/video; refuse ties instead of guessing.
    const photoButton = button('Foto/video', dialog);
    let scope = photoButton;
    while (scope !== dialog && !scope.querySelector('input[type="file"][multiple]')) scope = scope.parentElement;
    const associated = inputs.filter(input => scope.contains(input));
    attach(one(associated));
    await wait(() => enabled(button('Publicar', dialog)) && dialog.querySelector('img') && buttons('Eliminar archivo adjunto de la publicación', dialog).length === photos.length,'carga y verificación de todas las fotos del grupo');
    if(dialog.querySelector('[role="checkbox"][aria-checked="true"],input[type="checkbox"]:checked'))throw new Error('El editor seleccionó otros grupos. No se envió.');
    const alerts=Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map(node=>`notice:${text(node)}`);
    return { ready: true, baseline: [...before,...alerts,`author:${authorId}`,`group:${actual}`] };
  }
  if (action === 'submit') {
    // The worker must obtain an atomic database checkpoint before calling this
    // action. This function never retries the final click.
    const editor = document.querySelector('[aria-label="Crea una publicación pública..."][contenteditable="true"]');
    const group=baseline.find(value=>value.startsWith('group:'))?.slice(6);
    if(group&&(!editor||location.pathname.replace(/\/$/,'')!==group))throw new Error('Cambió el editor o el grupo antes de enviar. No se envió.');
    const root = editor?.closest('[role="dialog"]') ?? document;
    if (editor && normalize(editor.innerText) !== normalize(content.groupText)) throw new Error('El contenido cambió después de aprobarlo.');
    const publish = button('Publicar', root);
    if (!enabled(publish)) throw new Error('Facebook no habilitó Publicar.');
    publish.click(); return { clicked: true };
  }
  if (action === 'result') {
    if (content.selection?.marketplace && location.pathname.startsWith('/marketplace')) {
      if (buttons('Cerrar cuadro de diálogo de promoción de publicación').length === 1) { button('Cerrar cuadro de diálogo de promoción de publicación').click(); return { waiting: true }; }
      const links = Array.from(document.querySelectorAll('a[href]')).filter(element => text(element).includes(content.title) && /^\/marketplace\/item\/\d+\/?$/.test(new URL(element.href).pathname));
      const urls=[...new Set(links.map(element=>new URL(element.href).origin+new URL(element.href).pathname))];
      if (urls.length === 1) return { status: /Esta publicación está en revisión/.test(document.body.innerText) ? 'pending_approval' : 'submitted', url: urls[0], message: 'Anuncio creado. La aprobación pública se registra solo con evidencia explícita.' };
      if(urls.length>1)throw new Error('Hay varios anuncios con el mismo título. Revisá el resultado; no se repetirá el envío.');
      // Read the opened detail before clicking again: list cards remain in the
      // DOM behind a dialog. Facebook has a separate, empty thumbnail button
      // and a text card with the same accessible name; the thumbnail opens
      // the "Tu publicación" detail containing the public item link.
      if(Array.from(document.querySelectorAll('[role="dialog"]')).some(visible))return {waiting:true};
      const exact=buttons(content.title);
      const thumbnails=exact.filter(element=>!text(element));
      const cards=exact.filter(element=>text(element).includes(content.title)&&/\$\s*[\d.,]+/.test(text(element)));
      const candidates=thumbnails.length?thumbnails:cards;
      if(candidates.length>1)throw new Error('Hay varios anuncios con el mismo título. Revisá Facebook.');
      if(candidates.length===1) {activate(candidates[0]);return {waiting:true};}
    } else {
      const group=baseline.find(value=>value.startsWith('group:'))?.slice(6);
      if(group&&location.pathname.replace(/\/$/,'')!==group)throw new Error('Cambió la página del grupo. Resultado desconocido.');
      const pending=Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).filter(visible).map(text).filter(value=>!baseline.includes(`notice:${value}`));
      if(group&&!document.querySelector('[aria-label="Crea una publicación pública..."][contenteditable="true"]')&&pending.some(value=>/^Tu publicación (está pendiente de aprobación|se envió a los administradores)([.!\s]|$)/.test(value)))return {status:'pending_approval',url:null,message:'Facebook indicó explícitamente que este envío espera aprobación de los administradores.'};
      const candidates = Array.from(document.querySelectorAll('a[href]')).filter(element => {
        try { const value = new URL(element.href).searchParams.get('set'); return value?.startsWith('gm.') && !baseline.includes(value.slice(3)); } catch { return false; }
      }).filter(element => {
        let ancestor = element;
        while (ancestor && ancestor !== document.body) {
          const menus=ancestor.querySelectorAll('[aria-label^="Acciones en esta publicación de"]');
          const authorId=baseline.find(value=>value.startsWith('author:'))?.slice(7);
          const matchesAuthor=authorId&&Array.from(ancestor.querySelectorAll('a[href]')).some(link=>new URL(link.href).pathname.endsWith(`/user/${authorId}/`));
          if (menus.length === 1 && matchesAuthor && text(ancestor).includes(content.title)) {
            if (buttons('Ver más',ancestor).length===1) { button('Ver más',ancestor).click(); return false; }
            if (text(ancestor).includes(normalize(content.groupText))) return true;
          }
          ancestor = ancestor.parentElement;
        }
        return false;
      });
      const ids = [...new Set(candidates.map(element => new URL(element.href).searchParams.get('set').slice(3)))];
      if (ids.length === 1) return { status: 'published', url: `${location.origin}${location.pathname.replace(/\/$/, '')}/posts/${ids[0]}`, message: 'Publicación directa visible en el grupo con el contenido aprobado.' };
    }
    return { waiting: true };
  }
  throw new Error('Acción no autorizada.');
  } catch(error) { return { error: error.message }; }
}
