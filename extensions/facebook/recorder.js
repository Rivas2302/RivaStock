const QUEUE_KEY = 'automationTraceQueue';
const MAX_QUEUE_BYTES = 5_500_000;
const MAX_CAPTURE_BYTES = 600_000;
const MAX_SUMMARY_BYTES = 20_480;
const ALARM_NAME = 'rivastock-trace-upload';

let storageSerial = Promise.resolve();
let stepSerial = Promise.resolve();
let flushing = false;
let pendingFlush = null;
let lastCaptureAt = 0;

const withStorageLock = (operation) => {
  const result = storageSerial.then(operation, operation);
  storageSerial = result.catch(() => {});
  return result;
};

async function readQueue() {
  const result = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(result[QUEUE_KEY]) ? result[QUEUE_KEY] : [];
}

async function writeQueue(queue) {
  let next = queue;
  const encodedBytes = () => new TextEncoder().encode(JSON.stringify(next)).byteLength;
  while (encodedBytes() > MAX_QUEUE_BYTES) {
    let stripped = false;
    for (const trace of next) {
      const event = trace.events?.find(item => typeof item.screenshot_base64 === 'string');
      if (!event) continue;
      delete event.screenshot_base64;
      event.note = [event.note, 'Captura omitida para conservar la cola local.'].filter(Boolean).join(' ').slice(0, 500);
      stripped = true;
      break;
    }
    if (!stripped) throw new Error('La cola local de trazas superó su capacidad.');
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: next });
}

async function updateQueue(update) {
  return withStorageLock(async () => {
    const queue = await readQueue();
    const result = await update(queue);
    await writeQueue(queue);
    return result;
  });
}

function extensionVersion() {
  try { return chrome.runtime.getManifest().version; } catch { return 'unknown'; }
}

function validTraceTab(tab) {
  if (!tab?.active || !Number.isInteger(tab.windowId) || !/^https:\/\/www\.facebook\.com\/(?:groups\/|marketplace\/)/.test(tab.url ?? '')) return false;
  return true;
}

async function captureScreenshot(tabId) {
  if (!Number.isInteger(tabId) || !chrome.permissions?.contains) {
    return { note: 'Se guardó el resumen del DOM; las capturas no están disponibles.' };
  }
  const permitted = await chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false);
  if (!permitted) return { note: 'Se guardó el resumen del DOM; las capturas están desactivadas.' };

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!validTraceTab(tab)) return { note: 'Se guardó el resumen del DOM; la pestaña activa no es de Facebook.' };
  const window = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!window || window.state === 'minimized') {
    return { note: 'Se guardó el resumen del DOM; la ventana de Facebook está minimizada.' };
  }

  const now = Date.now();
  if (now - lastCaptureAt < 600) await new Promise(resolve => setTimeout(resolve, 600 - (now - lastCaptureAt)));
  lastCaptureAt = Date.now();

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
  const source = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const scale = Math.min(1, 1280 / Math.max(source.width, source.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('No se pudo procesar la captura.');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    let blob;
    for (const quality of [0.6, 0.5, 0.4, 0.3]) {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      if (blob.size <= MAX_CAPTURE_BYTES) break;
    }
    if (!blob || blob.size > MAX_CAPTURE_BYTES) return { note: 'Se guardó el resumen del DOM; la captura superó 600 KB.' };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return { screenshot_base64: btoa(binary) };
  } finally {
    source.close();
  }
}

function mergeNote(existing, added) {
  return [existing, added].filter(Boolean).join(' ').slice(0, 500) || null;
}

function isOpenTrace(trace) {
  return !trace.finished && (Boolean(trace.traceId) || trace.events?.some(event => event.action === 'trace_start'));
}

function scheduleRetry() {
  try { void chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1 }); } catch { /* The next worker wake retries the persisted queue. */ }
}

async function postEvent(connection, event, trace) {
  const payload = event.action === 'trace_start'
    ? event.payload
    : { ...event.payload, trace_id: trace.traceId };
  const response = await fetch(`${connection.url}/functions/v1/automation`, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: {
      apikey: connection.key,
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: event.action, ...payload }),
  });
  if (!response.ok) throw new Error(`Trace upload returned ${response.status}`);
  return response.json();
}

