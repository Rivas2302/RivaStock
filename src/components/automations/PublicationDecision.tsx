import {useState} from 'react';
import {facebookRpc,type FacebookDelivery} from '../../lib/facebookPublications';

export default function PublicationDecision({delivery,onRefresh}:{delivery:FacebookDelivery;onRefresh:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[checked,setChecked]=useState(false),[url,setUrl]=useState('');
  const [fields,setFields]=useState<Record<string,string>>({});
  const issue=delivery.issue;
  const marketplace=delivery.destination.mechanism==='marketplace';
  const sale=issue?.kind==='group_sale_required'||issue?.kind==='group_sale_fields';
  const button='rounded-lg border border-slate-400 px-3 py-3 text-sm font-semibold disabled:opacity-50';
  const input='mt-1 w-full min-w-0 rounded-lg border border-slate-400 bg-white p-3 dark:bg-slate-900';
  async function resolve(decision:string){
    if(busy||!checked)return;setBusy(true);setError('');
    try{await facebookRpc('resolve_facebook_delivery',{p_delivery:delivery.id,p_decision:decision,p_url:decision==='existing'?url.trim():null,p_fields:fields});await onRefresh();}
    catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  return <section aria-label="Resolver destino" className="min-w-0 space-y-3 rounded-xl border border-amber-400 p-3">
    <h5 className="font-bold">{marketplace?'Resolver anuncios anteriores':sale?'Aprobar formulario de venta':'Revisión del formulario necesaria'}</h5>
    {!marketplace&&!sale&&issue?.message&&<p className="break-words">{issue.message}</p>}
    {marketplace&&<><p>Las coincidencias de título son candidatos, no identifican el producto. Un anuncio vendido o agotado seguirá en ese estado: vincularlo no lo reactiva.</p>
      {issue?.candidates?.map((candidate,index)=><div key={index} className="min-w-0 rounded-lg bg-slate-100 p-3 dark:bg-slate-900"><p className="break-words font-semibold">{candidate.title}</p><p className="whitespace-pre-wrap break-words">{candidate.summary}</p><p>Estado observado: {candidate.status||'No disponible'}</p>{candidate.url&&/^https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/?$/.test(candidate.url)?<div className="flex flex-wrap gap-3"><a className="underline" href={candidate.url} target="_blank" rel="noopener noreferrer">Consultar candidato</a><button className={button} disabled={busy} onClick={()=>{setUrl(candidate.url!);setChecked(false);}}>Elegir este anuncio</button></div>:<p className="text-xs">Facebook no expuso un enlace público en esta tarjeta. Revisá el anuncio y copiá su enlace para vincularlo.</p>}</div>)}
      <label className="block">Enlace del anuncio que verificaste<input className={input} type="url" value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://www.facebook.com/marketplace/item/…"/></label><p className="text-xs">Para aprobar una publicación nueva, dejá vacío el enlace.</p>
    </>}
    {sale&&<><p>Se creará un artículo en venta en este grupo, en lugar de una publicación independiente de texto y fotos. Usará el título, precio, estado, descripción, ubicación y fotos ya aprobados. No se enviará si no se puede verificar el destino.</p>
      {issue?.fields?.map(field=><label key={field.label} className="block break-words">{field.label}{field.supported===false?<p>Este control requiere un formato que la integración todavía no admite. No se enviará automáticamente.</p>:field.options?<select className={input} value={fields[field.label]||''} onChange={event=>setFields({...fields,[field.label]:event.target.value})}><option value="">Elegí una opción</option>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:<input className={input} value={fields[field.label]||''} maxLength={1000} onChange={event=>setFields({...fields,[field.label]:event.target.value})}/>}</label>)}
    </>}
    {(marketplace||sale)&&<><label className="flex items-start gap-3"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={checked} onChange={event=>setChecked(event.target.checked)}/>Revisé el contenido aprobado, el destino y los anuncios anteriores. Confirmo explícitamente mi decisión para este destino.</label><div className="flex flex-wrap gap-2">
      {marketplace?<><button className={button} disabled={busy||!checked||!/^https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/?$/.test(url.trim())} onClick={()=>void resolve('existing')}>Vincular anuncio existente</button><button className={button} disabled={busy||!checked||Boolean(url.trim())} onClick={()=>void resolve('new')}>Aprobar una publicación nueva</button></>:<button className={button} disabled={busy||!checked||issue?.fields?.some(field=>field.supported===false||!fields[field.label])} onClick={()=>void resolve('group_sale')}>Aprobar artículo en venta y continuar</button>}
    </div><p className="text-xs">Se registrará esta decisión y solo se recuperará este destino. Los resultados exitosos y desconocidos no se repiten.</p></>}
    {busy&&<p role="status">Guardando decisión…</p>}{error&&<p role="alert" className="text-rose-600">{error}</p>}
  </section>;
}
