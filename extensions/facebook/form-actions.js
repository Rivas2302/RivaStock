// Runs in Chrome's isolated content-script world. Only observed Spanish UI
// controls are used; no Facebook credentials, cookies or private endpoints.
export function domSummary(root = null) {
  const hiddenFromTrace = '[role="feed"], [data-pagelet*="Feed"], [data-pagelet*="message" i], [aria-label*="Messenger" i], [aria-label*="mensajes" i]';
  const visibleForTrace = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const traceSafe = element => !element.closest(hiddenFromTrace);
  const traceName = element => {
    const direct = element.getAttribute('aria-label');
    if (direct) return direct;
    const labelledBy = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)).filter(node => node && traceSafe(node)).map(node => node.textContent.trim()).filter(Boolean);
    if (labelledBy.length) return labelledBy.join(' ');
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
      const label = element.labels ? Array.from(element.labels).filter(traceSafe).map(node => node.textContent.trim()).join(' ') : '';
      return label || element.getAttribute('placeholder') || element.getAttribute('name') || '';
    }
    if (element.isContentEditable) return '';
    return element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  };
  const activeDialog = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visibleForTrace).at(-1);
  const activeForm = Array.from(document.querySelectorAll('form')).filter(form => visibleForTrace(form)
    && form.querySelector('button,[role="button"],input,textarea,select,[contenteditable="true"]')).at(-1);
  const requestedRoot = root?.nodeType === 1 ? root : null;
  const scope = requestedRoot ?? activeDialog ?? activeForm ?? document.querySelector('main') ?? document.body;
  const scopeType = scope.closest?.('[role="dialog"]') || scope.matches?.('[role="dialog"]') || scope === activeDialog
    ? 'dialog' : scope.closest?.('form') || scope.matches?.('form') || scope === activeForm ? 'form' : 'page';
  const headings = Array.from(scope.querySelectorAll('h1,h2,h3,[role="heading"]'))
    .filter(node => visibleForTrace(node) && traceSafe(node))
    .map(node => node.textContent.replace(/\s+/g, ' ').trim().slice(0, 120))
    .filter(Boolean).slice(0, 30);
  const controls = Array.from(scope.querySelectorAll('button,[role="button"],[role="checkbox"],[role="switch"],[role="combobox"],a[href],input,textarea,select,[contenteditable="true"]'))
    .filter(node => visibleForTrace(node) && traceSafe(node))
    .filter(node => !(node.tagName === 'INPUT' && node.type === 'password'))
    .slice(0, 80)
    .map((node, index) => {
      const rect = node.getBoundingClientRect();
      const headingPath = Array.from(scope.querySelectorAll('h1,h2,h3,[role="heading"]'))
        .filter(heading => traceSafe(heading) && (heading.compareDocumentPosition(node) & 4))
        .slice(-3).map(heading => heading.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean);
      return {
        index,
        role: node.getAttribute('role') || (node.tagName === 'A' ? 'link' : node.isContentEditable ? 'textbox' : node.tagName.toLowerCase()),
        name: traceName(node).replace(/\s+/g, ' ').trim().slice(0, 80),
        text: node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)
          ? '' : (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
        ...(node instanceof HTMLInputElement ? { type: node.type } : {}),
        ...(['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) && node.getAttribute('placeholder') ? { placeholder: node.getAttribute('placeholder').slice(0, 80) } : {}),
        state: {
          ...(node.hasAttribute('aria-checked') ? { checked: node.getAttribute('aria-checked') } : {}),
          ...(node.hasAttribute('aria-expanded') ? { expanded: node.getAttribute('aria-expanded') } : {}),
          disabled: node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true',
        },
        box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        headingPath,
      };
    });
  const alerts = Array.from(scope.querySelectorAll('[role="alert"],[role="status"]'))
    .filter(node => visibleForTrace(node) && traceSafe(node))
    .map(node => node.textContent.replace(/\s+/g, ' ').trim().slice(0, 120))
    .filter(Boolean).slice(0, 20);
  return { scope: scopeType, controls, headings, alerts };
}

export function validateSupervisorDecision(value, dom, intent = {}) {
  const actions = ['click', 'type', 'select_option', 'scroll_container', 'wait', 'reload', 'skip_destination', 'abort'];
  const elementActions = ['click', 'type', 'select_option', 'scroll_container'];
  const blocked = /\b(?:publicar(?: ahora)?|compartir ahora|publish(?: now)?|share now|send now|enviar ahora|cerrar sesi[oó]n|log\s*out|sign\s*out|settings|configuraci[oó]n|account settings)\b/i;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['action', 'element_index', 'text', 'wait_ms', 'confidence', 'observation', 'reason'].includes(key))) return false;
  const decision = value;
  if (!actions.includes(decision.action) || !Number.isFinite(decision.confidence) || decision.confidence < 0.6 || decision.confidence > 1
    || typeof decision.observation !== 'string' || !decision.observation.trim() || decision.observation.length > 300
    || typeof decision.reason !== 'string' || !decision.reason.trim() || decision.reason.length > 300) return false;
  if (elementActions.includes(decision.action)) {
    if (!Number.isInteger(decision.element_index) || decision.element_index < 0 || decision.element_index > 79
      || !['dialog', 'form'].includes(dom?.scope) || !Array.isArray(dom?.controls)) return false;
    const control = dom.controls.find(candidate => candidate.index === decision.element_index);
    if (!control || control.state?.disabled === true || blocked.test(`${control.name} ${control.text ?? ''}`)) return false;
    if (decision.action === 'click' && /^(?:submit|formsubmit)$/i.test(control.role)) return false;
    if (decision.action === 'type' || decision.action === 'select_option') {
      const target = intent?.target;
      if (!target || target.element_index !== control.index || target.role !== control.role || target.name !== control.name || !String(target.name ?? '').trim()
        || typeof decision.text !== 'string' || decision.text.length > 200) return false;
      if (decision.action === 'type' && !['input', 'textarea', 'textbox'].includes(control.role)) return false;
      if (decision.action === 'select_option' && !['select', 'combobox'].includes(control.role)) return false;
    } else if ('text' in decision) return false;
  } else if ('element_index' in decision || 'text' in decision) return false;
  if (decision.action === 'wait') {
    if (!Number.isInteger(decision.wait_ms) || decision.wait_ms < 500 || decision.wait_ms > 10000) return false;
  } else if ('wait_ms' in decision) return false;
  return true;
}

