import {DateFilter,businessDate} from './DateFilters';
import {useEffect,useRef,useState} from 'react';
import {api} from './messaging';
export type Media={id:string;name:string;mime:string;url:string;purpose?:string;ready?:boolean;pending?:boolean};
export const accept='image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/ogg,audio/mp4,audio/wav,application/pdf';
export async function uploadFile(lead:number,file:File,purpose='chat'):Promise<Media>{
 if(file.size>16*1024*1024)throw Error('Максимальный размер файла — 16 МБ');
 const r=await fetch(`/api/leads/${lead}/files?purpose=${purpose}&name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{Authorization:'Bearer '+sessionStorage.getItem('aen_token'),'Content-Type':file.type||'application/octet-stream'},body:file});
 const data=await r.json();if(!r.ok)throw Error(data.detail||'Не удалось загрузить файл');return data;
}
export function MediaView({file}:{file:Media}){
 const [failed,setFailed]=useState(false);
 const loaded=()=>window.dispatchEvent(new Event('aen-media-ready'));
 useEffect(()=>{setFailed(false);},[file.url,file.ready]);
 if(file.ready===false&&file.pending)return <small role="status">Загружаем вложение… Оно появится автоматически.</small>;
 if(file.ready===false)return <small>Не удалось получить файл из мессенджера.</small>;
 if(failed)return <button className="text-link" onClick={()=>setFailed(false)}>Повторить загрузку файла</button>;
 return <div className="media-preview">{file.mime.startsWith('image/')?<a href={file.url} target="_blank" rel="noreferrer"><img loading="lazy" onLoad={loaded} src={file.url} alt={file.name} onError={()=>setFailed(true)}/></a>:file.mime.startsWith('video/')?<video onLoadedMetadata={loaded} controls preload="metadata" src={file.url} onError={()=>setFailed(true)}/>:file.mime.startsWith('audio/')?<audio controls preload="metadata" src={file.url} onError={()=>setFailed(true)}/>:<a href={file.url} target="_blank" rel="noreferrer">📄 {file.name}</a>}</div>;
}
export function DealFiles({lead}:{lead:number}){
 const [files,setFiles]=useState<Media[]>([]),[purpose,setPurpose]=useState('product'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const refresh=()=>api(`/leads/${lead}/files`).then(setFiles).catch(e=>setError(e.message));
 useEffect(()=>{void refresh();window.addEventListener('aen-change',refresh);return()=>window.removeEventListener('aen-change',refresh);},[lead]);
 return <section className="deal-files"><h3>Фото товара и чеки</h3><small>Внутренние файлы сделки. Клиенту автоматически не отправляются.</small><div className="file-actions"><select aria-label="Тип вложения сделки" value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="product">Фото / видео товара</option><option value="receipt">Чек об оплате</option></select><label className="secondary file-button">{busy?'Загрузка…':'＋ Файл'}<input type="file" accept={accept} disabled={busy} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setBusy(true);setError('');try{await uploadFile(lead,file,purpose);await refresh();}catch(err:any){setError(err.message);}finally{setBusy(false);}}}/></label></div>{error&&<div className="error">{error}</div>}<div className="deal-file-grid">{files.map(f=><div key={f.id}><small>{f.purpose==='receipt'?'Чек об оплате':'Товар'}</small><MediaView file={f}/></div>)}</div></section>;
}
export function useRealtime(token:string,onChange:()=>void){
 const cb=useRef(onChange);cb.current=onChange;
 const [live,setLive]=useState(false);
 useEffect(()=>{
  setLive(false);if(!token)return;
  const controller=new AbortController();let retry:number|undefined,debounce:number|undefined,stopped=false;
  const update=()=>{if(stopped)return;cb.current();window.dispatchEvent(new Event('aen-change'));};
  const run=async()=>{
   try{
    const r=await fetch('/api/events',{headers:{Authorization:'Bearer '+token},signal:controller.signal});
    if(!r.ok||!r.headers.get('content-type')?.includes('text/event-stream'))throw Error();
    if(stopped)return;setLive(true);const reader=r.body!.getReader(),decoder=new TextDecoder();let buffer='',first=true;
    while(!stopped){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let end;
     while((end=buffer.indexOf('\n\n'))>=0){const msg=buffer.slice(0,end);buffer=buffer.slice(end+2);if(msg.startsWith('data:')){
      try{const event=JSON.parse(msg.slice(5));if(!first&&event.label)window.dispatchEvent(new CustomEvent('aen-notice',{detail:event.label}));first=false;}catch{}
      // Throttle, not debounce: continuous events must not starve refresh.
      if(debounce===undefined)debounce=window.setTimeout(()=>{debounce=undefined;update();},200);
     }}
    }
   }catch{/* Retry without discarding the active screen. */}
   if(!stopped){setLive(false);retry=window.setTimeout(run,5000);}
  };
  void run();const fallback=window.setInterval(update,30000);
  return()=>{stopped=true;controller.abort();window.clearTimeout(retry);window.clearTimeout(debounce);window.clearInterval(fallback);};
 },[token]);
 return live;
}
export function Analytics({cities}:{cities:Record<string,any>[]}){
 const [start,setStart]=useState(()=>businessDate()),[end,setEnd]=useState(()=>businessDate()),[city,setCity]=useState(''),[data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let alive=true;const load=()=>api(`/analytics?start=${start}&end=${end}${city?'&city_id='+city:''}`).then(d=>{if(alive){setData(d);setError('');}}).catch(e=>{if(alive)setError(e.message);});void load();window.addEventListener('aen-change',load);return()=>{alive=false;window.removeEventListener('aen-change',load);};},[start,end,city]);
 const money=(v:number)=>(v||0).toLocaleString('ru-RU')+' ₸';
 return <div className="analytics"><div className="workspace-filters"><DateFilter start={start} end={end} onChange={(a,b)=>{setStart(a);setEnd(b);}}/><select aria-label="Город аналитики" value={city} onChange={e=>setCity(e.target.value)}><option value="">Все доступные города</option>{cities.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>{error&&<div className="error">{error}</div>}{data&&<><div className="metrics">{[['Выручка',money(data.revenue)],['Оплачено заказов',data.paid_orders],['Средний чек',money(data.average_order)],['Повторные покупатели',data.repeat_buyers],['Ждут ответа',data.unanswered],['Первый ответ, среднее',data.first_reply_minutes===null?'Нет данных':data.first_reply_minutes+' мин']].map(([k,v])=><div className="metric" key={k}><span>{k}</span><strong>{v}</strong></div>)}</div><div className="analytics-grid"><section className="panel analytics-table"><h2>Что покупают <span className="table-total">{data.products.length}</span></h2><table><thead><tr><th>Товар</th><th>Размер</th><th>Цвет</th><th>Шт.</th></tr></thead><tbody>{data.products.map((p:any,i:number)=><tr key={i}><td>{p.name}</td><td>{p.size}</td><td>{p.color}</td><td><b>{p.quantity}</b></td></tr>)}</tbody></table>{!data.products.length&&<div className="analytics-empty">Пока нет оплаченных товаров</div>}</section><section className="panel"><h2>Источники обращений</h2>{Object.entries(data.channels).map(([name,v]:[string,any])=><div className="channel-stat" key={name}><b>{name}</b><span>{v.leads} обращений · {v.won} успешных</span><progress value={v.won} max={v.leads||1}/></div>)}</section><section className="panel analytics-table"><h2>Покупатели <span className="table-total">{data.buyers.length}</span></h2><table><thead><tr><th>Клиент</th><th>Покупок</th><th>Сумма</th></tr></thead><tbody>{data.buyers.map((b:any,i:number)=><tr key={i}><td>{b.name}</td><td>{b.orders}</td><td>{money(b.total)}</td></tr>)}</tbody></table>{!data.buyers.length&&<div className="analytics-empty">Покупок за этот период пока нет</div>}</section></div></>}</div>;
}
