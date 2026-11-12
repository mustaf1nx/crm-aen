import {MediaView,uploadFile,accept,Media} from './enhancements';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';

export type Conversation={id:number;channel?:string;lead_id:number;customer_name:string;city_id:number;last_message:string;message_count:number;unread_count:number;last_incoming_id:number;last_direction?:string;last_at?:string};
type Message={id:number;direction:string;text:string;created_at:string;attachments?:Media[]};
export const api=async(path:string,method='GET',body?:Record<string,any>)=>{
 const token=sessionStorage.getItem('aen_token');
 const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const data=await r.json().catch(()=>({}));
 if(!r.ok){const error=new Error(typeof data.detail==='string'?data.detail:'Ошибка запроса') as Error&{status:number};error.status=r.status;throw error;}
 return data;
};

export function useInbox(token:string){
 const [conversations,setConversations]=useState<Conversation[]>([]);
 const [notice,setNotice]=useState<Conversation|null>(null);
 const [error,setError]=useState('');
 const [notifications,setNotifications]=useState(typeof Notification!=='undefined'?Notification.permission:'unsupported');
 const seen=useRef<Map<number,number>|null>(null);
 const generation=useRef(0);
 const pending=useRef(false);
 const refresh=useCallback(async()=>{
  if(!token||pending.current)return;
  pending.current=true;const gen=generation.current;
  try{
   const list:Conversation[]=await api('/inbox/conversations');
   if(gen!==generation.current)return;
   const fresh=seen.current&&list.find(c=>c.last_incoming_id>(seen.current!.get(c.id)||0));
   seen.current=new Map(list.map(c=>[c.id,c.last_incoming_id]));
   setConversations(list);setError('');
   if(fresh){
    setNotice(fresh);
    if(document.visibilityState==='hidden'&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
     try{const n=new Notification('AEN · Новое сообщение',{body:'Откройте CRM, чтобы прочитать сообщение.',tag:'aen-inbox'});n.onclick=()=>{window.focus();setNotice(fresh);n.close();};}catch{/* Browser may require a service worker. In-app alerts remain available. */}
    }
   }
  }catch(e:any){if(gen===generation.current)setError(e.message);}
  finally{pending.current=false;}
 },[token]);
 useEffect(()=>{
  generation.current++;seen.current=null;setConversations([]);setNotice(null);
  if(!token)return;
  void refresh();const interval=window.setInterval(refresh,30000);
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);window.addEventListener('aen-change',refresh);
  return()=>{generation.current++;window.clearInterval(interval);document.removeEventListener('visibilitychange',visible);window.removeEventListener('aen-change',refresh);};
 },[token,refresh]);
 const unread=conversations.reduce((n,c)=>n+c.unread_count,0);
 useEffect(()=>{document.title=(unread?`(${unread}) `:'')+'AEN CRM';return()=>{document.title='AEN CRM';};},[unread]);
 const enableNotifications=async()=>{
  if(typeof Notification==='undefined')return;
  try{setNotifications(await Notification.requestPermission());}catch{setNotifications('unsupported');}
 };
 return {conversations,unread,notice,setNotice,error,refresh,notifications,enableNotifications};
}