export async function facebookFormAction(action, content, photos = [], baseline = []) {
  // Older attempts may contain null where an optional file snapshot was absent.
  baseline = Array.isArray(baseline) ? baseline.filter(value => typeof value === 'string') : [];
  // executeScript serializes this function body, so helpers used in the injected
  // page must be declared inside it instead of closing over module bindings.
  const summarizeDom = (root = null) => {
    const hidden = '[role="feed"], [data-pagelet*="Feed"], [data-pagelet*="message" i], [aria-label*="Messenger" i], [aria-label*="mensajes" i]';
    const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    const safe = element => !element.closest(hidden);
    const nameOf = element => {
      const direct = element.getAttribute('aria-label');
      if (direct) return direct;
      const labels = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
        .map(id => document.getElementById(id)).filter(node => node && safe(node)).map(node => node.textContent.trim()).filter(Boolean);
      if (labels.length) return labels.join(' ');
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
        const label = element.labels ? Array.from(element.labels).filter(safe).map(node => node.textContent.trim()).join(' ') : '';
        return label || element.getAttribute('placeholder') || element.getAttribute('name') || '';
      }
      return element.isContentEditable ? '' : element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    };
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).at(-1);
    const form = Array.from(document.querySelectorAll('form')).filter(candidate => visible(candidate)
      && candidate.querySelector('button,[role="button"],input,textarea,select,[contenteditable="true"]')).at(-1);
    const requested = root?.nodeType === 1 ? root : null;
    const scope = requested ?? dialog ?? form ?? document.querySelector('main') ?? document.body;
    const scopeType = scope.closest?.('[role="dialog"]') || scope.matches?.('[role="dialog"]') || scope === dialog
      ? 'dialog' : scope.closest?.('form') || scope.matches?.('form') || scope === form ? 'form' : 'page';
    const headings = Array.from(scope.querySelectorAll('h1,h2,h3,[role="heading"]')).filter(node => visible(node) && safe(node))
      .map(node => node.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 30);
    const controls = Array.from(scope.querySelectorAll('button,[role="button"],[role="checkbox"],[role="switch"],[role="combobox"],a[href],input,textarea,select,[contenteditable="true"]'))
      .filter(node => visible(node) && safe(node)).filter(node => !(node.tagName === 'INPUT' && node.type === 'password')).slice(0, 80)
      .map((node, index) => {
        const rect = node.getBoundingClientRect();
        const headingPath = Array.from(scope.querySelectorAll('h1,h2,h3,[role="heading"]'))
          .filter(heading => safe(heading) && (heading.compareDocumentPosition(node) & 4))
          .slice(-3).map(heading => heading.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean);
        return {
          index,
          role: node.getAttribute('role') || (node.tagName === 'A' ? 'link' : node.isContentEditable ? 'textbox' : node.tagName.toLowerCase()),
          name: nameOf(node).replace(/\s+/g, ' ').trim().slice(0, 80),
          text: node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) ? '' : (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
          ...(node.tagName === 'INPUT' ? { type: node.type } : {}),
          ...(['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) && node.getAttribute('placeholder') ? { placeholder: node.getAttribute('placeholder').slice(0, 80) } : {}),
          state: { ...(node.hasAttribute('aria-checked') ? { checked: node.getAttribute('aria-checked') } : {}), ...(node.hasAttribute('aria-expanded') ? { expanded: node.getAttribute('aria-expanded') } : {}), disabled: node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true' },
          box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          headingPath,
        };
      });
    const alerts = Array.from(scope.querySelectorAll('[role="alert"],[role="status"]')).filter(node => visible(node) && safe(node))
      .map(node => node.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 20);
    return { scope: scopeType, controls, headings, alerts };
  };
  let activeSupervisionStep = null;
  let usedLearnedHint = null;
  const reportTraceStep = async (name, status = 'ok', capture = true, requestedRoot = null, suppliedSummary = null) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    const domSummary = suppliedSummary ?? summarizeDom(requestedRoot);
    return await chrome.runtime.sendMessage({ type: 'trace-step', step: name, status, capture, domSummary }).catch(() => null);
  };
  const normalize = value => (value ?? '').replace(/\s+/g, ' ').trim();
  const lines = value => (value ?? '').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ');
  const locationParts=value=>normalize(value).replace(/\s*Ciudad$/i,'').split(',').map(part=>part.trim().toLocaleLowerCase('es'));
  const sameMarketplaceLocation=(value,approved)=>{
    const [city,...region]=locationParts(value),[approvedCity,...approvedRegion]=locationParts(approved);
    return Boolean(city&&city===approvedCity&&(!region.length||!approvedRegion.length||region.join(',')===approvedRegion.join(',')));
  };
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
  const photoPreviews=root=>Array.from(root.querySelectorAll('img')).filter(img=>visible(img)&&img.complete&&img.naturalWidth>0&&/^(?:foto|photo)\b|^rivastock-\d+\./i.test(img.alt));
  const photoSnapshot=(root,expectedCount)=>{
    const images=photoPreviews(root);
    if(Number.isSafeInteger(expectedCount)&&images.length===expectedCount)images.forEach((image,index)=>image.dataset.rivastockPhotoOrder=String(index+1));
    return 'prepared-photos:'+JSON.stringify(images.map(image=>image.dataset.rivastockPhotoOrder?`order:${image.dataset.rivastockPhotoOrder}`:/^rivastock-\d+\.(?:jpe?g|png|webp)$/i.test(image.alt)?`file:${image.alt.toLowerCase()}`:image.currentSrc||image.src));
  };
  const photoFileSnapshot=root=>{
    const inputs=Array.from(root.querySelectorAll('input[type="file"][multiple]')).filter(input=>input.files?.length);
    if(!inputs.length)return null;
    if(inputs.length!==1)return 'photo-files:invalid';
    return 'photo-files:'+JSON.stringify(Array.from(inputs[0].files).map(file=>({name:file.name,size:file.size,type:file.type})));
  };
  const photoSnapshotEntries=value=>{
    if(!value?.startsWith('prepared-photos:'))return null;
    try{const entries=JSON.parse(value.slice('prepared-photos:'.length));return Array.isArray(entries)?entries:null;}catch{return null;}
  };
  const rememberFlow=variant=>{const id=crypto.randomUUID();document.documentElement.setAttribute('data-rivastock-flow',id);return ['variant:'+variant,'flow:'+id];};
  const checkFlow=()=>{const id=baseline.find(value=>value.startsWith('flow:'))?.slice(5);if(!id||document.documentElement.getAttribute('data-rivastock-flow')!==id)throw new Error('Cambió el formulario después de prepararlo. No se envió.');};
  const markRehearsalDraft=()=>{
    if(content?.rehearsal!==true)return;
    if(typeof content.rehearsalId!=='string'||!content.rehearsalId)throw new Error('El ensayo no tiene un identificador local para proteger el borrador.');
    document.documentElement.dataset.rivastockRehearsalId=content.rehearsalId;
  };
  const issue = (kind,message,details={}) => {const error=new Error(message);error.issue={kind,message,...details};throw error;};
  const visible = element => element.getClientRects().length > 0;
  const text = element => normalize(element.textContent);
  const accessibleName = element => element.getAttribute('aria-label') ??
    ((element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
      .map(id => text(document.getElementById(id) ?? document.createElement('span'))).join(' ') || text(element));
  const activeSummaryNodes = () => {
    const hidden = '[role="feed"], [data-pagelet*="Feed"], [data-pagelet*="message" i], [aria-label*="Messenger" i], [aria-label*="mensajes" i]';
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).at(-1);
    const form = Array.from(document.querySelectorAll('form')).filter(candidate => visible(candidate)
      && candidate.querySelector('button,[role="button"],input,textarea,select,[contenteditable="true"]')).at(-1);
    const root = dialog ?? form ?? document.querySelector('main') ?? document.body;
    const nodes = Array.from(root.querySelectorAll('button,[role="button"],[role="checkbox"],[role="switch"],[role="combobox"],a[href],input,textarea,select,[contenteditable="true"]'))
      .filter(node => visible(node) && !node.closest(hidden))
      .filter(node => !(node.tagName === 'INPUT' && node.type === 'password'))
      .slice(0, 80);
    return { root, nodes, summary: summarizeDom(root) };
  };
  const controlDescriptor = (node, nodes, summary) => {
    const index = nodes.indexOf(node);
    return index < 0 ? null : summary.controls[index] ?? null;
  };
  const hintMatches = (control, match) => Boolean(control && match
    && control.role === match.role
    && (!match.accessible_name || control.name === match.accessible_name)
    && (!match.text || control.text === match.text)
    && (!match.nearby_heading || control.headingPath?.at(-1) === match.nearby_heading));
  const matchingHints = () => Array.isArray(content?.supervisionHints)
    ? content.supervisionHints.filter(hint => hint?.step === activeSupervisionStep && hint?.intent_key === activeSupervisionStep && hint?.match)
    : [];
  const selectHinted = candidates => {
    if (!activeSupervisionStep || !candidates?.length) return null;
    const { nodes, summary } = activeSummaryNodes();
    const hints = matchingHints();
    const matches = [];
    for (const node of candidates) {
      const descriptor = controlDescriptor(node, nodes, summary);
      const hint = hints.find(candidate => hintMatches(descriptor, candidate.match));
      if (hint) matches.push({ node, hint });
    }
    if (matches.length !== 1) return null;
    usedLearnedHint = matches[0].hint.match;
    return matches[0].node;
  };
  const recoverableError = message => {
    const error = new Error(message);
    if (activeSupervisionStep) error.supervisionEligible = true;
    throw error;
  };
  const one = (elements, hintCandidates = elements) => {
    if (elements.length === 1) return elements[0];
    const hinted = selectHinted(hintCandidates);
    if (hinted) return hinted;
    const error = new Error('El formulario cambió o hay controles ambiguos. No se repitió el envío.');
    if (activeSupervisionStep) error.supervisionEligible = true;
    throw error;
  };
  const GROUP_EDITOR_TIMEOUT_MS = 60_000;
  const PHOTO_UPLOAD_TIMEOUT_MS = 60_000;
  const wait = async (find, stage = 'respuesta del formulario', timeoutMs = 15_000) => {
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline) {
      const result = find(); if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const error = new Error(`Facebook no respondió a tiempo durante: ${stage}. Verificá el resultado antes de repetir.`);
    if (activeSupervisionStep) error.supervisionEligible = true;
    throw error;
  };
  const progress=async stage=>{
    const mapped = {
      'Completando título y precio':'marketplace.title_price',
      'Seleccionando categoría':'marketplace.category',
      'Seleccionando estado':'marketplace.condition',
      'Completando descripción y ubicación':'marketplace.details',
      'Cargando fotos':'marketplace.photos',
      'Verificando destinos antes de publicar':null,
      'Verificando fotos del artículo en venta':'group.sale.photos',
    };
    if (Object.hasOwn(mapped, stage)) activeSupervisionStep = mapped[stage];
    if(typeof chrome!=='undefined'&&chrome.runtime?.id) void chrome.runtime.sendMessage({type:'progress',stage}).catch(()=>{});
    await reportTraceStep(`form_${stage.toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`);
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
  const buttons = (name, root = document, prefix = false) => {
    const all = Array.from(root.querySelectorAll('button,[role="button"]')).filter(visible);
    const exact = all.filter(element => prefix ? accessibleName(element).startsWith(name) : accessibleName(element) === name);
    if (exact.length === 1 || !activeSupervisionStep) return exact;
    const hinted = selectHinted(all);
    return hinted ? [hinted] : exact;
  };
  const button = (name, root = document, prefix = false) => one(buttons(name, root, prefix));
  const enabled = element => !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true';
  const field = (label, selector) => {
    const labels = Array.from(document.querySelectorAll('label')).filter(visible);
    const all = labels.flatMap(element => Array.from(element.querySelectorAll(selector)).filter(visible));
    const exact = labels.filter(element => Array.from(element.querySelectorAll('span')).some(span => text(span) === label))
      .flatMap(element => Array.from(element.querySelectorAll(selector)).filter(visible));
    return one(exact, all);
  };
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
  const captureActionErrors = async callback => {
    try { return await callback(); }
    catch (error) {
      await reportTraceStep('form_failure', 'failed', true);
      return {
        error: error.message,
        code: error.issue ? 'FORM_VARIANT_UNSUPPORTED' : /destino|audiencia/i.test(error.message) ? 'AUDIENCE_MISMATCH' : /coincid|cambi|precio|fotos/i.test(error.message) ? 'CONTENT_MISMATCH' : 'FORM_VARIANT_UNSUPPORTED',
        ...(error.issue ? { issue: error.issue } : {}),
      };
    }
  };
  if (action === 'apply_supervisor_decision') {
    const request = content?.supervision;
    const decision = request?.decision;
    const current = activeSummaryNodes();
    if (!request || !decision || JSON.stringify(current.summary) !== JSON.stringify(request.domSummary)) {
      return { error: 'El DOM cambió desde que se pidió la decisión. No se ejecutó.' , stale: true };
    }
    const blocked = /\b(?:publicar(?: ahora)?|compartir ahora|publish(?: now)?|share now|send now|enviar ahora|cerrar sesi[oó]n|log\s*out|sign\s*out|settings|configuraci[oó]n|account settings)\b/i;
    const index = decision.element_index;
    const element = Number.isInteger(index) ? current.nodes[index] : null;
    const control = Number.isInteger(index) ? current.summary.controls[index] : null;
    if (['click', 'type', 'select_option', 'scroll_container'].includes(decision.action)
      && (!request.intent?.target || request.intent.target.element_index !== index)) {
      return { error: 'La decisión no apunta al único control objetivo del paso supervisado.' };
    }
    if (['click', 'type', 'select_option', 'scroll_container'].includes(decision.action)
      && (!element || !control || control.state?.disabled || blocked.test(`${control.name} ${control.text ?? ''}`)
        || !['dialog', 'form'].includes(current.summary.scope))) {
      return { error: 'El control de la decisión no es válido en el formulario actual.' };
    }
    if (decision.action === 'click') {
      if (['submit', 'formsubmit'].includes(control.role.toLowerCase()) || blocked.test(`${control.name} ${control.text ?? ''}`)) {
        return { error: 'La decisión intentó activar un control de envío y fue bloqueada.' };
      }
      activate(element);
    } else if (decision.action === 'wait') {
      if (!Number.isInteger(decision.wait_ms) || decision.wait_ms < 500 || decision.wait_ms > 10000) return { error: 'La espera de la decisión excede el límite.' };
      await new Promise(resolve => setTimeout(resolve, decision.wait_ms));
    } else if (decision.action === 'scroll_container') {
      let container = element;
      while (container && container !== current.root) {
        const style = getComputedStyle(container);
        if (container.scrollHeight > container.clientHeight + 8 && /auto|scroll/.test(style.overflowY)) break;
        container = container.parentElement;
      }
      if (!container || container === current.root || container.scrollHeight <= container.clientHeight + 8) return { error: 'No se encontró un contenedor desplazable dentro del formulario.' };
      container.scrollBy({ top: Math.max(80, container.clientHeight * 0.7), behavior: 'instant' });
    } else if (decision.action === 'type') {
      const target = request.intent?.target;
      if (!target || target.element_index !== index || decision.text !== request.intent?.expected_value
        || !['input', 'textarea', 'textbox'].includes(control.role) || element.isContentEditable
        || !['INPUT', 'TEXTAREA'].includes(element.tagName)) return { error: 'La escritura no coincide exactamente con el valor aprobado y el control objetivo.' };
      if (element.value && element.value !== decision.text) return { error: 'El campo ya contiene otro valor aprobado; no se sobrescribió.' };
      if (!element.value) setValue(element, decision.text);
    } else if (decision.action === 'select_option') {
      const target = request.intent?.target;
      if (!target || target.element_index !== index || decision.text !== request.intent?.expected_value
        || control.role !== 'select' || element.tagName !== 'SELECT') return { error: 'La selección no coincide exactamente con el valor aprobado.' };
      const option = Array.from(element.options).filter(item => item.value === decision.text || item.text === decision.text);
      if (option.length !== 1) return { error: 'No hay una única opción que coincida con el valor aprobado.' };
      element.value = option[0].value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (decision.action === 'reload') {
      return { applied: true, reload: true, match: null };
    } else if (decision.action === 'skip_destination') {
      return { applied: true, skipDestination: true, match: null };
    } else {
      return { error: 'La decisión requiere abortar o reiniciar, y se mantuvo el formulario para revisión.', observation: decision.observation };
    }
    const selected = control ?? (request.intent?.target?.element_index != null ? current.summary.controls[request.intent.target.element_index] : null);
    const match = selected ? {
      role: selected.role,
      ...(selected.name ? { accessible_name: selected.name } : {}),
      ...(selected.text ? { text: selected.text } : {}),
      ...(selected.headingPath?.at(-1) ? { nearby_heading: selected.headingPath.at(-1) } : {}),
    } : null;
    return { applied: true, match };
  }
  if (action === 'submit' && content?.rehearsal === true) {
    return captureActionErrors(async () => { throw new Error('El modo ensayo no permite enviar a Facebook.'); });
  }
  if (action === 'discard_draft') {
    return captureActionErrors(async () => {
    if (content?.rehearsal !== true) throw new Error('Descartar borradores requiere un ensayo activo.');
    await reportTraceStep('rehearsal_discard_draft_started', 'ok', true);
    const discardNames = ['Descartar', 'Descartar borrador', 'Descartar publicación', 'Salir sin guardar', 'Salir sin guardar cambios'];
    const closeNames = ['Cerrar', 'Salir', 'Close'];
    const exactButton = (names, root = document) => {
      const matches = Array.from(root.querySelectorAll('button,[role="button"]')).filter(visible)
        .filter(element => names.includes(accessibleName(element)));
      return matches.length === 1 ? matches[0] : null;
    };
    const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible);
    const confirmDiscard = async () => {
      const dialog = dialogs().find(node => /descartar|salir sin guardar/i.test(text(node)));
      if (!dialog) throw new Error('Facebook no mostró una confirmación identificable para descartar el borrador.');
      const discard = exactButton(discardNames, dialog);
      if (!discard || !enabled(discard)) throw new Error('No se encontró un control inequívoco para descartar el borrador.');
      discard.click();
      await wait(() => !dialogs().includes(dialog), 'confirmar el descarte del borrador');
    };
    if (content.rehearsalMechanism === 'marketplace') {
      if (location.pathname.replace(/\/$/, '') !== '/marketplace/create/item' || location.search) {
        return { clean: true, requiresBlankVerification: false };
      }
      const fields = () => ({
        title: Array.from(document.querySelectorAll('label')).filter(node => Array.from(node.querySelectorAll('span')).some(span => text(span) === 'Título'))
          .flatMap(node => Array.from(node.querySelectorAll('input[type="text"]'))),
        price: Array.from(document.querySelectorAll('label')).filter(node => Array.from(node.querySelectorAll('span')).some(span => text(span) === 'Precio'))
          .flatMap(node => Array.from(node.querySelectorAll('input[type="text"]'))),
        description: Array.from(document.querySelectorAll('label')).filter(node => Array.from(node.querySelectorAll('span')).some(span => text(span) === 'Descripción'))
          .flatMap(node => Array.from(node.querySelectorAll('textarea'))),
      });
      const current = fields();
      if (!current.title.length || !current.price.length) throw new Error('No se pudo verificar el formulario de Marketplace antes de limpiar el borrador.');
      if(content.rehearsalPhase==='preflight') {
        if ([...current.title, ...current.price, ...current.description].some(field => field.value.trim())) {
          throw new Error('Hay un borrador de Marketplace previo. Se conservó sin cambios; cerralo manualmente antes de ensayar.');
        }
        return { clean: true, requiresBlankVerification: true };
      }
      if(document.documentElement.dataset.rivastockRehearsalId!==content.rehearsalId) {
        throw new Error('El borrador no pertenece a este ensayo. Se conservó sin cambios.');
      }
      if(current.title.length!==1||current.price.length!==1
        ||(current.title[0].value.trim()&&normalize(current.title[0].value)!==normalize(content.title))
        ||(current.price[0].value.trim()&&!parsePriceARS(current.price[0].value,content.price))
        ||(current.description.length&&current.description.some(field=>field.value.trim()&&lines(field.value).trim()!==lines(content.description).trim()))) {
        throw new Error('El borrador cambió respecto del ensayo. Se conservó sin cambios.');
      }
      if ([...current.title, ...current.price, ...current.description].every(field => !field.value.trim())) {
        return { clean: true, requiresBlankVerification: true };
      }
      const close = exactButton(closeNames);
      if (!close || !enabled(close)) throw new Error('No se encontró un control inequívoco para cerrar el borrador de Marketplace.');
      close.click();
      await wait(() => dialogs().some(node => /descartar|salir sin guardar/i.test(text(node))) || location.pathname.replace(/\/$/, '') !== '/marketplace/create/item', 'cerrar el formulario de Marketplace');
      if (!dialogs().some(node => /descartar|salir sin guardar/i.test(text(node)))) {
        throw new Error('Facebook cerró el formulario sin confirmar el descarte del borrador.');
      }
      await confirmDiscard();
      delete document.documentElement.dataset.rivastockRehearsalId;
      return { discarded: true, requiresBlankVerification: true };
    }
    if (content.rehearsalMechanism === 'group_direct') {
      const dialog = dialogs().find(node => node.querySelector('[contenteditable="true"][aria-label="Crea una publicación pública..."],[contenteditable="true"][role="textbox"][aria-label="Escribe algo..."]'));
      if(content.rehearsalPhase==='preflight') {
        if(dialog)throw new Error('Hay un editor de grupo previo. Se conservó sin cambios; cerralo manualmente antes de ensayar.');
        return { clean: true, requiresBlankVerification: false };
      }
      if (!dialog) return { clean: true, requiresBlankVerification: false };
      const editor=dialog.querySelector('[contenteditable="true"][aria-label="Crea una publicación pública..."],[contenteditable="true"][role="textbox"][aria-label="Escribe algo..."]');
      if(document.documentElement.dataset.rivastockRehearsalId!==content.rehearsalId) {
        throw new Error('El editor no tiene la marca del ensayo activo. Se conservó sin cambios.');
      }
      if(!editor||!matchesEditor(editor,content.groupText)) {
        throw new Error('El editor no coincide con este ensayo. Se conservó sin cambios.');
      }
      if(photoPreviews(dialog).length!==(Array.isArray(content.photos)?content.photos.length:0)) {
        throw new Error('Las fotos del editor cambiaron respecto del ensayo. Se conservaron sin cambios.');
      }
      const close = exactButton(closeNames, dialog);
      if (!close || !enabled(close)) throw new Error('No se encontró un control inequívoco para cerrar el borrador del grupo.');
      close.click();
      await wait(() => dialogs().some(node => /descartar|salir sin guardar/i.test(text(node))) || !dialogs().includes(dialog), 'cerrar el editor del grupo');
      if (!dialogs().some(node => /descartar|salir sin guardar/i.test(text(node)))) {
        throw new Error('Facebook cerró el editor del grupo sin confirmar el descarte.');
      }
      await confirmDiscard();
      await wait(() => !dialogs().some(node => node.querySelector('[contenteditable="true"][aria-label="Crea una publicación pública..."],[contenteditable="true"][role="textbox"][aria-label="Escribe algo..."]')), 'verificar que el editor del grupo se descartó');
      delete document.documentElement.dataset.rivastockRehearsalId;
      return { discarded: true, requiresBlankVerification: false };
    }
    throw new Error('El destino del ensayo no admite descarte de borrador.');
    });
  }
  if (action === 'verify_draft_blank') {
    return captureActionErrors(async () => {
    if (content?.rehearsal !== true || content.rehearsalMechanism !== 'marketplace'
      || location.pathname.replace(/\/$/, '') !== '/marketplace/create/item' || location.search) {
      throw new Error('La verificación de borrador vacío requiere Marketplace y un ensayo activo.');
    }
    await wait(() => buttons('Guardar borrador').length, 'abrir el formulario vacío de Marketplace');
    const title = Array.from(document.querySelectorAll('label')).filter(node => Array.from(node.querySelectorAll('span')).some(span => text(span) === 'Título'))
      .flatMap(node => Array.from(node.querySelectorAll('input[type="text"]')));
    const price = Array.from(document.querySelectorAll('label')).filter(node => Array.from(node.querySelectorAll('span')).some(span => text(span) === 'Precio'))
      .flatMap(node => Array.from(node.querySelectorAll('input[type="text"]')));
    if (title.length !== 1 || price.length !== 1 || title[0].value || price[0].value) {
      throw new Error('Marketplace conservó datos del borrador anterior. El ensayo no se marcó como terminado.');
    }
    if(document.documentElement.dataset.rivastockRehearsalId===content.rehearsalId)delete document.documentElement.dataset.rivastockRehearsalId;
    await reportTraceStep('rehearsal_draft_discarded', 'ok', true);
    return { ready: true, blank: true };
    });
  }
  if (action === 'own_content_snapshot') await reportTraceStep('own_content_reconciliation_scan');
  else if (action === 'check_existing') await reportTraceStep('marketplace_check_existing');
  else if (action === 'marketplace_prepare') await reportTraceStep('marketplace_form_opened');
  else if (action === 'group_prepare' || action === 'group_sale_prepare') await reportTraceStep('group_editor_opened');
  else if (action === 'validate_submit') await reportTraceStep('final_validation');
  else if (action === 'submit') await reportTraceStep('final_click_started');
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
    if (input.files.length) {
      const expected = photos.map((photo, index) => ({
        name: `rivastock-${index + 1}.${photo.extension}`,
        size: atob(photo.data).length,
        type: photo.type,
      }));
      const actual = Array.from(input.files).map(file => ({ name: file.name, size: file.size, type: file.type }));
      if (JSON.stringify(actual) === JSON.stringify(expected)) return;
      throw new Error('El formulario ya contiene fotos distintas de las aprobadas. No se sobrescribieron.');
    }
    const transfer = new DataTransfer();
    photos.forEach((photo, index) => transfer.items.add(new File([Uint8Array.from(atob(photo.data), char => char.charCodeAt(0))], `rivastock-${index + 1}.${photo.extension}`, { type: photo.type })));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const combo = label => {
    const all = Array.from(document.querySelectorAll('label[role="combobox"]')).filter(visible);
    const exact = all.filter(element => accessibleName(element) === label);
    return one(exact, all);
  };
  const supervisionTarget = (step, summary) => {
    const rules = {
      'marketplace.title': control => control.role === 'input' && /t[ií]tulo|producto|art[ií]culo|nombre/i.test(control.name),
      'marketplace.price': control => control.role === 'input' && /precio/i.test(control.name),
      'marketplace.category': control => control.role === 'combobox' && /categor[ií]/i.test(control.name),
      'marketplace.condition': control => control.role === 'combobox' && /estado|condici[oó]n/i.test(control.name),
      'marketplace.more_details': control => control.role === 'button' && /m[aá]s detalles/i.test(`${control.name} ${control.text}`),
      'marketplace.description': control => control.role === 'textarea' && /descrip|detalle/i.test(control.name),
      'marketplace.location': control => ['input', 'combobox'].includes(control.role) && /ubicaci[oó]n|localidad|lugar|location/i.test(control.name),
      'marketplace.photos': control => control.role === 'button' && /foto|photo/i.test(`${control.name} ${control.text}`),
      'group.direct.open': control => control.role === 'button' && /escribe|publicaci[oó]n/i.test(`${control.name} ${control.text}`),
      'group.direct.text': control => control.role === 'textbox',
      'group.direct.photos': control => control.role === 'button' && /foto|photo/i.test(`${control.name} ${control.text}`),
      'group.sale.open': control => control.role === 'button' && /vender|venta/i.test(`${control.name} ${control.text}`),
      'group.sale.kind': control => control.role === 'button' && /art[ií]culo en venta/i.test(`${control.name} ${control.text}`),
      'group.sale.title': control => control.role === 'input' && /t[ií]tulo|producto|art[ií]culo|nombre/i.test(control.name),
      'group.sale.price': control => control.role === 'input' && /precio/i.test(control.name),
      'group.sale.condition': control => control.role === 'combobox' && /estado/i.test(control.name),
      'group.sale.more_details': control => control.role === 'button' && /m[aá]s detalles/i.test(`${control.name} ${control.text}`),
      'group.sale.description': control => control.role === 'textarea' && /descrip|detalle/i.test(control.name),
      'group.sale.location': control => control.role === 'input' && /ubicaci[oó]n|localidad|lugar|location/i.test(control.name),
      'group.sale.photos': control => control.role === 'input' && control.type === 'file',
    };
    const matches = (summary.controls ?? []).filter(rules[step] ?? (() => false));
    return matches.length === 1 && matches[0].name.trim()
      ? { element_index: matches[0].index, role: matches[0].role, name: matches[0].name }
      : undefined;
  };
  const supervisionIntent = (step, summary) => {
    const values = {
      'marketplace.title': ['Fill the approved Marketplace title.', content.title],
      'marketplace.price': ['Fill only the approved Marketplace price.', String(content.price)],
      'marketplace.category': ['Select the approved Marketplace category.', content.category],
      'marketplace.condition': ['Select the approved Marketplace condition.', {new:'Nuevo',like_new:'Usado - Como nuevo',good:'Usado - Buen estado',fair:'Usado - Aceptable'}[content.condition] ?? content.condition],
      'marketplace.more_details': ['Open the details section of the approved Marketplace form.', 'Descripción'],
      'marketplace.description': ['Fill only the approved product description.', content.description],
      'marketplace.location': ['Select the approved business location.', content.location],
      'marketplace.photos': ['Attach only the approved product photos.', String(photos.length)],
      'group.direct.open': ['Open the approved group post composer.', content.targetGroupName ?? content.targetGroupUrl],
      'group.direct.text': ['Use the approved group post text.', content.groupText],
      'group.direct.photos': ['Attach only the approved group photos.', String(photos.length)],
      'group.sale.open': ['Open the approved group sale composer.', content.targetGroupName ?? content.targetGroupUrl],
      'group.sale.kind': ['Choose the approved item-for-sale form.', 'Artículo en venta'],
      'group.sale.title': ['Fill the approved group sale title.', content.title],
      'group.sale.price': ['Fill only the approved group sale price.', String(content.price)],
      'group.sale.condition': ['Select the approved item condition.', {new:'Nuevo',like_new:'Usado - Como nuevo',good:'Usado - Buen estado',fair:'Usado - Aceptable'}[content.condition] ?? content.condition],
      'group.sale.more_details': ['Open the details section of the approved sale form.', 'Descripción'],
      'group.sale.description': ['Fill only the approved sale description.', content.description],
      'group.sale.location': ['Select only the approved sale location.', content.location],
      'group.sale.photos': ['Attach only the approved sale photos.', String(photos.length)],
    };
    const [objective, expected_value] = values[step] ?? ['Recover the current deterministic form step.', ''];
    const target = supervisionTarget(step, summary);
    const failed_hints = matchingHints().slice(0, 8).map(hint => ({
      step: hint.step,
      intent_key: hint.intent_key,
      role: hint.match.role,
      ...(hint.match.accessible_name ? { accessible_name: hint.match.accessible_name } : {}),
      ...(hint.match.text ? { text: hint.match.text } : {}),
      ...(hint.match.nearby_heading ? { nearby_heading: hint.match.nearby_heading } : {}),
    }));
    return {
      step,
      intent_key: step,
      objective,
      expected_value: String(expected_value ?? '').slice(0, 2000),
      restrictions: ['Use only the active dialog or form.', 'Never publish or submit.', 'Do not change approved content or audience.'],
      ...(target ? { target } : {}),
      ...(failed_hints.length ? { failed_hints } : {}),
    };
  };
  try {
  safety();
  if (action === 'check_existing') {
    const snapshot=await marketplaceSnapshot(false);
    if(!snapshot.complete)throw new Error('No se pudo verificar la búsqueda de anuncios propios. No se envió.');
    if(snapshot.items.length)issue('marketplace_conflict','Ya existe un anuncio de Marketplace con el título aprobado. Revisá su identidad antes de volver a publicar.',{candidates:[]});
    return {ready:true};
  }
  if (action === 'marketplace_prepare') {
    if (location.pathname !== '/marketplace/create/item' || location.search) throw new Error('No se abrió un formulario nuevo de Marketplace.');
    activeSupervisionStep = 'marketplace.title';
    await wait(() => buttons('Guardar borrador').length);
    const title = field('Título', 'input[type="text"]');
    activeSupervisionStep = 'marketplace.price';
    const price = field('Precio', 'input[type="text"]');
    if ((title.value && title.value !== content.title) || (price.value && !parsePriceARS(price.value, content.price))) throw new Error('Hay un borrador distinto del contenido aprobado. No se sobrescribió.');
    markRehearsalDraft();
    await progress('Completando título y precio');
    if (title.value !== content.title) setValue(title, content.title);
    if (!parsePriceARS(price.value, content.price)) setValue(price, String(content.price));
    if(!parsePriceARS(price.value, content.price))throw new Error('El precio del formulario no coincide con el aprobado. No se envió.');
    await reportTraceStep('marketplace_title_price_verified','ok',false);
    await progress('Seleccionando categoría');
    const scrollable=()=>Array.from(document.querySelectorAll('*')).filter(element=>visible(element)&&element.scrollHeight>element.clientHeight+8&&/auto|scroll/.test(getComputedStyle(element).overflowY));
    const previousScrollers=new Set(scrollable());
    const categoryControl=combo('Categoría');
    const categoryName=element=>normalize(accessibleName(element).replace(/\s*Envío disponible$/,''));
    const choices=()=>Array.from(document.querySelectorAll('button,[role="button"],[role="option"],[role="menuitem"]')).filter(visible).filter(element=>categoryName(element)===normalize(content.category));
    let found=false;
    if (text(categoryControl).includes(content.category) && categoryControl.getAttribute('aria-expanded') !== 'true') found=true;
    else if (categoryControl.getAttribute('aria-expanded') !== 'true') activate(categoryControl);
    // Some menus render category rows only as their own scroll area moves.
    // Scroll only a newly opened menu, never the page or the form sidebar.
    for(let attempt=0;!found&&attempt<40;attempt++) {
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
    if(!found)recoverableError(`No se encontró la categoría «${content.category}» en el menú de Facebook. No se envió.`);
    if(categoryControl.getAttribute('aria-expanded')==='true')await wait(()=>text(categoryControl).includes(content.category)&&categoryControl.getAttribute('aria-expanded')!=='true','confirmar la categoría seleccionada');
    await progress('Seleccionando estado');
    const conditionControl=combo('Estado');
    const condition = { new: 'Nuevo', like_new: 'Usado - Como nuevo', good: 'Usado - Buen estado', fair: 'Usado - Aceptable' }[content.condition];
    if (!(text(conditionControl).includes(condition) && conditionControl.getAttribute('aria-expanded') !== 'true')) {
      if(conditionControl.getAttribute('aria-expanded')!=='true')activate(conditionControl);
      await wait(() => Array.from(document.querySelectorAll('[role="option"]')).some(element => visible(element) && text(element) === condition),'buscar el estado del producto');
      activate(one(Array.from(document.querySelectorAll('[role="option"]')).filter(visible).filter(element => text(element) === condition)));
      await wait(()=>text(conditionControl).includes(condition)&&conditionControl.getAttribute('aria-expanded')!=='true','confirmar el estado seleccionado');
    }
    if(!text(categoryControl).includes(content.category))recoverableError('La categoría seleccionada no coincide con la aprobada. No se envió.');
    if(!text(conditionControl).includes(condition))recoverableError('El estado seleccionado no coincide con el aprobado. No se envió.');
    await progress('Completando descripción y ubicación');
    activeSupervisionStep='marketplace.more_details';
    if (!Array.from(document.querySelectorAll('textarea')).some(element => visible(element) && element.closest('label')?.textContent.includes('Descripción'))) button('Más detalles', document, true).click();
    await wait(()=>Array.from(document.querySelectorAll('textarea')).some(element=>visible(element)&&element.closest('label')?.textContent.includes('Descripción')),'abrir los detalles del producto');
    activeSupervisionStep='marketplace.description';
    const description=field('Descripción', 'textarea');
    if (description.value && lines(description.value) !== lines(content.description)) throw new Error('La descripción del borrador no coincide con el contenido aprobado. No se sobrescribió.');
    if (lines(description.value) !== lines(content.description)) setValue(description, content.description);
    activeSupervisionStep='marketplace.location';
    const allPlaces=Array.from(document.querySelectorAll('input[aria-label="Ubicación"][role="combobox"],input[role="combobox"]')).filter(visible);
    const placeExact=allPlaces.filter(element=>element.getAttribute('aria-label')==='Ubicación');
    const place = one(placeExact, allPlaces);
    if (!sameMarketplaceLocation(place.value,content.location)) {
      setValue(place,content.location);
      const options=()=>Array.from(document.querySelectorAll('li[role="option"]')).filter(visible).filter(element=>sameMarketplaceLocation(text(element),content.location));
      await wait(()=>options().length>0,'buscar la ciudad');
      one(options()).click();
      await wait(()=>sameMarketplaceLocation(place.value,content.location)&&place.getAttribute('aria-expanded')!=='true');
    }
    for (const label of ['Promocionar tras publicar', 'Ocultar a amigos']) {
      const control = document.querySelector(`input[aria-label="${label}"]`);
      if (control?.checked || control?.getAttribute('aria-checked') === 'true') throw new Error('Facebook cambió las preferencias de publicación. Revisá la pestaña.');
    }
    const input = one(Array.from(document.querySelectorAll('input[type="file"][multiple]')).filter(element => (element.getAttribute('accept') ?? '').split(',').includes('image/*')));
    await progress('Cargando fotos');
    attach(input);
    await wait(() => enabled(button('Siguiente')) && !buttons('Guardar borrador').some(element => !enabled(element)),'cargar fotos y habilitar Siguiente',PHOTO_UPLOAD_TIMEOUT_MS);
    const previews=()=>Array.from(document.querySelectorAll('img')).filter(img=>visible(img)&&/^(foto|photo)\b/i.test(img.alt));
    // Facebook's own "Fotos · N/10" counter is authoritative; a background tab may
    // not have decoded the thumbnails yet, so either signal may confirm the count.
    const photoCounter=()=>Number(normalize(document.body.innerText).match(/Fotos\s*·\s*(\d+)\s*\/\s*10\b/)?.[1]??NaN);
    const photosConfirmed=()=>photoCounter()===photos.length||(previews().length===photos.length&&previews().every(img=>img.complete&&img.naturalWidth>0));
    try{await wait(photosConfirmed,'verificar las fotos cargadas',PHOTO_UPLOAD_TIMEOUT_MS);}
    catch{throw new Error(`Se esperaban ${photos.length} fotos cargadas; Facebook indica ${Number.isNaN(photoCounter())?'sin contador':photoCounter()} y se observaron ${previews().length} vistas previas${previews().some(img=>!img.complete||img.naturalWidth===0)?' (alguna sin terminar de cargar)':''}. No se envió.`);}
    if(title.value!==content.title||!parsePriceARS(price.value,content.price)||lines(description.value)!==lines(content.description)||!sameMarketplaceLocation(place.value,content.location)) throw new Error('Los valores del formulario no coinciden con el contenido aprobado. No se envió.');
    activeSupervisionStep = null;
    await progress('Verificando destinos antes de publicar');
    button('Siguiente').click();
    await wait(() => /Publicar en más lugares/.test(document.body.innerText) && buttons('Publicar').length === 1,'abrir el paso final de Marketplace');
    if (document.querySelector('[role="checkbox"][aria-checked="true"],input[type="checkbox"]:checked')) throw new Error('Facebook seleccionó destinos adicionales. No se envió.');
    const baselineMarketplaceUrls=()=>Array.from(document.querySelectorAll('a[href]')).flatMap(element=>{try{const url=new URL(element.href);return url.origin===location.origin&&/^\/marketplace\/item\/\d+\/?$/.test(url.pathname)?[url.origin+url.pathname]:[];}catch{return [];}});
    const baselineMarketplaceNotices=()=>Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).filter(visible).map(node=>'notice:'+text(node));
    const baseline=[...rememberFlow('marketplace'),photoSnapshot(document,photos.length),photoFileSnapshot(document),'photos:'+photos.length,...(content.allowRepublish===true?['marketplace:new-explicit']:[]),...new Set(baselineMarketplaceUrls()),...baselineMarketplaceNotices()].filter(value=>typeof value==='string');
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
    activeSupervisionStep='group.sale.open';
    let dialog=Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).find(node=>text(node).includes('Artículo en venta')&&node.querySelector('input[type="file"]'));
    if(Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).length&&!dialog)throw new Error('Hay un formulario abierto que no coincide con el destino de venta aprobado. No se sobrescribió.');
    if(!dialog) {
      await wait(()=>buttons('Vender algo').length===1,'cargar Vender algo');
      activeSupervisionStep='group.sale.kind';
      if(!buttons('Artículo en venta',document,true).length)activate(button('Vender algo'));
      const sale=await wait(()=>buttons('Artículo en venta',document,true).length===1&&buttons('Artículo en venta',document,true)[0],'elegir Artículo en venta');
      if(!dialog)activate(sale);
      dialog=await wait(()=>Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).find(node=>text(node).includes('Artículo en venta')&&node.querySelector('input[type="file"]')),'abrir el formulario de venta');
    }
    activeSupervisionStep='group.sale.title_price';
    await reportTraceStep('group_sale_editor_ready','ok',true,dialog);
    const saleField=(label,selector)=>{
      const labels=Array.from(dialog.querySelectorAll('label')).filter(visible);
      const all=labels.flatMap(node=>node.matches(selector)?[node]:Array.from(node.querySelectorAll(selector)));
      const exact=labels.filter(node=>Array.from(node.querySelectorAll('span')).some(span=>text(span)===label)).flatMap(node=>node.matches(selector)?[node]:Array.from(node.querySelectorAll(selector)));
      return one(exact,all);
    };
    activeSupervisionStep='group.sale.title';
    const title=saleField('Título','input');
    activeSupervisionStep='group.sale.price';
    const price=saleField('Precio','input');
    if((title.value&&title.value!==content.title)||(price.value&&!parsePriceARS(price.value,content.price)))throw new Error('El formulario de venta contiene contenido distinto del aprobado. No se sobrescribió.');
    if(title.value!==content.title)setValue(title,content.title);
    if(!parsePriceARS(price.value,content.price))setValue(price,String(content.price));
    if(!parsePriceARS(price.value, content.price))throw new Error('El precio de venta no coincide con el aprobado. No se envió.');
    activeSupervisionStep='group.sale.condition';
    const conditionControl=saleField('Estado','[role="combobox"]');
    // Facebook uses the label itself as the combobox in this composer.
    const condition={new:'Nuevo',like_new:'Usado - Como nuevo',good:'Usado - Buen estado',fair:'Usado - Aceptable'}[content.condition];
    if(!text(conditionControl).includes(condition)) {
      if(conditionControl.getAttribute('aria-expanded')!=='true')activate(conditionControl);
      activate(await wait(()=>Array.from(document.querySelectorAll('[role="option"]')).filter(visible).find(node=>text(node)===condition),'elegir el estado'));
      await wait(()=>text(conditionControl).includes(condition),'confirmar el estado de la venta');
    }
    if(!text(conditionControl).includes(condition))recoverableError('El estado de la venta no coincide con el aprobado. No se envió.');
    activeSupervisionStep='group.sale.more_details';
    if(!Array.from(dialog.querySelectorAll('textarea')).some(visible))activate(button('Más detalles',dialog,true));
    activeSupervisionStep='group.sale.description';
    const description=await wait(()=>{try{return saleField('Descripción','textarea');}catch{return null;}},'abrir la descripción');
    if(description.value&&lines(description.value)!==lines(content.description))throw new Error('La descripción de venta no coincide con la aprobada. No se sobrescribió.');
    if(lines(description.value)!==lines(content.description))setValue(description,content.description);
    activeSupervisionStep='group.sale.location';
    const places=Array.from(dialog.querySelectorAll('input[aria-label="Ubicación"],input')).filter(visible);
    const placeExact=places.filter(node=>node.getAttribute('aria-label')==='Ubicación');
    const place=one(placeExact,places);
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
    activeSupervisionStep='group.sale.photos';
    await reportTraceStep('group_sale_photos_upload_started','ok',true,dialog);
    attach(one(Array.from(dialog.querySelectorAll('input[type="file"][multiple]')).filter(node=>(node.accept??'').split(',').includes('image/*'))));
    await progress('Verificando fotos del artículo en venta');
    await wait(()=>{
      const controls=Array.from(dialog.querySelectorAll('button,[role="button"]')).filter(visible).map(accessibleName).map(name=>name.match(/^Eliminar foto (\d+) de (\d+)$/)).filter(Boolean);
      const indexes=new Set(controls.map(match=>Number(match[1])));
      const images=Array.from(dialog.querySelectorAll('img[alt="Foto de la publicación"]')).filter(visible);
      const counter=text(dialog).match(/Fotos\s*[·:]?\s*(\d+)\s*\/\s*(\d+)/);
      return controls.length===photos.length&&indexes.size===photos.length&&controls.every(match=>Number(match[2])===photos.length&&Number(match[1])>=1&&Number(match[1])<=photos.length)&&images.length===photos.length&&images.every(image=>image.complete&&image.naturalWidth>0)&&counter&&Number(counter[1])===photos.length&&enabled(button('Siguiente',dialog));
    },'verificar fotos del formulario de venta',PHOTO_UPLOAD_TIMEOUT_MS);
    if(title.value!==content.title||!parsePriceARS(price.value,content.price)||lines(description.value)!==lines(content.description)||normalize(place.value).toLowerCase()!==normalize(content.location).toLowerCase())throw new Error('Los datos de venta no coinciden con los aprobados.');
    await reportTraceStep('group_sale_fields_verified');
    activeSupervisionStep=null;
    const notices=Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map(node=>'notice:'+text(node));
    activate(button('Siguiente',dialog));
    await wait(()=>buttons('Publicar').length===1,'abrir la confirmación de venta');
    const final=button('Publicar').closest('[role="dialog"]');
    if(!final||!verifySaleAudience(final,target,originName))issue('group_sale_audience','No se pudo verificar que la venta se enviará únicamente al grupo aprobado. Revisá el formulario; no se autorizó Publicar.');
    await reportTraceStep('group_sale_validation_passed');
    return {ready:true,baseline:[...rememberFlow('group_sale'),photoSnapshot(dialog),'salephotos:'+photos.length,...notices,'group:'+target,'sale:approved',...(originName?['sale:origin:'+originName]:[])]};
  }
  if (action === 'group_prepare') {
    const target=content.targetGroupUrl?new URL(content.targetGroupUrl).pathname.replace(/\/$/,''):location.pathname.replace(/\/$/,'');
    const actual=location.pathname.replace(/\/$/,'');
    if(!/^\/groups\/[A-Za-z0-9._-]+$/.test(actual))throw new Error('El grupo abierto no corresponde a la URL aprobada. No se envió.');
    activeSupervisionStep='group.direct.open';
    const existingDialog=Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).find(node=>node.querySelector('[contenteditable="true"][role="textbox"]'));
    if(Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).length&&!existingDialog)throw new Error('Hay un formulario abierto que no coincide con el destino aprobado. No se sobrescribió.');
    const before = [...new Set(photoIds())];
    if(Array.from(document.querySelectorAll('h2,h3,[role="heading"]')).some(h=>visible(h)&&/este grupo está en pausa/i.test(text(h))))throw new Error('Este grupo está en pausa. No se puede publicar hasta que un administrador lo reactive.');
    await wait(() => {
      if(buttons('Vender algo').length===1&&buttons('Escribe algo...').length!==1)issue('group_sale_required','Este grupo utiliza un formulario de venta. Revisá y aprobá ese formato desde RivaStock.');
      const denial=Array.from(document.querySelectorAll('[role="alert"]')).filter(visible).some(node=>/no (puedes|tenés permiso para|tienes permiso para) publicar/i.test(text(node)));
      if(denial)throw new Error('Facebook indicó que esta cuenta no tiene permiso para publicar en el grupo.');
      return buttons('Escribe algo...').length===1;
    },'cargar el editor del grupo; no se pudo determinar su disponibilidad',GROUP_EDITOR_TIMEOUT_MS);
    const visibleOutsideComposer=()=>{
      const clone=document.body.cloneNode(true);
      clone.querySelectorAll('[role="dialog"]').forEach(node=>node.remove());
      return normalize(clone.textContent);
    };
    if(visibleOutsideComposer().includes(normalize(content.groupText)))throw new Error('El grupo ya muestra el contenido aprobado. Verificá el post antes de publicar otro.');
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
    if(!existingDialog)button('Escribe algo...').click();
    activeSupervisionStep='group.direct.text';
    const editorCandidates=()=>Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"]')).filter(visible);
    const preferredEditors=()=>editorCandidates().filter(node=>['Crea una publicación pública...','Escribe algo...'].includes(node.getAttribute('aria-label')));
    let editor = await wait(() => {
      const candidates=editorCandidates();
      return candidates.length?one(preferredEditors(),candidates):null;
    });
    const dialog = editor.closest('[role="dialog"]');
    const approved=lines(content.groupText);
    if (!dialog || (text(editor) && !matchesEditor(editor,approved))) throw new Error('El editor del grupo contiene un borrador distinto del contenido aprobado. No se sobrescribió.');
    markRehearsalDraft();
    await reportTraceStep('group_editor_ready','ok',true,dialog);
    const anonymous = dialog.querySelector('[role="switch"][aria-label="Publicar de forma anónima"]');
    if (anonymous?.getAttribute('aria-checked') === 'true') throw new Error('El editor está en modo anónimo. No se envió.');
    const liveEditor = () => {
      if (!dialog.isConnected) throw new Error('Facebook reemplazó el formulario. No se envió.');
      const candidates=Array.from(dialog.querySelectorAll('[contenteditable="true"][role="textbox"]')).filter(visible);
      const preferred=candidates.filter(node=>['Crea una publicación pública...','Escribe algo...'].includes(node.getAttribute('aria-label')));
      return one(preferred,candidates);
    };
    if(!matchesEditor(editor,approved)) {
      editor.focus();
      const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
      await new Promise(resolve=>setTimeout(resolve,0));
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
    }
    editor=liveEditor();
    if(!matchesEditor(editor,approved))throw new Error('El texto del editor no coincide con el aprobado. Se detuvo antes de cargar fotos y de enviar.');
    await reportTraceStep('group_text_verified');
    activeSupervisionStep='group.direct.photos';
    const inputs = Array.from(dialog.querySelectorAll('input[type="file"][multiple]')).filter(element => (element.getAttribute('accept') ?? '').split(',').includes('image/*'));
    // Observed composer has equivalent image inputs. Upload exactly once using
    // the input closest to Foto/video; refuse ties instead of guessing.
    const photoButton = button('Foto/video', dialog);
    let scope = photoButton;
    while (scope !== dialog && !scope.querySelector('input[type="file"][multiple]')) scope = scope.parentElement;
    const associated = inputs.filter(input => scope.contains(input));
    await reportTraceStep('group_photos_upload_started','ok',true,dialog);
    attach(one(associated));
    await wait(() => {
      const previews=Array.from(dialog.querySelectorAll('img')).filter(img=>/^rivastock-\d+\.(?:jpe?g|png|webp)$/i.test(img.alt));
      return enabled(button('Publicar', dialog))&&previews.length===photos.length&&
        previews.every((img,index)=>img.alt===`rivastock-${index+1}.${photos[index].extension}`&&visible(img)&&img.complete&&img.naturalWidth>0);
    },'carga y verificación de todas las fotos del grupo',PHOTO_UPLOAD_TIMEOUT_MS);
    await reportTraceStep('group_photos_verified');
    activeSupervisionStep=null;
    if(dialog.querySelector('[role="checkbox"][aria-checked="true"],input[type="checkbox"]:checked'))throw new Error('El editor seleccionó otros grupos. No se envió.');
    const alerts=Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map(node=>`notice:${text(node)}`);
    const existingPostUrls=Array.from(document.querySelectorAll('a[href]')).flatMap(element=>{try{const url=new URL(element.href);return url.origin===location.origin&&/^\/groups\/[A-Za-z0-9._-]+\/(posts|permalink)\/\d+\/?$/.test(url.pathname)?[url.origin+url.pathname]:[];}catch{return [];}});
    await reportTraceStep('group_validation_passed');
    return { ready: true, baseline: [...rememberFlow('group'),photoSnapshot(dialog,photos.length),photoFileSnapshot(dialog),...before,...new Set(existingPostUrls),...alerts,`author:${authorId}`,`group:${actual}`,`photos:${photos.length}`,`target:${target}`,...new Set([targetSeg,actualSeg,/^\d+$/.test(authorGroupSeg??'')?authorGroupSeg:null].filter(Boolean).map(seg=>'groupseg:'+seg))].filter(value=>typeof value==='string') };
  }
  if (action === 'submit' || action === 'validate_submit') {
    if (action === 'submit' && content?.rehearsal === true) throw new Error('El modo ensayo no permite enviar a Facebook.');
    if (action === 'validate_submit' && content?.rehearsal === true
      && document.documentElement.dataset.rivastockRehearsalId!==content.rehearsalId) {
      throw new Error('El formulario no pertenece al ensayo activo. No se envió.');
    }
    // One final click per tab and flow: a repeated submit never clicks again.
    const submitFlow=baseline.find(value=>value.startsWith('flow:'))?.slice(5);
    const priorSubmit=(()=>{try{return JSON.parse(document.documentElement.getAttribute('data-rivastock-submit'));}catch{return null;}})();
    if(submitFlow&&priorSubmit?.flow===submitFlow&&Date.now()-priorSubmit.started<120000)throw new Error('El envío ya se realizó en esta pestaña. No se repitió.');
    const previousPhotos=baseline.find(value=>value.startsWith('prepared-photos:'));
    const photoRoot=document.querySelector('[role="dialog"]')??document;
    const currentPhotos=photoSnapshot(photoRoot);
    const photoCount=baseline.find(value=>value.startsWith('photos:'))?.slice(7);
    if(photoCount!==undefined){
      const expected=Number(photoCount);
      const prepared=photoSnapshotEntries(previousPhotos);
      const current=photoSnapshotEntries(currentPhotos);
      const previews=photoPreviews(photoRoot);
      const preparedFiles=baseline.find(value=>value.startsWith('photo-files:'));
      const currentFiles=photoFileSnapshot(photoRoot);
      const markers=previews.map(image=>image.dataset.rivastockPhotoOrder??null);
      const hasPreparedOrder=prepared?.length===expected&&prepared.every((entry,index)=>entry===`order:${index+1}`);
      const markedOrderMatches=markers.length===expected&&markers.every((marker,index)=>marker===String(index+1))&&hasPreparedOrder;
      const filesMatch=Boolean(preparedFiles&&currentFiles&&preparedFiles!=='photo-files:invalid'&&preparedFiles===currentFiles);
      const previewsReplaced=markers.length===expected&&markers.every(marker=>marker===null)&&filesMatch;
      const legacySnapshotMatches=!preparedFiles&&prepared?.length===expected&&current?.length===expected&&JSON.stringify(prepared)===JSON.stringify(current);
      if(!Number.isSafeInteger(expected)||expected<0||!prepared||previews.length!==expected||!(markedOrderMatches||previewsReplaced||legacySnapshotMatches))
        throw new Error('Cambió el orden o la carga de las fotos después de preparar. No se envió.');
    }else if(previousPhotos&&previousPhotos!==currentPhotos)throw new Error('Cambió el orden o la carga de las fotos después de preparar. No se envió.');
    // validate_submit is a dry run. The worker repeats these guards after its
    // atomic checkpoint and calls the final click only through submit.
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
      const places=Array.from(document.querySelectorAll('input[aria-label="Ubicación"]'));if(places.some(node=>!sameMarketplaceLocation(node.value,content.location)))throw new Error('Cambió la ubicación. No se envió.');
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
      if(action==='validate_submit')return {ready:true};
      if(submitFlow)document.documentElement.setAttribute('data-rivastock-submit',JSON.stringify({flow:submitFlow,started:Date.now(),notices:[]}));
      publish.click(); await reportTraceStep('final_click_completed'); return { clicked: true };
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
    if(action==='validate_submit')return {ready:true};
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
    publish.click(); await reportTraceStep('final_click_completed'); return { clicked: true };
  }
  throw new Error('Acción no autorizada.');
  } catch(error) {
    let supervision = null;
    if (error.supervisionEligible && activeSupervisionStep && !error.issue
      && ['marketplace_prepare', 'group_prepare', 'group_sale_prepare'].includes(action)) {
      const { summary } = activeSummaryNodes();
      const intent = supervisionIntent(activeSupervisionStep, summary);
      const trace = await reportTraceStep(activeSupervisionStep, 'failed', true, null, summary).catch(() => null);
      supervision = {
        stepName: activeSupervisionStep,
        intent,
        domSummary: summary,
        stepSeq: trace?.seq ?? null,
        traceId: trace?.traceId ?? null,
        ...(usedLearnedHint ? { usedLearnedHint } : {}),
      };
    } else await reportTraceStep('form_failure', 'failed', true);
    return {
      error: error.message,
      code:error.issue?'FORM_VARIANT_UNSUPPORTED':/destino|audiencia/i.test(error.message)?'AUDIENCE_MISMATCH':/coincid|cambi|precio|fotos/i.test(error.message)?'CONTENT_MISMATCH':'FORM_VARIANT_UNSUPPORTED',
      ...(error.issue?{issue:error.issue}:{}),
      ...(supervision ? { supervision } : {}),
    };
  }
}