export function flushTraceQueue() {
  if (flushing) return pendingFlush ?? Promise.resolve();
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve();
  flushing = true;
  pendingFlush = (async () => {
   try {
    for (;;) {
      const queue = await readQueue();
      const trace = queue[0];
      const event = trace?.events?.[0];
      if (!trace || !event) {
        if (trace?.finished) {
          await updateQueue(current => { if (current[0]?.attemptId === trace.attemptId) current.shift(); });
          continue;
        }
        return;
      }

      const { connection } = await chrome.storage.local.get('connection');
      if (!connection || connection.deviceId !== trace.deviceId || connection.url !== trace.projectUrl) return;
      try {
        const result = await postEvent(connection, event, trace);
        await updateQueue(current => {
          const active = current.find(item => item.attemptId === trace.attemptId);
          if (!active || active.events?.[0]?.id !== event.id) return;
          active.events.shift();
          if (event.action === 'trace_start') active.traceId = result.trace_id;
          if (event.action === 'trace_finish' && active.events.length === 0) {
            const index = current.indexOf(active);
            current.splice(index, 1);
          }
        });
      } catch (error) {
        await chrome.storage.local.set({ traceUploadIssue: String(error?.message ?? 'No se pudo enviar la traza.').slice(0, 160) }).catch(() => {});
        scheduleRetry();
        return;
      }
    }
   } finally {
    flushing = false;
    pendingFlush = null;
   }
  })();
  return pendingFlush;
}

export async function startTrace(mode, job) {
  if (!['real', 'rehearsal'].includes(mode) || !job?.attemptId || !job?.destination?.mechanism) return null;
  const { connection } = await chrome.storage.local.get('connection');
  if (!connection) return null;
  const localKey = await updateQueue(queue => {
    const existing = queue.find(trace => trace.attemptId === job.attemptId && trace.deviceId === connection.deviceId);
    if (existing) return existing.localKey;
    const trace = {
      localKey: crypto.randomUUID(),
      attemptId: job.attemptId,
      deviceId: connection.deviceId,
      projectUrl: connection.url,
      traceId: null,
      nextSeq: 1,
      events: [{
        id: crypto.randomUUID(),
        action: 'trace_start',
        payload: {
          mode,
          delivery_id: mode === 'real' ? job.id : null,
          attempt_id: mode === 'real' ? job.attemptId : null,
          mechanism: job.destination.mechanism,
          extension_version: extensionVersion(),
          summary: { source: 'facebook-extension', resumed: false },
        },
      }],
    };
    queue.push(trace);
    return trace.localKey;
  });
  void flushTraceQueue();
  return localKey;
}

async function recordStep(name, status, options = {}) {
  if (typeof name !== 'string' || !name || !['ok', 'retry', 'failed', 'supervised'].includes(status)) return false;
  const summary = options.domSummary && typeof options.domSummary === 'object' ? options.domSummary : {};
  let summaryText;
  try { summaryText = JSON.stringify(summary); } catch { summaryText = '{}'; }
  if (new TextEncoder().encode(summaryText).byteLength > MAX_SUMMARY_BYTES) summaryText = '{}';

  const eventId = crypto.randomUUID();
  const accepted = await updateQueue(queue => {
    const trace = queue.find(isOpenTrace);
    if (!trace) return false;
    const seq = trace.nextSeq++;
    trace.events.push({
      id: eventId,
      action: 'trace_step',
      payload: {
        seq,
        step: name.slice(0, 160),
        status,
        elapsed_ms: Number.isSafeInteger(options.elapsedMs) ? Math.max(0, options.elapsedMs) : 0,
        dom_summary: JSON.parse(summaryText),
        note: mergeNote(options.note, null),
      },
    });
    return true;
  });
  if (!accepted) return false;

  if (options.capture === true) {
    let capture;
    try { capture = await captureScreenshot(options.tabId); }
    catch { capture = { note: 'Se guardó el resumen del DOM; no se pudo obtener la captura.' }; }
    if (capture.screenshot_base64 || capture.note) {
      await updateQueue(queue => {
        const event = queue.flatMap(trace => trace.events ?? []).find(item => item.id === eventId);
        if (!event) return false;
        if (capture.screenshot_base64) event.payload.screenshot_base64 = capture.screenshot_base64;
        if (capture.note) event.payload.note = mergeNote(event.payload.note, capture.note);
        return true;
      });
    }
  }

  void flushTraceQueue();
  return accepted;
}

export function step(name, status, options = {}) {
  const result = stepSerial.then(() => recordStep(name, status, options));
  stepSerial = result.catch(() => false);
  return result;
}

export async function finishTrace(outcome, summary = {}) {
  if (!['completed', 'aborted', 'failed', 'rehearsal_ok'].includes(outcome)) return false;
  const accepted = await updateQueue(queue => {
    const trace = [...queue].reverse().find(isOpenTrace);
    if (!trace) return false;
    trace.finished = true;
    const summaryText = JSON.stringify(summary && typeof summary === 'object' ? summary : {});
    trace.events.push({
      id: crypto.randomUUID(),
      action: 'trace_finish',
      payload: { outcome, summary: new TextEncoder().encode(summaryText).byteLength <= MAX_SUMMARY_BYTES ? JSON.parse(summaryText) : {} },
    });
    return true;
  });
  if (accepted) void flushTraceQueue();
  return accepted;
}
