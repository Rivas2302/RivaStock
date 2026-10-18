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
  const photoSnapshot=root=>'prepared-photos:'+JSON.stringify(Array.from(root.querySelectorAll('img')).filter(img=>visible(img)&&img.complete&&img.naturalWidth>0&&/foto|vista previa|photo/i.test(img.alt)).map(img=>img.currentSrc||img.src));
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
    const titleKey=normalize(content.title).toLocaleLowerCase('es');
    const cards=Array.from(document.querySelectorAll('button,[role="button"],a[href]')).filter(visible)
      .filter(element=>accessibleName(element).toLocaleLowerCase('es').includes(titleKey)&&/\$\s*[\d.,]+/.test(text(element)));
    const candidates=cards.slice(0,20).map(element=>{
      const links=[element,...element.querySelectorAll('a[href]')].flatMap(link=>{try{const url=new URL(link.href);return url.origin===location.origin&&/^\/marketplace\/item\/\d+\/?$/.test(url.pathname)?[url.origin+url.pathname]:[];}catch{return [];}});
      const raw=element.innerText||text(element);
      return {title:accessibleName(element),summary:raw.slice(0,600),status:raw.slice(raw.search(/\$\s*[\d.,]+/)).replace(/^\$\s*[\d.,]+\s*/,'').match(/^(Vendido|Agotado|Disponible|Activo|En revisión)\b/i)?.[0]??null,url:[...new Set(links)].length===1?links[0]:null};
    });
    // Read each identifiable row's detail, never a title-selected winner.
    // Only its empty thumbnail is safe to open; action buttons are excluded.
    for(const [index,candidate] of candidates.entries()) {
      if(candidate.url)continue;
      if(Array.from(document.querySelectorAll('[role="dialog"]')).some(visible))break;
      let card=cards[index];
      if(!card?.isConnected){const matches=buttons(candidate.title).filter(node=>(node.innerText||text(node)).startsWith(candidate.summary));if(matches.length!==1)continue;card=matches[0];}
      let scope=card.parentElement;let thumbnail=null;
      while(scope&&scope!==document.body) {
        const same=buttons(candidate.title,scope);
        const previews=same.filter(node=>!text(node)&&node.querySelector('img'));
        if(previews.length===1&&same.filter(node=>/\$\s*[\d.,]+/.test(text(node))).length===1){thumbnail=previews[0];break;}
        if(previews.length>1)break;scope=scope.parentElement;
      }
      if(!thumbnail)continue;
      activate(thumbnail);
      let detail=null;
      for(let attempt=0;attempt<12;attempt++) {
        const dialogs=Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible);
        if(dialogs.length===1&&text(dialogs[0]).startsWith('Tu publicación')){detail=dialogs[0];break;}
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      if(!detail)break;
      const urls=[...new Set(Array.from(detail.querySelectorAll('a[href]')).flatMap(link=>{const url=new URL(link.href);return url.origin===location.origin&&/^\/marketplace\/item\/\d+\/?$/.test(url.pathname)?[url.origin+url.pathname]:[];}))];
      if(urls.length===1)candidate.url=urls[0];
      const close=buttons('Cerrar',detail);if(close.length!==1)break;
      activate(close[0]);
      for(let attempt=0;attempt<12&&detail.isConnected&&visible(detail);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(candidates.length)issue('marketplace_conflict','Hay anuncios anteriores que podrían corresponder a este producto. Elegí vincular uno o aprobá explícitamente una publicación nueva.',{candidates});
    if(Array.from(document.querySelectorAll('button,[role="button"],a,span,h2,h3')).some(element=>visible(element)&&accessibleName(element).toLocaleLowerCase('es')===titleKey))issue('marketplace_conflict','Hay coincidencias de título sin información suficiente para identificar el anuncio.',{candidates:[]});
    return {clear:true};
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
    if(previews().length!==photos.length||previews().some(img=>!img.complete||img.naturalWidth===0))throw new Error(`Se esperaban ${photos.length} fotos cargadas; se observaron ${previews().length}. No se envió.`);
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
      const removeButtons = buttons('Eliminar archivo adjunto de la publicación', dialog);
      const images = Array.from(dialog.querySelectorAll('img')).filter(img => visible(img)&&img.complete&&img.naturalWidth>0);
      return enabled(button('Publicar', dialog)) && removeButtons.length === photos.length && images.length >= photos.length;
    },'carga y verificación de todas las fotos del grupo');
    if(dialog.querySelector('[role="checkbox"][aria-checked="true"],input[type="checkbox"]:checked'))throw new Error('El editor seleccionó otros grupos. No se envió.');
    const alerts=Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map(node=>`notice:${text(node)}`);
    const existingPostUrls=Array.from(document.querySelectorAll('a[href]')).flatMap(element=>{try{const url=new URL(element.href);return url.origin===location.origin&&/^\/groups\/[A-Za-z0-9._-]+\/(posts|permalink)\/\d+\/?$/.test(url.pathname)?[url.origin+url.pathname]:[];}catch{return [];}});
    return { ready: true, baseline: [...rememberFlow('group'),photoSnapshot(dialog),...before,...new Set(existingPostUrls),...alerts,`author:${authorId}`,`group:${actual}`,`photos:${photos.length}`,`target:${target}`,...new Set([target,actual].map(path=>'groupseg:'+path.split('/')[2]))] };
  }
  if (action === 'submit') {
    // One final click per tab and flow: a repeated submit never clicks again.
    const submitFlow=baseline.find(value=>value.startsWith('flow:'))?.slice(5);
    const priorSubmit=(()=>{try{return JSON.parse(document.documentElement.getAttribute('data-rivastock-submit'));}catch{return null;}})();
    if(submitFlow&&priorSubmit?.flow===submitFlow&&Date.now()-priorSubmit.started<120000)throw new Error('El envío ya se realizó en esta pestaña. No se repitió.');
    const previousPhotos=baseline.find(value=>value.startsWith('prepared-photos:'));
    const currentPhotos=photoSnapshot(document.querySelector('[role="dialog"]')??document);
    if(previousPhotos&&currentPhotos!=='prepared-photos:[]'&&previousPhotos!==currentPhotos)throw new Error('Cambió el orden o la carga de las fotos después de preparar. No se envió.');
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
      const previews=Array.from(document.querySelectorAll('img')).filter(img=>visible(img)&&/foto|vista previa|photo/i.test(img.alt));
      if(previews.length&& (previews.length!==Number(baseline.find(value=>value.startsWith('photos:'))?.slice(7))||previews.some(img=>!img.complete||!img.naturalWidth)))throw new Error('Cambió la carga de fotos. No se envió.');

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
    const photoCount=baseline.find(value=>value.startsWith('photos:'))?.slice(7);
    if(editor&&photoCount!==undefined&&Array.from(root.querySelectorAll('img')).filter(img=>visible(img)&&! /perfil|profile|avatar/i.test(img.alt)&&img.complete&&img.naturalWidth>0).length<Number(photoCount))throw new Error('No están cargadas todas las fotos aprobadas. No se envió.');
    if(photoCount!==undefined&&buttons('Eliminar archivo adjunto de la publicación',root).length!==Number(photoCount))throw new Error('Las fotos cambiaron después de preparar la publicación. No se envió.');
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
  if (action === 'result') {
    const noticeKey=node=>'notice:'+text(node);
    const marketplaceItemUrl=href=>{try{const url=new URL(href);return url.origin===location.origin&&/^\/marketplace\/item\/\d+\/?$/.test(url.pathname)?url.origin+url.pathname:null;}catch{return null;}};
    const groupPostUrl=href=>{try{const url=new URL(href);return url.origin===location.origin&&/^\/groups\/[A-Za-z0-9._-]+\/(posts|permalink)\/\d+\/?$/.test(url.pathname)?url.origin+url.pathname:null;}catch{return null;}};
    if (content.selection?.marketplace && location.pathname.startsWith('/marketplace')) {
      if(location.hostname!=='www.facebook.com')return {waiting:true};
      const currentItemUrl=location.origin+location.pathname;
      // A navigation counts only after this recorded click and onto the approved listing.
      const clickReceipt=(()=>{try{const value=JSON.parse(document.documentElement.getAttribute('data-rivastock-submit'));return value&&baseline.includes('flow:'+value.flow)&&Date.now()-value.started<120000;}catch{return false;}})();
      const approvedTitle=normalize(content.title).toLowerCase();
      const showsApprovedTitle=normalize(document.title).toLowerCase().includes(approvedTitle)||Array.from(document.querySelectorAll('h1')).filter(visible).some(heading=>normalize(text(heading)).toLowerCase().includes(approvedTitle));
      if(/^\/marketplace\/item\/\d+\/?$/.test(location.pathname)&&!baseline.includes(currentItemUrl)&&clickReceipt&&approvedTitle&&showsApprovedTitle)return {status:'submitted',url:currentItemUrl,message:'Facebook abrió el anuncio después del envío. Aprobación pública sin verificar.'};
      if(buttons('Cerrar cuadro de diálogo de promoción de publicación').length===1){button('Cerrar cuadro de diálogo de promoción de publicación').click();return {waiting:true};}
      const causalPhrase=/Tu publicación (se publicó|se creó|está en revisión)/i;
      for(const notice of Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).filter(visible)){
        const key=noticeKey(notice); if(baseline.includes(key))continue;
        if(!causalPhrase.test(text(notice)))continue;
        const links=[...new Set(Array.from(notice.querySelectorAll('a[href]')).map(link=>marketplaceItemUrl(link.href)).filter(Boolean))];
        if(links.length===1&&!baseline.includes(links[0])){
          const status=/está en revisión/i.test(text(notice))?'pending_approval':'submitted';
          return {status,url:links[0],message:'Facebook mostró un aviso nuevo con el enlace de este envío.'};
        }
      }
      return {waiting:true,diag:{page:'marketplace',post:/^\/marketplace\/item\/\d+/.test(location.pathname),composer:false,notices:Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).filter(visible).filter(node=>!baseline.includes(noticeKey(node))).length,receipt:!!clickReceipt}};
    }
    const group=baseline.find(value=>value.startsWith('group:'))?.slice(6);
    if(!group)return {waiting:true};
    // Dismiss "Publicación realizada" cross-post suggestions dialog: it blocks the feed
    // during polling and prevents URL capture from notices or the feed.
    const crossPostHeading=Array.from(document.querySelectorAll('[role="dialog"] h2,[role="dialog"] [role="heading"]')).find(h=>visible(h)&&/publicación realizada/i.test(text(h)));
    if(crossPostHeading){const dialog=crossPostHeading.closest('[role="dialog"]');const closeBtns=dialog?[...dialog.querySelectorAll('button,[role="button"]')].filter(b=>accessibleName(b).trim()==='Cerrar'):[];if(closeBtns.length===1)closeBtns[0].click();return {waiting:true};}
    const currentPost=groupPostUrl(location.href);
    // Only the approved group and the page Facebook redirected it to are trusted
    // aliases; any other group is never evidence, and accepted URLs are rewritten
    // to the approved segment that the server validates.
    const aliasSegs=new Set(baseline.filter(v=>v.startsWith('groupseg:')).map(v=>v.slice(9)));
    if(!aliasSegs.size)aliasSegs.add(group.split('/')[2]); // journals created before 0.5.7
    const targetSeg=(baseline.find(v=>v.startsWith('target:'))?.slice(7)??group).split('/')[2];
    const segOf=href=>new URL(href).pathname.split('/')[2];
    const sameGroup=href=>aliasSegs.has(segOf(href));
    const toTargetGroup=href=>{const u=new URL(href);const p=u.pathname.split('/');p[2]=targetSeg;return u.origin+p.join('/');};
    const onAliasPage=/^\/groups\/[A-Za-z0-9._-]+(\/(posts|permalink)\/\d+)?\/?$/.test(location.pathname)&&aliasSegs.has(location.pathname.split('/')[2]);
    if(!onAliasPage)return {error:'Cambió la página del grupo. Resultado desconocido.'};
    let receipt=null;
    try{const value=JSON.parse(document.documentElement.getAttribute('data-rivastock-submit'));if(value&&baseline.includes('flow:'+value.flow)&&Date.now()-value.started<120000)receipt=value;}catch{}
    const postIdOf=href=>href.match(/\/(?:posts|permalink)\/(\d+)\/?$/)?.[1];
    // Detect "en revisión": only a post opened after this recorded click, and absent before it, counts.
    if(currentPost&&receipt&&sameGroup(currentPost)&&!baseline.includes(currentPost)&&!baseline.some(value=>postIdOf(value)===postIdOf(currentPost))){
      const reviewHeading=Array.from(document.querySelectorAll('[role="dialog"] h2,[role="dialog"] [role="heading"]')).find(h=>visible(h)&&/esta publicación está en revisión/i.test(text(h)));
      if(reviewHeading)return {status:'pending_approval',url:toTargetGroup(currentPost),message:'Facebook indicó que esta publicación está en revisión. Se publicará cuando un administrador la apruebe.'};
    }
    const allNotices=Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).filter(visible);
    const newNotices=allNotices.filter(node=>!baseline.includes(noticeKey(node)));
    for(const saved of receipt?.notices??[]){
      const node=document.createElement('div');node.textContent=saved.message;
      for(const href of saved.urls){const link=document.createElement('a');link.href=href;node.append(link);}
      if(!baseline.includes(noticeKey(node)))newNotices.push(node);
    }
    const composerOpen=()=>!!document.querySelector('[aria-label="Crea una publicación pública..."][contenteditable="true"],[role="textbox"][aria-label="Escribe algo..."][contenteditable="true"]');
    const pendingNotice=newNotices.find(node=>/^Tu publicación (está pendiente de aprobación|se envió a los administradores)([.!\s]|$)/.test(text(node)));
    if(pendingNotice&&!document.querySelector('[aria-label="Crea una publicación pública..."][contenteditable="true"],[role="textbox"][aria-label="Escribe algo..."][contenteditable="true"]'))return {status:'pending_approval',url:null,message:'Facebook indicó explícitamente que este envío espera aprobación de los administradores.'};
    // A sale composer never stores an authorId; do not fabricate success.
    if(baseline.includes('sale:approved'))return {waiting:true};
    const authorId=baseline.find(value=>value.startsWith('author:'))?.slice(7);
    const expectedPhotos=baseline.find(value=>value.startsWith('photos:'))?.slice(7);
    // A same-tab post navigation is accepted only for this recorded final click.
    if(currentPost&&receipt&&!composerOpen()){
      const node=document.createElement('div');node.textContent='Tu publicación se publicó';
      const link=document.createElement('a');link.href=currentPost;node.append(link);newNotices.push(node);
    }
    for(const notice of newNotices){
      const links=[...new Set(Array.from(notice.querySelectorAll('a[href]')).map(link=>groupPostUrl(link.href)).filter(Boolean))];
      if(links.length!==1||!/^Tu publicación (se publicó|se creó)/i.test(text(notice)))continue;
      const url=links[0];
      if(baseline.includes(url)||!sameGroup(url))continue;
      const postMatch=url.match(/\/(posts|permalink)\/(\d+)\/?$/); if(!postMatch)continue;
      const postId=postMatch[2];
      if(baseline.includes(postId)||baseline.some(value=>value.match(/\/(?:posts|permalink)\/(\d+)\/?$/)?.[1]===postId))continue;
      const photoLinks=Array.from(document.querySelectorAll('a[href]')).filter(visible).filter(element=>{try{const set=new URL(element.href).searchParams.get('set');return set?.endsWith('.'+postId);}catch{return false;}});
      if(!photoLinks.length)continue;
      let postScope=photoLinks[0].parentElement;
      // Observed Facebook posts use ordinary divs, not article/section elements.
      while(postScope&&postScope!==document.body){
        if(buttons('Acciones en esta publicación de ',postScope,true).length>1){postScope=null;break;}
        if(Array.from(postScope.querySelectorAll('a[href]')).some(link=>{try{return new URL(link.href).pathname.endsWith(`/user/${authorId}/`);}catch{return false;}})&&normalize(postScope.innerText).includes(normalize(content.groupText)))break;
        postScope=postScope.parentElement;
      }
      if(postScope===document.body)continue;
      if(!postScope||!visible(postScope))continue;
      const authorLink=Array.from(postScope.querySelectorAll('a[href]')).find(link=>{try{return new URL(link.href).pathname.endsWith(`/user/${authorId}/`);}catch{return false;}});
      if(!authorId||!authorLink)continue;
      if(buttons('Ver más',postScope).length===1){button('Ver más',postScope).click();continue;}
      if(!normalize(postScope.innerText).includes(normalize(content.groupText)))continue;
      if(expectedPhotos!==undefined){
        const postPhotos=new Set(Array.from(postScope.querySelectorAll('a[href]')).filter(visible).flatMap(link=>{try{const url=new URL(link.href);return url.searchParams.get('set')?.endsWith('.'+postId)?[url.searchParams.get('fbid')??url.origin+url.pathname]:[];}catch{return [];}})).size;
        if(postPhotos!==Number(expectedPhotos))continue;
      }
      const normalizedUrl=toTargetGroup(url);
      return {status:currentPost?'submitted':'published',url:normalizedUrl,message:'Publicación visible en el grupo con autor, texto y fotos verificados.'};
    }
    // Explicit new acknowledgement establishes receipt, even without a permalink.
    if(!composerOpen()&&newNotices.some(node=>/^Tu publicación (se publicó|se creó)([.!\s]|$)/i.test(text(node))&&!node.querySelector('a[href]')))return {status:'submitted',url:null,message:'Facebook confirmó la recepción del envío. Visibilidad pública sin verificar.'};
    // Only booleans and counts: never page text, names or URLs.
    return {waiting:true,diag:{page:onAliasPage?'alias':'other',post:!!currentPost,composer:composerOpen(),notices:newNotices.length,receipt:!!receipt}};
  }
  if(action==='result_search'){
    const gPostUrl=href=>{try{const u=new URL(href);return u.origin===location.origin&&/^\/groups\/[A-Za-z0-9._-]+\/(posts|permalink)\/\d+\/?$/.test(u.pathname)?u.origin+u.pathname:null;}catch{return null;}};
    const authorId=baseline.find(v=>v.startsWith('author:'))?.slice(7);
    const group=baseline.find(v=>v.startsWith('group:'))?.slice(6);
    const currentGroupPath=location.pathname.replace(/\/$/,'');
    const aliasSegs=new Set(baseline.filter(v=>v.startsWith('groupseg:')).map(v=>v.slice(9)));
    if(group&&!aliasSegs.size)aliasSegs.add(group.split('/')[2]); // journals created before 0.5.7
    if(!authorId||!group||!/^\/groups\/[A-Za-z0-9._-]+$/.test(currentGroupPath)||!aliasSegs.has(currentGroupPath.split('/')[2]))return {notFound:true};
    const targetSeg=(baseline.find(v=>v.startsWith('target:'))?.slice(7)??group).split('/')[2];
    const segOf=href=>new URL(href).pathname.split('/')[2];
    const firstLine=normalize((content.groupText||'').split('\n').filter(l=>l.trim())[0]||'');
    const candidates=new Set();
    for(const section of Array.from(document.querySelectorAll('article,section,[role="article"]')).filter(visible)){
      const authorLink=Array.from(section.querySelectorAll('a[href]')).find(link=>{try{return new URL(link.href).pathname.endsWith(`/user/${authorId}/`);}catch{return false;}});
      if(!authorLink)continue;
      const sectionUrls=[...new Set(Array.from(section.querySelectorAll('a[href]')).map(link=>gPostUrl(link.href)).filter(u=>u&&!baseline.includes(u)&&aliasSegs.has(segOf(u))))];
      if(sectionUrls.length!==1)continue;
      if(firstLine&&!text(section).includes(firstLine))continue;
      candidates.add(sectionUrls[0]);
    }
    if(candidates.size===1){
      const url=[...candidates][0];
      const u=new URL(url);const segs=u.pathname.split('/');segs[2]=targetSeg;
      return {candidateUrl:u.origin+segs.join('/')};
    }
    return {notFound:true};
  }
  throw new Error('Acción no autorizada.');
  } catch(error) { return { error: error.message, code:error.issue?'FORM_VARIANT_UNSUPPORTED':/destino|audiencia/i.test(error.message)?'AUDIENCE_MISMATCH':/coincid|cambi|precio|fotos/i.test(error.message)?'CONTENT_MISMATCH':'FORM_VARIANT_UNSUPPORTED', ...(error.issue?{issue:error.issue}:{}) }; }
}
