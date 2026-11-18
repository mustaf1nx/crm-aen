import {QuickReplies} from './QuickReplies';
import {MediaView,uploadFile,accept,Media} from './enhancements';
import {Fragment,useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Paperclip,Sparkles} from 'lucide-react';

export type Conversation={can_reply?:boolean;manager_id?:number;manager_name?:string;id:number;channel?:string;lead_id:number;customer_name:string;city_id:number;last_message:string;message_count:number;unread_count:number;last_incoming_id:number;last_direction?:string;last_message_id?:number;last_at?:string};
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
 const pending=useRef(false),queued=useRef(false);
 const refreshLatest=useRef<()=>Promise<void>>(async()=>{});
 const refresh=useCallback(async()=>{
  if(!token)return;
  if(pending.current){queued.current=true;return;}
  pending.current=true;const gen=generation.current;
  try{
   const list:Conversation[]=await api('/inbox/conversations');
   if(gen!==generation.current)return;
   const fresh=seen.current&&list.find(c=>c.last_incoming_id>(seen.current!.get(c.id)||0));
   seen.current=new Map(list.map(c=>[c.id,c.last_incoming_id]));
   setConversations(list);setNotice(old=>old&&list.some(c=>c.id===old.id)?old:null);setError('');
   if(fresh){
    setNotice(fresh);
    if(document.visibilityState==='hidden'&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
     try{const n=new Notification('AEN · Новое сообщение',{body:'Откройте CRM, чтобы прочитать сообщение.',tag:'aen-inbox'});n.onclick=()=>{window.focus();setNotice(fresh);n.close();};}catch{/* Browser may require a service worker. In-app alerts remain available. */}
    }
   }
  }catch(e:any){if(gen===generation.current)setError(e.message);}
  finally{pending.current=false;if(queued.current){queued.current=false;void refreshLatest.current();}}
 },[token]);
 refreshLatest.current=refresh;
 useEffect(()=>{
  generation.current++;seen.current=null;setConversations([]);setNotice(null);
  if(!token)return;
  void refresh();const interval=window.setInterval(refresh,30000);
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);window.addEventListener('aen-change',refresh);
  return()=>{generation.current++;window.clearInterval(interval);document.removeEventListener('visibilitychange',visible);window.removeEventListener('aen-change',refresh);};
 },[token,refresh]);
 const unread=conversations.reduce((n,c)=>n+c.unread_count,0);
 useEffect(()=>{document.title=(unread?`(${unread}) `:'')+'AEN Connect';return()=>{document.title='AEN Connect';};},[unread]);
 const enableNotifications=async()=>{
  if(typeof Notification==='undefined')return;
  try{setNotifications(await Notification.requestPermission());}catch{setNotifications('unsupported');}
 };
 return {conversations,unread,notice,setNotice,error,refresh,notifications,enableNotifications};
}

