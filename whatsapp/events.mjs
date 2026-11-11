import {jidNormalizedUser,normalizeMessageContent} from '@whiskeysockets/baileys';
export function toEvent(m,account){
 const raw=m.key?.remoteJid;
 if(!raw||!m.key.id||!m.message||!account)return null;
 // Personal chats only. Never ingest groups, statuses, broadcasts or history sync.
 if(!/^\d+@(s\.whatsapp\.net|lid)$/.test(raw))return null;
 const alternate=m.key.remoteJidAlt;
 const sender=jidNormalizedUser(alternate?.endsWith('@s.whatsapp.net')?alternate:raw);
 const body=normalizeMessageContent(m.message);
 const text=body?.conversation||body?.extendedTextMessage?.text||body?.imageMessage?.caption||body?.videoMessage?.caption;
 const media=body?.imageMessage||body?.videoMessage||body?.audioMessage||body?.documentMessage||body?.stickerMessage;
 if(!text&&!media)return null;
 return {account,sender,mid:m.key.id,text:(text||(media?'[Вложение — откройте WhatsApp на телефоне]':'')).slice(0,10000),name:(m.pushName||'').slice(0,120),direction:m.key.fromMe?'out':'in'};
}
