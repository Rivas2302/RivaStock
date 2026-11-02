import {useState} from 'react';
import {supabase} from '../../lib/supabase';
import {traceOutcomeLabel,traceStepDecision,traceStepLabel,traceStepStatusLabel,type AutomationTrace,type AutomationTraceScreenshot,type AutomationTraceStep} from '../../lib/automationTraces';

interface Props {
  traceId?:string|null;
  attemptId?:string;
  deliveryId?:string;
}

export default function ExecutionTraceViewer({traceId,attemptId,deliveryId}:Props) {
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [trace,setTrace]=useState<AutomationTrace|null>(null);
  const [steps,setSteps]=useState<AutomationTraceStep[]>([]);
  const [screenshots,setScreenshots]=useState<AutomationTraceScreenshot[]>([]);
  const [activeImage,setActiveImage]=useState<string|null>(null);

  async function loadTrace() {
    setLoading(true);setError('');
    try {
      let query=supabase.from('fb_run_traces').select('id,delivery_id,attempt_id,mode,mechanism,extension_version,started_at,finished_at,outcome,summary');
      if(traceId)query=query.eq('id',traceId);
      else if(attemptId)query=query.eq('attempt_id',attemptId);
      else if(deliveryId)query=query.eq('delivery_id',deliveryId);
      else throw new Error('Falta el identificador de la ejecución.');
      const {data:traceRows,error:traceError}=await query.order('started_at',{ascending:false}).limit(1);
      if(traceError)throw traceError;
      const selected=(traceRows??[])[0] as AutomationTrace|undefined;
      if(!selected){setTrace(null);setSteps([]);setScreenshots([]);return;}
      const {data:stepRows,error:stepError}=await supabase.from('fb_trace_steps')
        .select('id,trace_id,seq,step,status,elapsed_ms,dom_summary,screenshot_path,note,created_at')
        .eq('trace_id',selected.id).order('seq',{ascending:true});
      if(stepError)throw stepError;
      const nextSteps=(stepRows??[]) as AutomationTraceStep[];
      let nextScreenshots:AutomationTraceScreenshot[]=[];
      if(nextSteps.some(item=>item.screenshot_path)) {
        const {data,error:signedError}=await supabase.functions.invoke('automation',{body:{action:'trace_signed_urls',trace_id:selected.id}});
        if(signedError||!Array.isArray(data?.screenshots))throw signedError??new Error('No se pudieron firmar las capturas.');
        nextScreenshots=(data.screenshots as AutomationTraceScreenshot[]).filter(item=>Number.isInteger(item.seq)&&typeof item.url==='string');
      }
      setTrace(selected);setSteps(nextSteps);setScreenshots(nextScreenshots);
    } catch {
      setError('No se pudo cargar la ejecución. Revisá tu conexión y los permisos de Conocimientos.');
    } finally {setLoading(false);}
  }

  function toggle() {
    const next=!open;setOpen(next);
    if(next)void loadTrace();
  }

  return <div className="space-y-2">
    <button type="button" aria-expanded={open} onClick={toggle} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-600">
      {open?'Ocultar ejecución':'Ver ejecución'}
    </button>
    {open&&<section aria-label="Línea de tiempo de ejecución" className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
      {loading&&<p role="status">Cargando ejecución…</p>}
      {error&&<p role="alert" className="text-rose-600 dark:text-rose-400">{error}</p>}
      {!loading&&!error&&!trace&&<p className="text-slate-500">Todavía no hay una traza para esta ejecución.</p>}
      {trace&&<>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="font-bold">{traceOutcomeLabel(trace.outcome)} · {trace.mode==='rehearsal'?'Ensayo':'Ejecución'}</p><p className="mt-0.5 text-slate-500">{new Date(trace.started_at).toLocaleString('es-AR')} · Extensión {trace.extension_version}</p></div>
          <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold dark:bg-slate-800">{trace.mechanism==='marketplace'?'Marketplace':'Grupo'}</span>
        </header>
        {trace.summary&&Object.keys(trace.summary).length>0&&<p className="whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">{typeof trace.summary.reason==='string'?trace.summary.reason:''}</p>}
        <ol className="space-y-2 border-l border-slate-200 pl-3 dark:border-slate-700">
          {steps.map(step=>{
            const image=screenshots.find(item=>item.seq===step.seq)?.url;
            const decision=traceStepDecision(step);
            return <li key={step.id} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-semibold">{step.seq}. {traceStepLabel(step.step)}</span>
                <span className="text-slate-500">{traceStepStatusLabel(step.status)} · {(step.elapsed_ms/1000).toLocaleString('es-AR',{maximumFractionDigits:2})} s</span>
              </div>
              {step.note&&<p className="break-words text-slate-600 dark:text-slate-300">{step.note}</p>}
              {decision!==null&&<p className="break-words rounded-lg bg-indigo-50 p-2 dark:bg-indigo-950/40"><strong>Decisión de IA: </strong>{typeof decision==='string'?decision:JSON.stringify(decision)}</p>}
              {image&&<button type="button" onClick={()=>setActiveImage(image)} aria-label={`Ampliar captura del paso ${step.seq}`} className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"><img src={image} alt={`Captura del paso ${step.seq}: ${traceStepLabel(step.step)}`} className="max-h-44 max-w-full object-contain"/></button>}
            </li>;
          })}
          {!steps.length&&<li className="text-slate-500">La traza todavía no tiene pasos.</li>}
        </ol>
      </>}
    </section>}
    {activeImage&&<div role="dialog" aria-modal="true" aria-label="Captura ampliada" onMouseDown={event=>{if(event.target===event.currentTarget)setActiveImage(null);}} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="max-h-full max-w-full space-y-2"><button type="button" onClick={()=>setActiveImage(null)} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900">Cerrar captura</button><img src={activeImage} alt="Captura ampliada de la ejecución" className="max-h-[85vh] max-w-[95vw] object-contain"/></div>
    </div>}
  </div>;
}
