import {useEffect,useRef,useState} from 'react';
import {api} from './messaging';
import {DateFilter,businessDate} from './DateFilters';
type Row=Record<string,any>;
const labels:Record<string,string>={'auth.login':'Вход в CRM','user.create':'Добавлен сотрудник','customer.create':'Создан клиент','lead.create':'Создан лид','lead.stage':'Изменён этап','lead.update':'Изменена карточка','lead.assign':'Назначен ответственный','lead.transfer':'Передан лид','lead.comment':'Добавлен комментарий','lead.file':'Прикреплён файл','order.create':'Создан заказ','order.status':'Изменён статус заказа','message.send':'Отправлено сообщение','message.media':'Отправлено вложение'};
const stages:Record<string,string>={new:'Новые',working:'В работе',payment:'Ожидает оплаты',success:'Успешно',refusal:'Отказ',pending:'Ожидает оплаты',paid:'Оплачен',cancelled:'Отменён'};
function detail(row:Row){
 if(row.action==='lead.stage'||row.action==='order.status')return row.detail.replace(/\b(new|working|payment|success|refusal|pending|paid|cancelled)\b/g,(v:string)=>stages[v]);
 if(row.action.endsWith('.create'))return `№ ${row.detail}`;
 return row.detail;
}
export function RecentActions({users}:{users:Row[]}){
 const [start,setStart]=useState(()=>businessDate()),[end,setEnd]=useState(()=>businessDate()),[actor,setActor]=useState(''),[action,setAction]=useState('');
 const [rows,setRows]=useState<Row[]>([]),[cursor,setCursor]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),request=useRef(0);
 const query=new URLSearchParams({start,end,...(actor?{actor_id:actor}:{}),...(action?{action}:{})}).toString();
 useEffect(()=>{
  const gen=++generation.current;let alive=true;setRows([]);setCursor(null);
  const load=async()=>{const id=++request.current;setBusy(true);try{const data=await api('/audit?'+query);if(alive&&gen===generation.current&&id===request.current){setRows(data.items);setCursor(data.next_cursor);setError('');}}catch(e:any){if(alive)setError(e.message);}finally{if(alive&&id===request.current)setBusy(false);}};
  void load();window.addEventListener('aen-change',load);return()=>{alive=false;window.removeEventListener('aen-change',load);};
 },[query]);
 const more=async()=>{if(!cursor||busy)return;const gen=generation.current,id=++request.current;setBusy(true);try{const data=await api(`/audit?${query}&before=${cursor}`);if(gen===generation.current&&id===request.current){setRows(old=>[...old,...data.items]);setCursor(data.next_cursor);setError('');}}catch(e:any){if(gen===generation.current)setError(e.message);}finally{if(gen===generation.current&&id===request.current)setBusy(false);}};
 return <section className="recent-actions"><div className="workspace-filters"><DateFilter start={start} end={end} onChange={(a,b)=>{setStart(a);setEnd(b);}}/><select aria-label="Сотрудник журнала" value={actor} onChange={e=>setActor(e.target.value)}><option value="">Все сотрудники</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><select aria-label="Тип действия" value={action} onChange={e=>setAction(e.target.value)}><option value="">Все действия</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></div>{error&&<div className="error" role="alert">{error}</div>}<div className="panel tablewrap audit-table"><table><thead><tr><th>Время · Казахстан</th><th>Сотрудник</th><th>Действие</th><th>Подробности</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><time dateTime={r.created_at}>{new Date(r.created_at).toLocaleString('ru-RU',{timeZone:'Asia/Almaty',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time></td><td><b>{r.actor}</b></td><td><span className="customer-channel">{labels[r.action]||r.action}</span></td><td className="audit-detail">{detail(r)}</td></tr>)}</tbody></table>{!rows.length&&<div className="empty">{busy?'Загружаем действия…':'За выбранный период действий нет'}</div>}</div>{cursor&&<button className="secondary" onClick={more} disabled={busy}>{busy?'Загружаем…':'Показать ещё'}</button>}<p className="muted">Журнал обновляется автоматически. Отправка сообщений и входы фиксируются с момента этого обновления.</p></section>;
}
