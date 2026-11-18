import {messageMedia} from './events.mjs';

export const MAX_MEDIA_BYTES=16*1024*1024;
const types=new Set(['image/jpeg','image/png','image/webp','video/mp4','audio/mp4','audio/mpeg','audio/ogg','audio/wav','audio/x-wav','application/pdf']);
const defaults={image:['image/jpeg','Фото.jpg'],video:['video/mp4','Видео.mp4'],ptv:['video/mp4','Видеосообщение.mp4'],audio:['audio/ogg','Голосовое.ogg'],sticker:['image/webp','Стикер.webp'],document:['application/octet-stream','Документ']};
const failures={
 too_large:'Файл больше 16 МБ. Откройте его в WhatsApp.',
 unsupported:'Этот формат файла пока не поддерживается в CRM. Откройте его в WhatsApp.',
 download:'Не удалось загрузить вложение. Откройте его в WhatsApp или попросите отправить повторно.'
};

// Keep media detection identical to ingestion, including stickers and video notes.
export async function attachMedia(event,message,download,onFailure=()=>{}){
 const media=messageMedia(message.message);if(!media)return event;
 const [defaultMime,defaultName]=defaults[media.kind];
 const mime=(media.content.mimetype||defaultMime).split(';')[0].trim().toLowerCase();
 let failure='download',stream;
 try{
  if(Number(media.content.fileLength||0)>MAX_MEDIA_BYTES){failure='too_large';throw Error(failure)}
  if(!types.has(mime)){failure='unsupported';throw Error(failure)}
  stream=await download(message);
  const chunks=[];let size=0;
  for await(const chunk of stream){
   size+=chunk.length;
   if(size>MAX_MEDIA_BYTES){failure='too_large';throw Error(failure)}
   chunks.push(chunk);
  }
  if(!size)throw Error('empty');
  event.attachments=[{data:Buffer.concat(chunks).toString('base64'),mime,name:media.content.fileName||defaultName}];
 }catch{
  stream?.destroy?.();
  event.text=[event.text,failures[failure]].filter(Boolean).join('\n\n').slice(0,10000);
  // No message text, phone numbers, keys or media URLs in logs.
  onFailure({kind:media.kind,reason:failure});
 }
 return event;
}
