import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket,{initAuthCreds,BufferJSON,proto,DisconnectReason,jidNormalizedUser,downloadMediaMessage,normalizeMessageContent} from '@whiskeysockets/baileys';
import {toEvent,hasSavedSession} from './events.mjs';

const secret=process.env.WA_BRIDGE_SECRET;
if(!secret||!process.env.SECRET_KEY)throw Error('Bridge configuration missing');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL.replace('postgresql+psycopg:','postgresql:')});
pool.on('error',()=>{console.error('WhatsApp database connection lost');process.exit(1);});
const key=crypto.createHash('sha256').update('aen-whatsapp:'+process.env.SECRET_KEY).digest();
function encrypt(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(value,BufferJSON.replacer)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64');}
function decrypt(value){const b=Buffer.from(value,'base64'),c=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString(),BufferJSON.reviver);}
await pool.query('CREATE TABLE IF NOT EXISTS wa_auth (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
await pool.query('CREATE TABLE IF NOT EXISTS wa_event_queue (id TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())');
const get=async k=>{const r=await pool.query('SELECT value FROM wa_auth WHERE key=$1',[k]);return r.rows[0]?decrypt(r.rows[0].value):null;};
const put=async(k,v)=>{if(v===null)await pool.query('DELETE FROM wa_auth WHERE key=$1',[k]);else await pool.query('INSERT INTO wa_auth VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[k,encrypt(v)]);};
let socket=null,state='disconnected',qr=null,account=null,starting=false,retry=null,stopping=false,owner=null;
const status=()=>({state,qr,account});
async function ownSession(){
 if(owner)return true;
 const c=await pool.connect();
 const r=await c.query('SELECT pg_try_advisory_lock(784192731) AS locked');
 if(!r.rows[0].locked){c.release();return false;}
 owner=c;c.on('error',()=>process.exit(1));return true;
}
async function queue(event){const id=crypto.createHash('sha256').update(event.account+':'+event.sender+':'+event.mid).digest('hex');await pool.query('INSERT INTO wa_event_queue(id,value) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,encrypt(event)]);}
async function connect(){
 if(stopping||starting||state==='connected'||state==='qr'||state==='connecting')return;
 if(!await ownSession()){state='waiting';return;}
 starting=true;state='connecting';qr=null;
 try{
  const creds=await get('creds')||initAuthCreds();
  const auth={creds,keys:{get:async(type,ids)=>{const result={};for(const id of ids){let v=await get(type+':'+id);if(type==='app-state-sync-key'&&v)v=proto.Message.AppStateSyncKeyData.fromObject(v);result[id]=v;}return result;},set:async data=>{for(const type in data)for(const id in data[type])await put(type+':'+id,data[type][id]);}}};
  const s=makeWASocket({auth,logger:pino({level:'silent'}),markOnlineOnConnect:false,syncFullHistory:false,shouldSyncHistoryMessage:()=>false,browser:['AEN CRM','Chrome','1.0.0']});socket=s;
  s.ev.on('creds.update',()=>{put('creds',creds).catch(()=>{console.error('WhatsApp credentials could not be saved');process.exit(1);});});
  s.ev.on('connection.update',async update=>{
   if(socket!==s||stopping)return;
   if(update.qr){qr=await QRCode.toDataURL(update.qr,{width:280,margin:2});state='qr';}
   if(update.connection==='open'){account=jidNormalizedUser(s.user.id).split('@')[0];state='connected';qr=null;console.info('WhatsApp connected');}
   if(update.connection==='close'){
    socket=null;qr=null;account=null;
    const code=update.lastDisconnect?.error?.output?.statusCode;
    console.info('WhatsApp disconnected; code:',Number.isInteger(code)?code:'unknown');
    if(code===DisconnectReason.loggedOut){state='logged_out';await pool.query('DELETE FROM wa_auth');}
    else if(code===DisconnectReason.connectionReplaced){state='replaced';}
    else{state='reconnecting';clearTimeout(retry);retry=setTimeout(()=>{state='disconnected';connect().catch(()=>{state='error';});},5000);}
   }
  });
  s.ev.on('messages.upsert',async({messages,type})=>{
   if(type!=='notify'||socket!==s)return;
   try{for(const m of messages){const event=toEvent(m,account);if(event){
     const body=normalizeMessageContent(m.message),media=body?.imageMessage||body?.videoMessage||body?.audioMessage||body?.documentMessage;
     if(media){
      try{
       if(Number(media.fileLength||0)>16*1024*1024)throw Error('Too large');
       const stream=await downloadMediaMessage(m,'stream',{}, {logger:pino({level:'silent'}),reuploadRequest:s.updateMediaMessage});
       const chunks=[];let size=0;
       for await(const chunk of stream){size+=chunk.length;if(size>16*1024*1024){stream.destroy();throw Error('Too large');}chunks.push(chunk);}
       event.attachments=[{data:Buffer.concat(chunks).toString('base64'),mime:media.mimetype||'application/octet-stream',name:media.fileName||'Вложение'}];
       if(event.text.startsWith('[Вложение'))event.text='';
      }catch{event.text=(event.text.startsWith('[Вложение')?'':event.text)+' [Файл недоступен или больше 16 МБ — откройте WhatsApp]';}
     }
     await queue(event);
    }}}
   catch{console.error('WhatsApp incoming event storage failed');process.exit(1);}
  });
 }catch{state='error';console.error('WhatsApp connection failed');}finally{starting=false;}
}
let delivering=false;
setInterval(async()=>{
 if(delivering)return;delivering=true;
 try{
  const rows=await pool.query('SELECT id,value FROM wa_event_queue ORDER BY created_at LIMIT 50');
  for(const row of rows.rows){
   const r=await fetch(`http://127.0.0.1:${process.env.PORT||8080}/api/internal/whatsapp/events`,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(decrypt(row.value)),signal:AbortSignal.timeout(10000)});
   if(!r.ok)break;
   await pool.query('DELETE FROM wa_event_queue WHERE id=$1',[row.id]);
  }
 }catch{/* Retain events durably and retry after backend restarts. */}finally{delivering=false;}
},2000);
http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 const send=(code,data)=>{res.writeHead(code);res.end(JSON.stringify(data));};
 const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+secret);
 if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return send(403,{error:'Forbidden'});
 try{
  if(req.url==='/status'&&req.method==='GET')return send(200,status());
  if(req.url==='/connect'&&req.method==='POST'){await connect();return send(200,status());}
  if(req.url==='/send'&&req.method==='POST'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>24*1024*1024)return send(413,{error:'Too large'});}
   const data=JSON.parse(body);
   if(state!=='connected'||!socket||data.account!==account)return send(409,{error:'Not connected'});
   if(!/^\d{5,25}@(s\.whatsapp\.net|lid)$/.test(data.jid)||typeof data.text!=='string'||(!data.media&&!data.text.trim())||data.text.length>2000)return send(400,{error:'Invalid message'});
   let content={text:data.text};
   if(data.media){
    const bytes=Buffer.from(data.media.data,'base64'),mime=data.media.mime;
    if(!bytes.length||bytes.length>16*1024*1024)return send(413,{error:'Too large'});
    const type=mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'document';
    content={[type]:bytes,mimetype:mime,fileName:data.media.name,...(type==='audio'?{}:{caption:data.text})};
   }
   const sent=await socket.sendMessage(data.jid,content);
   if(!sent?.key.id)throw Error('No message id');
   await queue({account,sender:data.jid,mid:sent.key.id,text:data.text,direction:'out',name:'',asset_id:data.asset_id||null});
   return send(200,{id:sent.key.id});
  }
  send(404,{error:'Not found'});
 }catch{send(502,{error:'WhatsApp operation failed'});}
}).listen(8090,'127.0.0.1');
const existing=await get('creds');if(hasSavedSession(existing))await connect();
setInterval(()=>{if(state==='waiting')connect().catch(()=>{state='error';});},5000);
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stopping=true;clearTimeout(retry);socket?.end(undefined);pool.end().finally(()=>process.exit(0));});
console.info('WhatsApp bridge ready');
