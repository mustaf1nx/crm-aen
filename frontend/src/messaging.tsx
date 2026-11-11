import {useCallback,useEffect,useRef,useState} from 'react';

export type Conversation={id:number;channel?:string;lead_id:number;customer_name:string;city_id:number;last_message:string;message_count:number;unread_count:number;last_incoming_id:number};
type Message={id:number;direction:string;text:string;created_at:string};
export const api=async(path:string,method='GET',body?:Record<string,any>)=>{
 const token=sessionStorage.getItem('aen_token');
 const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'Ошибка запроса');
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
  void refresh();const interval=window.setInterval(refresh,5000);
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);
  return()=>{generation.current++;window.clearInterval(interval);document.removeEventListener('visibilitychange',visible);};
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
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [sending,setSending]=useState(false);
 const bottom=useRef<HTMLDivElement>(null);
 const scrollBox=useRef<HTMLDivElement>(null);const atBottom=useRef(true);
 const refreshRef=useRef<()=>Promise<void>>(async()=>{});
 const onReadRef=useRef(onRead);onReadRef.current=onRead;
 useEffect(()=>{
  let alive=true,busy=false,lastRead=0;
  const refresh=async()=>{
   if(busy)return;busy=true;
   try{
    const rows:Message[]=await api(`/inbox/conversations/${conversation.id}/messages`);
    if(!alive)return;
    setMessages(rows);setLoading(false);setError('');
    const latest=rows.at(-1)?.id||0;
    if(document.visibilityState==='visible'&&atBottom.current&&latest>lastRead){
     await api(`/inbox/conversations/${conversation.id}/read`,'POST',{last_message_id:latest});
     lastRead=latest;if(alive)await onReadRef.current();
    }
   }catch(e:any){if(alive){setError(e.message);setLoading(false);}}
   finally{busy=false;}
  };
  refreshRef.current=refresh;void refresh();
  const interval=window.setInterval(refresh,3000);
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;window.clearInterval(interval);document.removeEventListener('visibilitychange',visible);};
 },[conversation.id]);
 useEffect(()=>{if(atBottom.current)bottom.current?.scrollIntoView({block:'nearest'});},[messages.length]);
 const send=async(e:React.FormEvent)=>{
  e.preventDefault();if(sending||!reply.trim())return;
  setSending(true);setError('');
  try{await api(`/inbox/conversations/${conversation.id}/reply`,'POST',{text:reply.trim()});setReply('');await refreshRef.current();await onReadRef.current();}
  catch(e:any){setError(e.message);}finally{setSending(false);}
 };
 return <div className="chat-content">
  <p className="muted">Всего сообщений: {messages.length} · {conversation.channel==='whatsapp'?'WhatsApp':'Instagram Direct'}</p>
  <div ref={scrollBox} onScroll={()=>{const el=scrollBox.current;if(el)atBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<70;}} className="chat-messages" role="log" aria-label="Переписка">
   {loading&&<p>Загрузка переписки…</p>}
   {!loading&&!messages.length&&!error&&<p>Сообщений пока нет.</p>}
   {messages.map(m=><div key={m.id} className={'bubble '+(m.direction==='out'?'bubble-out':'')}><small>{m.direction==='out'?'Менеджер':conversation.channel==='whatsapp'?'WhatsApp':'Instagram'}</small><div>{m.text}</div><time>{new Date(m.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div>)}
   <div ref={bottom}/>
  </div>
  {error&&<div className="error" role="alert">{error}</div>}
  <form className="chat-compose" onSubmit={send}><input aria-label="Ответ клиенту" placeholder="Ответ клиенту" value={reply} maxLength={2000} onChange={e=>setReply(e.target.value)} disabled={sending}/><button className="primary" disabled={sending||loading||!reply.trim()}>{sending?'Отправка…':'Отправить'}</button></form>
 </div>;
}

export function ChatWindow({conversation,onClose,onRead}:{conversation:Conversation;onClose:()=>void;onRead:()=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
 return <dialog className="conversation-dialog" ref={dialog} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="conversation-dialog-inner"><div className="dialog-head"><div><h2>{conversation.customer_name}</h2><small>Лид #{conversation.lead_id} · Переписка</small></div><button className="iconbtn" aria-label="Закрыть переписку" onClick={onClose}>✕</button></div><ChatPanel key={conversation.id} conversation={conversation} onRead={onRead}/></div>
 </dialog>;
}
