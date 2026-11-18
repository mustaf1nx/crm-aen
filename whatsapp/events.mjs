import {jidNormalizedUser,normalizeMessageContent} from '@whiskeysockets/baileys';
export function messageMedia(message){
 const body=normalizeMessageContent(message);
 for(const kind of ['image','video','audio','document','sticker','ptv']){
  if(body?.[kind+'Message'])return {kind,content:body[kind+'Message']};
 }
 return null;
}
export function toEvent(m,account){
 const raw=m.key?.remoteJid;
 if(!raw||!m.key.id||!m.message||!account)return null;
 // Personal chats only. Never ingest groups, statuses, broadcasts or history sync.
 if(!/^\d+@(s\.whatsapp\.net|lid)$/.test(raw))return null;
 const alternate=m.key.remoteJidAlt;
 const sender=jidNormalizedUser(alternate?.endsWith('@s.whatsapp.net')?alternate:raw);
 const body=normalizeMessageContent(m.message);
 const media=messageMedia(m.message);
 const text=body?.conversation||body?.extendedTextMessage?.text||media?.content.caption;
 if(!text&&!media)return null;
 return {account,sender,mid:m.key.id,text:(text||'').slice(0,10000),name:(m.pushName||'').slice(0,120),direction:m.key.fromMe?'out':'in'};
}

// QR pairing can persist me.id while registered stays false in Baileys 7.
export const hasSavedSession=creds=>Boolean(creds?.registered||creds?.me?.id);