export function ChatPanel({conversation,onRead}:{conversation:Conversation;onRead:()=>Promise<void>}){
 const [messages,setMessages]=useState<Message[]>([]);
 const [reply,setReply]=useState('');
 const [file,setFile]=useState<File|null>(null),[uploaded,setUploaded]=useState<Media|null>(null),[manualUnread,setManualUnread]=useState(false);
 const unreadRef=useRef(false);
 const draftKey='aen-draft-'+(sessionStorage.getItem('aen_token')||'').slice(-16)+'-'+conversation.id;
 useEffect(()=>{setReply(sessionStorage.getItem(draftKey)||'');},[draftKey]);
 const editReply=(v:string)=>{setReply(v);sessionStorage.setItem(draftKey,v);};
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [more,setMore]=useState(false),[olderBusy,setOlderBusy]=useState(false);
 const merge=(rows:Message[])=>setMessages(old=>Array.from(new Map([...old,...rows].map(m=>[m.id,m])).values()).sort((a,b)=>a.id-b.id));
 const [sending,setSending]=useState(false);
 const bottom=useRef<HTMLDivElement>(null);
 const restoreScroll=useRef<{height:number;top:number}|null>(null);
 const scrollBox=useRef<HTMLDivElement>(null);const atBottom=useRef(true);
 useEffect(()=>{const loaded=()=>{if(atBottom.current)bottom.current?.scrollIntoView({block:'nearest'});};window.addEventListener('aen-media-ready',loaded);return()=>window.removeEventListener('aen-media-ready',loaded);},[]);
 const refreshRef=useRef<()=>Promise<void>>(async()=>{});
 const onReadRef=useRef(onRead);onReadRef.current=onRead;
 useEffect(()=>{
  let alive=true,busy=false,lastRead=0,initial=true;
  const refresh=async()=>{
   if(busy)return;busy=true;
   try{
    const rows:Message[]=await api(`/inbox/conversations/${conversation.id}/messages`);
    if(!alive)return;
    merge(rows);if(initial){setMore(rows.length===200);initial=false;}setLoading(false);setError('');
    const latest=rows.at(-1)?.id||0;
    if(!unreadRef.current&&document.visibilityState==='visible'&&atBottom.current&&latest>lastRead){
     await api(`/inbox/conversations/${conversation.id}/read`,'POST',{last_message_id:latest});
     lastRead=latest;if(alive)await onReadRef.current();
    }
   }catch(e:any){if(alive){setError(e.message);setLoading(false);}}
   finally{busy=false;}
  };
  refreshRef.current=refresh;void refresh();
  const interval=window.setInterval(refresh,30000);
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);window.addEventListener('aen-change',visible);
  return()=>{alive=false;window.clearInterval(interval);document.removeEventListener('visibilitychange',visible);window.removeEventListener('aen-change',visible);};
 },[conversation.id]);
 useLayoutEffect(()=>{const box=scrollBox.current,old=restoreScroll.current;if(box&&old){box.scrollTop=old.top+box.scrollHeight-old.height;restoreScroll.current=null;}},[messages]);
 useEffect(()=>{if(atBottom.current)bottom.current?.scrollIntoView({block:'nearest'});},[messages.length]);
 const send=async(e:React.FormEvent)=>{
  e.preventDefault();if(sending||(!reply.trim()&&!file))return;
  setSending(true);setError('');
  try{
   if(file){const asset=uploaded||await uploadFile(conversation.lead_id,file);setUploaded(asset);await api(`/inbox/conversations/${conversation.id}/media`,'POST',{asset_id:asset.id,text:''});setFile(null);setUploaded(null);}
   if(reply.trim())await api(`/inbox/conversations/${conversation.id}/reply`,'POST',{text:reply.trim()});
   editReply('');unreadRef.current=false;setManualUnread(false);await refreshRef.current();await onReadRef.current();
  }
  catch(e:any){setError(e.message);}finally{setSending(false);}
 };
 return <div className="chat-content">
  <div className="chat-tools"><button className="text-link" onClick={async()=>{try{unreadRef.current=true;await api(`/inbox/conversations/${conversation.id}/unread`,'POST',{});setManualUnread(true);await onReadRef.current();}catch(e:any){unreadRef.current=false;setError(e.message);}}}>{manualUnread?'Отмечен непрочитанным':'Отметить непрочитанным'}</button><span>Личный статус в CRM</span></div><p className="muted">Всего сообщений: {conversation.message_count} · {conversation.channel==='whatsapp'?'WhatsApp':'Instagram Direct'}</p>
  <div ref={scrollBox} onScroll={()=>{const el=scrollBox.current;if(el){const wasBottom=atBottom.current;atBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<70;if(!wasBottom&&atBottom.current)void refreshRef.current();}}} className="chat-messages" role="log" aria-label="Переписка">
   {more&&<button className="secondary" disabled={olderBusy} onClick={async()=>{setOlderBusy(true);try{const rows=await api(`/inbox/conversations/${conversation.id}/messages?before_id=${messages[0]?.id||0}`);atBottom.current=false;const box=scrollBox.current;if(box)restoreScroll.current={height:box.scrollHeight,top:box.scrollTop};merge(rows);setMore(rows.length===200);}catch(e:any){setError(e.message);}finally{setOlderBusy(false);}}}>{olderBusy?'Загрузка…':'Ранние сообщения'}</button>}
   {loading&&<p>Загрузка переписки…</p>}
   {!loading&&!messages.length&&!error&&<p>Сообщений пока нет.</p>}
   {messages.map(m=><div key={m.id} className={'bubble '+(m.direction==='out'?'bubble-out':'')}><small>{m.direction==='out'?'Менеджер':conversation.channel==='whatsapp'?'WhatsApp':'Instagram'}</small><div>{m.text}</div>{m.attachments?.map(a=><MediaView key={a.id} file={a}/>)}<time>{new Date(m.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div>)}
   <div ref={bottom}/>
  </div>
  {error&&<div className="error" role="alert">{error}</div>}
  <div className="quick-replies"><select aria-label="Быстрый ответ" value="" onChange={e=>editReply(e.target.value)}><option value="">Быстрые ответы…</option>{['Здравствуйте! Какой размер и цвет вас интересует?','Сейчас проверю наличие и отправлю фото товара.','Спасибо за заказ! Пришлите, пожалуйста, чек об оплате.','Подскажите город и удобный способ получения: доставка или самовывоз.'].map(t=><option key={t}>{t}</option>)}</select><label className="secondary file-button">＋ Фото / аудио / видео<input aria-label="Прикрепить файл в чат" type="file" accept={accept} disabled={sending} onChange={e=>{setFile(e.target.files?.[0]||null);setUploaded(null);e.target.value='';}}/></label></div>
  {file&&<div className="pending-file">{file.name} · {(file.size/1024/1024).toFixed(1)} МБ <button onClick={()=>{setFile(null);setUploaded(null);}} disabled={sending}>Убрать</button></div>}
  <form className="chat-compose" onSubmit={send}><textarea aria-label="Ответ клиенту" placeholder="Напишите сообщение… Ctrl+Enter — отправить" value={reply} maxLength={2000} onChange={e=>editReply(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} disabled={sending}/><button className="primary" disabled={sending||loading||(!reply.trim()&&!file)}>{sending?'Отправка…':'Отправить'}</button></form>
  <small className="composer-hint">До 16 МБ · Файл и текст отправляются отдельными сообщениями</small>
 </div>;
}

export function ChatWindow({conversation,onClose,onRead}:{conversation:Conversation;onClose:()=>void;onRead:()=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
 return <dialog className="conversation-dialog" ref={dialog} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="conversation-dialog-inner"><div className="dialog-head"><div><h2>{conversation.customer_name}</h2><small>Лид #{conversation.lead_id} · Переписка</small></div><button className="iconbtn" aria-label="Закрыть переписку" onClick={onClose}>✕</button></div><ChatPanel key={conversation.id} conversation={conversation} onRead={onRead}/></div>
 </dialog>;
}
