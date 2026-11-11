import test from 'node:test';
import assert from 'node:assert/strict';
import {toEvent,hasSavedSession} from './events.mjs';
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
test('attachments produce an explicit placeholder, wrapped text is unwrapped',()=>{
 assert.match(toEvent({...m,message:{imageMessage:{url:'unused'}}},'77020000000').text,/Вложение/);
 assert.equal(toEvent({...m,message:{ephemeralMessage:{message:{conversation:'Wrapped'}}}},'77020000000').text,'Wrapped');
});

test('restore QR sessions even when Baileys registered remains false',()=>{
 assert.equal(hasSavedSession({registered:false,me:{id:'test-session'}}),true);
 assert.equal(hasSavedSession({registered:true}),true);
 assert.equal(hasSavedSession({registered:false}),false);
 assert.equal(hasSavedSession(null),false);
});