export function ChatPanel({conversation,onRead}:{conversation:Conversation;onRead:()=>Promise<void>}){
 const [messages,setMessages]=useState<Message[]>([]);
 const [reply,setReply]=useState('');
 const composer=useRef<HTMLTextAreaElement>(null);
 useLayoutEffect(()=>{
  const el=composer.current;if(!el)return;
  let width=el.clientWidth;
  const resize=()=>{el.style.height='0px';el.style.height=Math.min(104,Math.max(42,el.scrollHeight+2))+'px'};
  resize();
  const observer=new ResizeObserver(()=>{if(el.clientWidth!==width){width=el.clientWidth;resize()}});
  observer.observe(el);return()=>observer.disconnect();
 },[reply]);
 const [aiBusy,setAiBusy]=useState(false),[aiDraft,setAiDraft]=useState('');
 const makeDraft=async()=>{if(aiBusy)return;setAiBusy(true);setError('');setAiDraft('');try{const data=await api(`/inbox/conversations/${conversation.id}/ai-draft`,'POST',{});setAiDraft(data.text);}catch(e:any){setError(e.message);}finally{setAiBusy(false);}};
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
 const scrollSize=useRef({width:0,height:0});
 useEffect(()=>{
  const box=scrollBox.current;if(!box)return;
  const observer=new ResizeObserver(()=>{
   scrollSize.current={width:box.clientWidth,height:box.clientHeight};
   if(atBottom.current)box.scrollTop=box.scrollHeight;
  });
  observer.observe(box);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{const loaded=()=>{if(atBottom.current)scrollBox.current?.scrollTo({top:scrollBox.current.scrollHeight});};window.addEventListener('aen-media-ready',loaded);return()=>window.removeEventListener('aen-media-ready',loaded);},[]);
 const refreshRef=useRef<()=>Promise<void>>(async()=>{});
 const handleScroll=()=>{
  const el=scrollBox.current;if(!el)return;
  // Layout changes must not look like the user scrolling away from the latest message.
  if(el.clientWidth!==scrollSize.current.width||el.clientHeight!==scrollSize.current.height){
   scrollSize.current={width:el.clientWidth,height:el.clientHeight};
   if(atBottom.current)el.scrollTop=el.scrollHeight;
   return;
  }
  const wasBottom=atBottom.current;
  atBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<70;
  if(!wasBottom&&atBottom.current)void refreshRef.current();
 };
 const onReadRef=useRef(onRead);onReadRef.current=onRead;
 useEffect(()=>{
  let alive=true,busy=false,queued=false,lastRead=0,initial=true;
  const refresh=async()=>{
   if(!alive)return;if(busy){queued=true;return;}busy=true;
   try{
    const rows:Message[]=await api(`/inbox/conversations/${conversation.id}/messages`);
    if(!alive)return;
    merge(rows);if(initial){setMore(rows.length===200);initial=false;}setLoading(false);setError('');
    const latest=rows.at(-1)?.id||0;
    if(!unreadRef.current&&document.visibilityState==='visible'&&atBottom.current&&latest>lastRead){
     await api(`/inbox/conversations/${conversation.id}/read`,'POST',{last_message_id:latest});
     lastRead=latest;if(alive)await onReadRef.current();
    }
   }catch(e:any){if(alive){if(e.status===403)setMessages([]);setError(e.message);setLoading(false);}}
   finally{busy=false;if(queued&&alive){queued=false;void refresh();}}
  };
  refreshRef.current=refresh;void refresh();
  const interval=window.setInterval(refresh,30000);
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);window.addEventListener('aen-change',visible);
  return()=>{alive=false;window.clearInterval(interval);document.removeEventListener('visibilitychange',visible);window.removeEventListener('aen-change',visible);};
 },[conversation.id]);
 useLayoutEffect(()=>{const box=scrollBox.current,old=restoreScroll.current;if(box&&old){box.scrollTop=old.top+box.scrollHeight-old.height;restoreScroll.current=null;}},[messages]);
 useEffect(()=>{if(atBottom.current)scrollBox.current?.scrollTo({top:scrollBox.current.scrollHeight});},[messages.length]);
 const send=async(e:React.FormEvent)=>{
  e.preventDefault();if(conversation.can_reply===false||sending||(!reply.trim()&&!file))return;
  setSending(true);setError('');
  try{
   if(file){const asset=uploaded||await uploadFile(conversation.lead_id,file);setUploaded(asset);await api(`/inbox/conversations/${conversation.id}/media`,'POST',{asset_id:asset.id,text:''});setFile(null);setUploaded(null);}
   if(reply.trim())await api(`/inbox/conversations/${conversation.id}/reply`,'POST',{text:reply.trim()});
   atBottom.current=true;editReply('');unreadRef.current=false;setManualUnread(false);await refreshRef.current();await onReadRef.current();
  }
  catch(e:any){setError(e.message);}finally{setSending(false);}
 };
 return <div className="chat-content">
  <div className="chat-toolbar"><span className="chat-summary" title={conversation.manager_name?`Ответственный: ${conversation.manager_name}`:'Общий список · первый ответ закрепит клиента за вами'}>{conversation.message_count} сообщ. <i>·</i> {conversation.manager_name||'Общий список'}</span><button className="text-link" onClick={async()=>{try{unreadRef.current=true;await api(`/inbox/conversations/${conversation.id}/unread`,'POST',{});setManualUnread(true);await onReadRef.current();}catch(e:any){unreadRef.current=false;setError(e.message);}}}>{manualUnread?'Отмечен непрочитанным':'Отметить непрочитанным'}</button></div>
  <div ref={scrollBox} onScroll={handleScroll} className="chat-messages" role="log" aria-label="Переписка">
   {more&&<button className="secondary" disabled={olderBusy} onClick={async()=>{setOlderBusy(true);try{const rows=await api(`/inbox/conversations/${conversation.id}/messages?before_id=${messages[0]?.id||0}`);atBottom.current=false;const box=scrollBox.current;if(box)restoreScroll.current={height:box.scrollHeight,top:box.scrollTop};merge(rows);setMore(rows.length===200);}catch(e:any){setError(e.message);}finally{setOlderBusy(false);}}}>{olderBusy?'Загрузка…':'Ранние сообщения'}</button>}
   {loading&&<p>Загрузка переписки…</p>}
   {!loading&&!messages.length&&!error&&<p>Сообщений пока нет.</p>}
   {messages.map((m,index)=>{const sentAt=new Date(m.created_at);const newDay=!index||sentAt.toDateString()!==new Date(messages[index-1].created_at).toDateString();return <Fragment key={m.id}>{newDay&&<div className="chat-day"><span>{sentAt.toLocaleDateString('ru-RU',{day:'numeric',month:'long',...(sentAt.getFullYear()!==new Date().getFullYear()?{year:'numeric'}:{})})}</span></div>}<div className={'bubble '+(m.direction==='out'?'bubble-out':'')}><span className="sr-only">{m.direction==='out'?'Менеджер: ':'Клиент: '} </span><span className="message-text">{m.text}</span>{m.attachments?.map(a=><MediaView key={a.id} file={a}/>)}<time dateTime={m.created_at} title={sentAt.toLocaleString('ru-RU')}>{sentAt.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time></div></Fragment>})}
   <div ref={bottom}/>
  </div>
  {error&&<div className="error" role="alert">{error}</div>}
  <>{conversation.can_reply===false&&<div className="chat-owner">Только просмотр · ответить может ответственный или администратор</div>}</><fieldset className="compose-access" disabled={conversation.can_reply===false}><div className="quick-replies"><button type="button" className="secondary" disabled={aiBusy||sending} aria-label="Предложить ответ ИИ" title="Предложить ответ ИИ" onClick={makeDraft}><Sparkles size={14}/>{aiBusy?'Готовлю…':'Ответ ИИ'}</button><QuickReplies disabled={sending} onSelect={text=>editReply(reply.trim()?reply+"\n"+text:text)}/><label className="secondary file-button" title="Прикрепить фото, аудио или видео"><Paperclip size={16}/><span className="sr-only">Фото / аудио / видео</span><input aria-label="Прикрепить файл в чат" type="file" accept={accept} disabled={sending} onChange={e=>{setFile(e.target.files?.[0]||null);setUploaded(null);e.target.value='';}}/></label></div>
  {file&&<div className="pending-file">{file.name} · {(file.size/1024/1024).toFixed(1)} МБ <button onClick={()=>{setFile(null);setUploaded(null);}} disabled={sending}>Убрать</button></div>}
  <>{aiDraft&&<div className="ai-draft"><strong>Черновик ИИ</strong><p>{aiDraft}</p><button type="button" className="secondary" disabled={sending||!!reply.trim()} onClick={()=>{editReply(aiDraft);setAiDraft('');}}>Вставить в ответ</button><button type="button" className="text-link" onClick={()=>setAiDraft('')}>Закрыть</button>{reply.trim()&&<small>Сначала сохраните или очистите свой текст ответа.</small>}</div>}</><form className="chat-compose" onSubmit={send}><textarea ref={composer} rows={1} aria-label="Ответ клиенту" title="Ctrl+Enter — отправить" placeholder="Напишите сообщение…" value={reply} maxLength={2000} onChange={e=>editReply(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} disabled={sending}/><button className="primary" disabled={sending||loading||(!reply.trim()&&!file)}>{sending?'Отправка…':'Отправить'}</button></form></fieldset>
  {file&&<small className="composer-hint">До 16 МБ · Файл и текст отправляются отдельными сообщениями</small>}
 </div>;
}

export function ChatWindow({conversation,onClose,onRead}:{conversation:Conversation;onClose:()=>void;onRead:()=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
 return <dialog className="conversation-dialog" ref={dialog} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="conversation-dialog-inner"><div className="dialog-head"><div><h2>{conversation.customer_name}</h2><small>Лид #{conversation.lead_id} · Переписка</small></div><button className="iconbtn" aria-label="Закрыть переписку" onClick={onClose}>✕</button></div><ChatPanel key={conversation.id} conversation={conversation} onRead={onRead}/></div>
 </dialog>;
}
