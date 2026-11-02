import {createClient} from '@supabase/supabase-js';
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const TRACE_BUCKET='automation-traces';
const TRACE_FIELDS='id,user_id,delivery_id,attempt_id,mode,mechanism,extension_version,started_at,finished_at,outcome,summary';
const STEP_FIELDS='id,trace_id,seq,step,status,elapsed_ms,dom_summary,screenshot_path,note,created_at';

export function parseLimit(args) {
  if(args.includes('--help')||args.includes('-h'))return null;
  const index=args.findIndex(arg=>arg==='--limit'||arg==='-n');
  const inline=args.find(arg=>arg.startsWith('--limit='));
  const raw=inline?.slice('--limit='.length)??(index>=0?args[index+1]:'25');
  const value=Number(raw);
  if(!Number.isInteger(value)||value<1||value>500)throw new Error('El límite debe ser un entero entre 1 y 500.');
  return value;
}

function requiredEnv(primary,alternate) {
  const value=process.env[primary]??(alternate?process.env[alternate]:undefined);
  if(!value?.trim())throw new Error(`Falta la variable de entorno ${primary}${alternate?` (o ${alternate})`:''}.`);
  return value.trim();
}

async function signedScreenshots(client,traceIds,steps,useEdgeFunction) {
  const result=new Map();
  for(const traceId of traceIds) {
    const trace=TRACE_BY_ID.get(traceId);
    const traceSteps=steps.filter(step=>step.trace_id===traceId&&step.screenshot_path);
    if(!traceSteps.length)continue;
    if(traceSteps.some(step=>!isTraceScreenshotPath(trace,step)))throw new Error(`La traza ${traceId} tiene una ruta de captura inválida.`);
    let urls=[];
    if(useEdgeFunction) {
      const {data,error}=await client.functions.invoke('automation',{body:{action:'trace_signed_urls',trace_id:traceId}});
      if(error||!Array.isArray(data?.screenshots))throw new Error('No se pudieron firmar capturas con la sesión del dueño.');
      urls=data.screenshots;
    } else {
      const paths=traceSteps.map(step=>step.screenshot_path);
      const entries=[];
      for(let offset=0;offset<paths.length;offset+=100) {
        const {data,error}=await client.storage.from(TRACE_BUCKET).createSignedUrls(paths.slice(offset,offset+100),300);
        if(error||!data)throw new Error('No se pudieron firmar capturas con la service role.');
        entries.push(...data);
      }
      urls=entries.map(entry=>({path:entry.path,url:entry.signedUrl}));
    }
    for(const entry of urls) {
      const step=entry.seq?traceSteps.find(item=>item.seq===entry.seq):traceSteps.find(item=>item.screenshot_path===entry.path);
      if(!step||typeof entry.url!=='string')continue;
      const response=await fetch(entry.url);
      if(!response.ok)throw new Error(`No se pudo descargar la captura del paso ${step.seq}.`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(!bytes.length)throw new Error(`La captura del paso ${step.seq} está vacía.`);
      const file=`${String(step.seq).padStart(4,'0')}.jpg`;
      const directory=join(OUTPUT_DIR,traceId);
      await mkdir(directory,{recursive:true});
      await writeFile(join(directory,file),bytes,{flag:'wx'}).catch(async error=>{
        if(error.code!=='EEXIST')throw error;
        await writeFile(join(directory,file),bytes);
      });
      if(!result.has(traceId))result.set(traceId,[]);
      result.get(traceId).push({seq:step.seq,file:`${traceId}/${file}`});
    }
  }
  return result;
}

const TRACE_BY_ID=new Map();
const OUTPUT_DIR=join(process.env.USERPROFILE??homedir(),'rivastock-traces',new Date().toISOString().replace(/[:.]/g,'-'));

function isTraceScreenshotPath(trace,step) {
  const segments=String(step.screenshot_path).split('/');
  return segments.length===3&&segments[0]===trace.user_id&&segments[1]===trace.id
    &&segments[2]===`${step.seq}.jpg`;
}

async function run() {
  const limit=parseLimit(process.argv.slice(2));
  if(limit===null) {
    console.log('Usage: npm run dump:automation-traces -- [--limit N]\nSet SUPABASE_USER_JWT for owner-scoped access, or SUPABASE_SERVICE_ROLE_KEY plus SUPABASE_OWNER_ID. Keys must remain in the process environment.');
    return;
  }
  const url=requiredEnv('SUPABASE_URL','VITE_SUPABASE_URL');
  const userJwt=process.env.SUPABASE_USER_JWT?.trim();
  const serviceRole=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(Boolean(userJwt)===Boolean(serviceRole))throw new Error('Configurá exactamente una de SUPABASE_USER_JWT o SUPABASE_SERVICE_ROLE_KEY.');
  const ownerId=serviceRole?requiredEnv('SUPABASE_OWNER_ID'):null;
  if(ownerId&&!/^[0-9a-f-]{36}$/i.test(ownerId))throw new Error('SUPABASE_OWNER_ID debe ser un UUID.');
  const anonKey=serviceRole?null:requiredEnv('SUPABASE_ANON_KEY','VITE_SUPABASE_ANON_KEY');
  const client=createClient(url,serviceRole??anonKey,{auth:{autoRefreshToken:false,persistSession:false},global:userJwt?{headers:{Authorization:`Bearer ${userJwt}`}}:undefined});
  let traceQuery=client.from('fb_run_traces').select(TRACE_FIELDS);
  if(ownerId)traceQuery=traceQuery.eq('user_id',ownerId);
  const {data:traces,error:traceError}=await traceQuery.order('started_at',{ascending:false}).limit(limit);
  if(traceError)throw new Error(`No se pudieron consultar las trazas (código ${traceError.code??'desconocido'}).`);
  const selected=traces??[];
  TRACE_BY_ID.clear();
  for(const trace of selected)TRACE_BY_ID.set(trace.id,trace);
  const traceIds=selected.map(trace=>trace.id);
  await mkdir(OUTPUT_DIR,{recursive:true});
  if(!traceIds.length) {
    await writeFile(join(OUTPUT_DIR,'index.json'),JSON.stringify({exportedAt:new Date().toISOString(),traces:[]},null,2)+'\n');
    console.log(`No hay trazas. Índice guardado en ${OUTPUT_DIR}`);
    return;
  }
  const stepRows=[];
  for(let offset=0;;offset+=1000) {
    const {data,error}=await client.from('fb_trace_steps').select(STEP_FIELDS).in('trace_id',traceIds)
      .order('trace_id',{ascending:true}).order('seq',{ascending:true}).range(offset,offset+999);
    if(error)throw new Error(`No se pudieron consultar los pasos (código ${error.code??'desconocido'}).`);
    stepRows.push(...(data??[]));
    if((data??[]).length<1000)break;
  }
  const {data:rehearsals,error:rehearsalError}=await client.from('fb_rehearsals')
    .select('id,status,created_at,started_at,finished_at,trace_id,error_step,content,destination,result').in('trace_id',traceIds);
  if(rehearsalError&&rehearsalError.code!=='42P01'&&rehearsalError.code!=='PGRST205')throw new Error(`No se pudieron consultar los ensayos (código ${rehearsalError.code??'desconocido'}).`);
  const allSteps=stepRows;
  const screenshots=await signedScreenshots(client,traceIds,allSteps,!serviceRole);
  const index=[];
  for(const trace of selected) {
    const traceSteps=allSteps.filter(step=>step.trace_id===trace.id);
    const files=screenshots.get(trace.id)??[];
    const {user_id,...publicTrace}=trace;
    const payload={...publicTrace,steps:traceSteps.map(({screenshot_path,...step})=>step),screenshots:files,
      rehearsal:(rehearsals??[]).find(item=>item.trace_id===trace.id)??null};
    await writeFile(join(OUTPUT_DIR,`${trace.id}.json`),JSON.stringify(payload,null,2)+'\n');
    index.push({id:trace.id,file:`${trace.id}.json`,mode:trace.mode,outcome:trace.outcome,started_at:trace.started_at,step_count:traceSteps.length,screenshot_count:files.length});
  }
  await writeFile(join(OUTPUT_DIR,'index.json'),JSON.stringify({exportedAt:new Date().toISOString(),traces:index},null,2)+'\n');
  console.log(`Exportadas ${index.length} trazas y ${index.reduce((total,item)=>total+item.screenshot_count,0)} capturas a ${OUTPUT_DIR}`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  run().catch(error=>{console.error(`Trace export failed: ${error.message}`);process.exitCode=1;});
}
