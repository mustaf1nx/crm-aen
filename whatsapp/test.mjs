import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {toEvent,hasSavedSession,messageMedia} from './events.mjs';
import {attachMedia,MAX_MEDIA_BYTES} from './media.mjs';
const m={key:{remoteJid:'77010000000@s.whatsapp.net',id:'test'},message:{conversation:'Hello'},pushName:'Test'};
test('personal messages, phone alternative and outgoing echo',()=>{
 assert.equal(toEvent(m,'77020000000').direction,'in');
 assert.equal(toEvent({...m,key:{...m.key,fromMe:true}},'77020000000').direction,'out');
 assert.equal(toEvent({...m,key:{...m.key,remoteJid:'111111@lid',remoteJidAlt:m.key.remoteJid}},'77020000000').sender,m.key.remoteJid);
});
test('exclude groups, broadcasts, protocol updates and missing account',()=>{
 for(const remoteJid of ['123@g.us','status@broadcast','123@newsletter'])assert.equal(toEvent({...m,key:{...m.key,remoteJid}},'77020000000'),null);
 assert.equal(toEvent({...m,message:{protocolMessage:{}}},'77020000000'),null);
 assert.equal(toEvent(m,null),null);
});
test('media has no misleading placeholder, wrapped text is unwrapped',()=>{
 assert.equal(toEvent({...m,message:{imageMessage:{url:'unused'}}},'77020000000').text,'');
 assert.equal(toEvent({...m,message:{ephemeralMessage:{message:{conversation:'Wrapped'}}}},'77020000000').text,'Wrapped');
});

test('audio, stickers, images, video notes and captions are downloaded consistently',async()=>{
 for(const [kind,mime] of [['audio','audio/ogg; codecs=opus'],['sticker','image/webp'],['image','image/jpeg'],['video','video/mp4'],['ptv','video/mp4'],['document','application/pdf']]){
  const message={...m,message:{ephemeralMessage:{message:{[kind+'Message']:{mimetype:mime,caption:kind==='image'?'Размер M':''}}}}};
  let downloads=0;
  const event=await attachMedia(toEvent(message,'77020000000'),message,async received=>{downloads++;assert.equal(received,message);return Readable.from([Buffer.from('bytes')])});
  assert.equal(messageMedia(message.message).kind,kind);
  assert.equal(downloads,1);
  assert.equal(event.text,kind==='image'?'Размер M':'');
  assert.equal(event.attachments[0].mime,mime.split(';')[0]);
  assert.equal(Buffer.from(event.attachments[0].data,'base64').toString(),'bytes');
  assert(!event.attachments[0].name.includes('\uFFFD'));
 }
});

test('download failure keeps caption and reports an honest fallback without leaking errors',async()=>{
 const message={...m,message:{imageMessage:{caption:'Размер M',mimetype:'image/jpeg'}}};
 const failures=[];
 const event=await attachMedia(toEvent(message,'77020000000'),message,async()=>{throw Error('secret media URL')},reason=>failures.push(reason));
 assert.match(event.text,/Размер M\n\nНе удалось загрузить/);
 assert(!event.text.includes('secret'));
 assert.equal(event.attachments,undefined);
 assert.deepEqual(failures,[{kind:'image',reason:'download'}]);
});

test('size limit and unsupported MIME do not create blank messages or download oversized files',async()=>{
 for(const [media,reason] of [[{mimetype:'image/jpeg',fileLength:MAX_MEDIA_BYTES+1},'too_large'],[{mimetype:'application/zip'},'unsupported']]){
  const message={...m,message:{documentMessage:media}},failures=[];
  const event=await attachMedia(toEvent(message,'77020000000'),message,async()=>assert.fail('Must not download'),r=>failures.push(r));
  assert(event.text.length>0);assert.equal(event.attachments,undefined);assert.equal(failures[0].reason,reason);
 }
 const message={...m,message:{audioMessage:{mimetype:'audio/ogg'}}};
 const stream=Readable.from([Buffer.alloc(MAX_MEDIA_BYTES),Buffer.from('overflow')]);
 const event=await attachMedia(toEvent(message,'77020000000'),message,async()=>stream);
 assert.match(event.text,/16 МБ/);assert(stream.destroyed);assert.equal(event.attachments,undefined);
 const empty=await attachMedia(toEvent(message,'77020000000'),message,async()=>Readable.from([]));
 assert.match(empty.text,/Не удалось загрузить/);
});

test('restore QR sessions even when Baileys registered remains false',()=>{
 assert.equal(hasSavedSession({registered:false,me:{id:'test-session'}}),true);
 assert.equal(hasSavedSession({registered:true}),true);
 assert.equal(hasSavedSession({registered:false}),false);
 assert.equal(hasSavedSession(null),false);
});
