// Run after npm run build, with playwright installed and Chrome available.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const dist=path.resolve(__dirname,'../dist');
const server=http.createServer((req,res)=>{
 const file=path.join(dist,req.url==='/'?'index.html':req.url);
 if(!file.startsWith(dist)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
 res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1512,height:982}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let currentUser={id:1,role:'admin',full_name:'Tester'},transferCalls=0;
  let read=0,replyCalls=0,stageCalls=0,failStage=false;
  let savedDetails=null,waConnects=0,mediaCalls=0;const files=[];
  const photo={id:"photo1",name:"product.png",mime:"image/png",url:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4l0AAAAASUVORK5CYII="};
  const lead={id:1,customer_id:1,customer_name:'Тестовый клиент',city_id:1,stage:'new',source:'instagram',created_at:new Date().toISOString()};
  const activity=[];
  const messages=[{id:1,direction:'in',text:'Есть размер M?',created_at:new Date().toISOString()}];
  const conv=()=>({can_reply:currentUser.role==='admin'||!lead.manager_id||lead.manager_id===currentUser.id,manager_id:lead.manager_id,manager_name:lead.manager_id?'Tester':null,id:1,lead_id:1,customer_name:'Тестовый клиент',city_id:1,last_direction:messages.at(-1).direction,last_message:messages.at(-1).text,message_count:messages.length,unread_count:messages.filter(m=>m.direction==='in'&&m.id>read).length,last_incoming_id:messages.filter(m=>m.direction==='in').at(-1).id});
  await page.emulateMedia({colorScheme:'light'});
  await page.addInitScript(()=>sessionStorage.setItem('aen_token','test-only'));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());const endpoint=url.pathname;
   let data=[];
   if(endpoint==='/api/me')data=currentUser;
   else if(endpoint==='/api/users')data=[{id:1,role:'admin',full_name:'Tester',active:true},{id:2,role:'manager',full_name:'Manager',city_id:1,active:true}];
   else if(endpoint.endsWith('/transfer')){transferCalls++;lead.manager_id=route.request().postDataJSON().manager_id;data=lead;}
   else if(endpoint==='/api/audit')data={items:[{id:1,actor:'Tester',action:'lead.transfer',detail:'1: Передан сотруднику Manager',created_at:new Date().toISOString()}],next_cursor:null};
   else if(endpoint==='/api/cities')data=[{id:1,name:'Семей'}];
   else if(endpoint==='/api/leads')data=[lead];
   else if(endpoint==='/api/customers')data=[{id:1,name:'Тестовый клиент',city_id:1,notes:'Автоматически из Instagram Direct'},{id:2,name:'WhatsApp клиент',city_id:1,phone:'+77010000000'}];
   else if(endpoint.endsWith('/files')){if(route.request().method()==='POST'){data={...photo,purpose:url.searchParams.get('purpose')};if(data.purpose!=='chat')files.push(data);}else data=files;}
   else if(endpoint.endsWith('/media')){mediaCalls++;messages.push({id:messages.length+1,direction:'out',text:'',created_at:new Date().toISOString(),attachments:[photo]});data={ok:true};}
   else if(endpoint.endsWith('/unread')){read=0;data={ok:true};}
   else if(endpoint.endsWith('/details')){savedDetails=route.request().postDataJSON();data={ok:true};}
   else if(endpoint.endsWith('/stage')){stageCalls++;if(failStage){await route.fulfill({status:500,json:{detail:'Test stage failure'}});return;}Object.assign(lead,route.request().postDataJSON());data=lead;}
   else if(endpoint.endsWith('/activity'))data=activity;
   else if(endpoint.endsWith('/comments')){activity.unshift({id:1,text:route.request().postDataJSON().text,action:'lead.comment',actor:'Tester',created_at:new Date().toISOString()});data={ok:true};}
   else if(endpoint==='/api/whatsapp/status')data={state:'disconnected'};
   else if(endpoint==='/api/whatsapp/connect'){waConnects++;data={state:'connecting'};}
   else if(endpoint==='/api/stats')data={leads:1};
   else if(endpoint==='/api/instagram/status')data={configured:true,demo_enabled:false};
   else if(endpoint==='/api/inbox/conversations')data=currentUser.role==='admin'||!lead.manager_id||lead.manager_id===currentUser.id?[conv()]:[];
   else if(endpoint.endsWith('/messages'))data=messages;
   else if(endpoint.endsWith('/read')){read=Math.max(read,route.request().postDataJSON().last_message_id);data={ok:true};}
   else if(endpoint.endsWith('/ai-draft'))data={text:'Подскажите нужный цвет.'};
   else if(endpoint.endsWith('/reply')){replyCalls++;messages.push({id:messages.length+1,direction:'out',text:route.request().postDataJSON().text,created_at:new Date().toISOString()});data={ok:true};}
   await route.fulfill({json:data});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>document.title.includes('AEN CRM'));
  assert.equal(await page.getByRole('button',{name:'Всё время',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Вчера',exact:true}).click();
  for(const label of ['Непрочитанные','В работе','Ждут ответа']){
   await page.locator('.work-summary button').filter({hasText:label}).click();
   assert.equal(await page.getByRole('button',{name:'Вчера',exact:true}).getAttribute('aria-pressed'),'true');
  }
  await page.getByRole('button',{name:'Мои сделки',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Вчера',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Сбросить',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Всё время',exact:true}).getAttribute('aria-pressed'),'true');
  for(const width of [1512,1280,1024]){
   await page.setViewportSize({width,height:982});
   assert(await page.locator('.board').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Board must fit width '+width);
  }
  await page.setViewportSize({width:1512,height:982});
  await page.getByRole('button',{name:'Включить тёмную тему',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
  await page.reload();
  await page.getByRole('button',{name:'Включить светлую тему',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('aen-theme')),'dark');
  await page.getByRole('button',{name:'Воронка продаж',exact:true}).click();
  await page.getByRole('textbox',{name:'Поиск клиентов и сделок'}).fill('missing');
  assert.equal(await page.locator('.lead-card').count(),0);
  await page.getByRole('button',{name:'Очистить поиск'}).click();
  if(process.env.QA_DIR)await page.screenshot({path:path.join(process.env.QA_DIR,'aen-board.png'),fullPage:true});
  await page.getByRole('button',{name:'Расширенные фильтры'}).click();
  await page.getByLabel('Сделки с').fill('2099-01-01');assert.equal(await page.locator('.lead-card').count(),0);
  await page.getByRole('button',{name:'Сбросить',exact:true}).click();
  await page.getByRole('button',{name:'Расширенные фильтры'}).click();
  const dragTo=async(stage)=>{
   const card=page.locator('.board .lead-card');await card.scrollIntoViewIfNeeded();
   const a=await card.boundingBox(),b=await page.locator(`[data-stage="${stage}"]`).boundingBox();
   await page.mouse.move(a.x+50,a.y+45);await page.mouse.down();await page.mouse.move(b.x+80,b.y+60,{steps:12});
   assert.equal(await page.locator('.card-drag-overlay').count(),1);
   assert.equal(await card.evaluate(el=>getComputedStyle(el).visibility),'hidden');
   assert.equal(await page.locator('.card-drag-overlay').evaluate(el=>getComputedStyle(el).opacity),'1');
  };
  await dragTo('working');await page.mouse.up();
  await page.waitForFunction(()=>!!document.querySelector('[data-stage="working"] [data-lead-id="1"]'));
  await page.waitForTimeout(150);assert.equal(stageCalls,1);assert.equal(lead.stage,'working');
  assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('.card-drag-overlay').count(),0);
  await dragTo('new');await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(stageCalls,1);assert.equal(await page.locator('.card-drag-overlay').count(),0);
  failStage=true;await dragTo('new');await page.mouse.up();await page.getByText('Test stage failure',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-stage="working"] [data-lead-id="1"]').count(),1);
  failStage=false;await dragTo('new');await page.mouse.up();
  await page.waitForFunction(()=>!!document.querySelector('[data-stage="new"] [data-lead-id="1"]'));
  await page.waitForTimeout(150);
  await page.setViewportSize({width:1920,height:1080});
  const beforeRefusal=stageCalls;
  await dragTo('refusal');await page.mouse.up();
  await page.getByRole('dialog',{name:'Причина отказа'}).waitFor();
  assert.equal(await page.locator('[data-stage="refusal"] [data-lead-id="1"]').count(),1);
  assert.equal(await page.getByRole('button',{name:'Сохранить отказ',exact:true}).isDisabled(),true);
  await page.getByRole('radio',{name:'Другая причина',exact:true}).check();
  await page.getByLabel('Уточните причину').fill('   ');
  assert.equal(await page.getByRole('button',{name:'Сохранить отказ',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  assert.equal(stageCalls,beforeRefusal);assert.equal(lead.stage,'new');
  await dragTo('refusal');await page.mouse.up();
  await page.getByRole('radio',{name:'Неправильный размер',exact:true}).check();
  failStage=true;await page.getByRole('button',{name:'Сохранить отказ',exact:true}).click();
  await page.locator('.refusal-dialog [role="alert"]').waitFor();
  assert.equal(lead.stage,'new');assert.equal(await page.getByRole('radio',{name:'Неправильный размер',exact:true}).isChecked(),true);
  failStage=false;await page.getByRole('button',{name:'Сохранить отказ',exact:true}).click();
  await page.locator('.refusal-dialog').waitFor({state:'detached'});
  assert.equal(lead.stage,'refusal');assert.equal(lead.refusal_reason,'Неправильный размер');
  await dragTo('new');await page.mouse.up();await page.waitForTimeout(150);
  await page.setViewportSize({width:1512,height:982});
  await page.locator('.lead-card').click();
  await page.locator('dialog[open] .bubble').waitFor();
  const chatBounds=await page.locator('dialog .deal-conversation').boundingBox(),detailBounds=await page.locator('dialog .deal-sidebar').boundingBox();assert(chatBounds.width>detailBounds.width&&chatBounds.x<detailBounds.x,'Chat must be primary, left column');
  assert.equal(await page.locator('dialog .bubble').innerText().then(s=>s.includes('Есть размер M?')),true);
  await page.waitForFunction(()=>document.title==='AEN CRM');
  await page.getByRole('button',{name:'✦ Предложить ответ',exact:true}).click();
  await page.getByText('Подскажите нужный цвет.',{exact:true}).waitFor();
  assert.equal(replyCalls,0);
  await page.getByRole('button',{name:'Вставить в ответ',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'Ответ клиенту'}).inputValue(),'Подскажите нужный цвет.');
  await page.getByRole('textbox',{name:'Ответ клиенту'}).fill('Да, есть');
  await page.getByRole('button',{name:'Отправить',exact:true}).click();
  await page.locator('dialog').getByText('Да, есть',{exact:true}).waitFor();assert.equal(replyCalls,1);
  await page.getByLabel('Прикрепить файл в чат').setInputFiles({name:'product.png',mimeType:'image/png',buffer:Buffer.from('mock')});
  await page.getByRole('button',{name:'Отправить',exact:true}).click();await page.locator('.bubble img').waitFor();assert.equal(mediaCalls,1);
  await page.getByRole('button',{name:'Отметить непрочитанным',exact:true}).click();await page.getByText('Отмечен непрочитанным',{exact:true}).waitFor();
  await page.getByLabel('Тип вложения сделки').selectOption('receipt');
  await page.locator('.deal-files input[type=file]').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from('mock')});
  await page.locator('.deal-file-grid img').waitFor();
  await page.getByLabel('Этап сделки').selectOption('working');
  await page.getByLabel('Заметки по сделке').fill('Размер M');
  await page.getByRole('button',{name:'Сохранить данные',exact:true}).click();
  await page.getByText('Изменения сохранены',{exact:true}).waitFor();
  assert.equal(savedDetails.notes,'Размер M');assert.equal(lead.stage,'working');
  await page.getByRole('button',{name:'История и комментарии'}).click();
  await page.getByPlaceholder('Что важно знать о клиенте?').fill('Позвонить вечером');
  await page.getByRole('button',{name:'Добавить комментарий'}).click();
  await page.locator('.timeline').getByText('Позвонить вечером').waitFor();
  await page.getByRole('button',{name:'Переписка',exact:true}).click();
  await page.waitForFunction(()=>document.title==='AEN CRM');
  if(process.env.QA_DIR)await page.screenshot({path:path.join(process.env.QA_DIR,'aen-deal.png'),fullPage:true});
  await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
  messages.push({id:messages.length+1,direction:'in',text:'Спасибо!',created_at:new Date().toISOString()});
  await page.evaluate(()=>window.dispatchEvent(new Event('aen-change')));
  await page.locator('.message-notice').waitFor({timeout:10000});
  await page.waitForFunction(()=>document.title==='(1) AEN CRM');
  await page.setViewportSize({width:390,height:844});
  await page.locator('.message-notice button').first().click();
  await page.getByText('Спасибо!',{exact:true}).last().waitFor();
  const rect=await page.locator('dialog').boundingBox();assert(rect.x>=0&&rect.width<=390);
  await page.getByRole('button',{name:'Закрыть переписку'}).click();
  await page.getByRole('button',{name:/^Сообщения/}).click();
  await page.getByRole('button',{name:'Подключения'}).click();
  await page.getByRole('button',{name:'Подключить по QR'}).click();assert.equal(waConnects,1);
  await page.getByRole('button',{name:'Подключения'}).click();
  const emptyInboxHeight=await page.locator('.messenger-shell').evaluate(e=>e.getBoundingClientRect().height);
  await page.locator('.chat-item').click();
  await page.locator('.chat-content .bubble').first().waitFor();
  const mobileChat=await page.locator('.messenger-detail .chat-content').boundingBox();assert(mobileChat.x>=0&&mobileChat.x+mobileChat.width<=390,'Mobile chat must fit viewport');
  if(process.env.QA_DIR)await page.screenshot({path:path.join(process.env.QA_DIR,'aen-mobile.png'),fullPage:true});
  assert.equal(errors.length,0,errors.join('\n'));
  await page.getByRole('button',{name:'Включить светлую тему',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  await page.setViewportSize({width:1512,height:982});
  await page.evaluate(()=>window.scrollTo(0,0));
  for(const height of [982,720]){
   await page.setViewportSize({width:1512,height});
   const composer=page.locator('.messenger-detail .chat-compose');
   await composer.scrollIntoViewIfNeeded();
   const replyBounds=await composer.boundingBox();
   const logBounds=await page.locator('.messenger-detail .chat-messages').boundingBox();
   assert(logBounds.height>=220,'Conversation must not collapse on short screens');
   const shell=await page.locator('.messenger-shell').boundingBox();
   assert(shell.height<=Math.max(700,height-360)+2,'Opening chat must not expand the inbox');
   assert(shell.y+shell.height-replyBounds.y-replyBounds.height<55,'No blank area below open chat composer');
   assert(replyBounds.y+replyBounds.height<=height,'Reply remains reachable');
   assert(await page.locator('main.messages-page').evaluate(e=>e.scrollHeight<=e.clientHeight+1),'No nested page scrollbar');
   assert(await page.locator('.messenger-detail .chat-content').evaluate(e=>e.scrollHeight<=e.clientHeight+1),'No nested composer scrollbar');
  }
  await page.setViewportSize({width:1512,height:982});
  await page.getByRole('button',{name:'Клиенты',exact:true}).click();
  await page.locator('.customer-table').waitFor();
  assert.equal(await page.locator('.customer-channel.instagram').textContent(),'Instagram');
  assert.equal(await page.locator('.customer-channel.whatsapp').textContent(),'WhatsApp');
  assert.equal(await page.getByText('Автоматически из Instagram Direct',{exact:true}).count(),0);
  assert.equal(await page.locator('.customer-table').evaluate(e=>getComputedStyle(e).borderRadius),'20px');
  if(process.env.QA_DIR)await page.screenshot({path:path.join(process.env.QA_DIR,'aen-customers.png'),fullPage:true});
  await page.getByRole('button',{name:'Воронка продаж',exact:true}).click();
  await page.getByRole('button',{name:'Сегодня',exact:true}).click();
  assert.equal(await page.locator('[data-lead-id="1"]').count(),1);
  await page.getByRole('button',{name:'Вчера',exact:true}).click();
  assert.equal(await page.locator('[data-lead-id="1"]').count(),0);
  await page.getByRole('button',{name:'Всё время',exact:true}).click();
  await page.locator('[data-lead-id="1"]').click();
  const composer=await page.locator('dialog .chat-compose').boundingBox();
  const modal=await page.locator('dialog[open]').boundingBox();
  assert(modal.y+modal.height-composer.y-composer.height<55,'No empty space below composer');
  await page.getByRole('button',{name:'Закрыть переписку'}).click();
  await page.getByRole('button',{name:'Недавние действия',exact:true}).click();
  await page.getByText('1: Передан сотруднику Manager',{exact:true}).waitFor();
  await page.getByLabel('Сотрудник журнала').selectOption('2');
  await page.getByLabel('Тип действия').selectOption('message.send');
  assert.equal(await page.getByRole('button',{name:'Сегодня',exact:true}).getAttribute('aria-pressed'),'true');
  if(process.env.QA_DIR)await page.screenshot({path:path.join(process.env.QA_DIR,'aen-audit.png'),fullPage:true});
  lead.manager_id=1;currentUser={id:2,role:'manager',city_id:1,full_name:'Manager'};
  await page.reload();
  await page.locator('[data-lead-id="1"]').click();
  assert.equal(await page.getByRole('button',{name:'Недавние действия',exact:true}).count(),0);
  await page.getByText('Переписка закрыта',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Ответ клиенту',{exact:true}).count(),0);
  assert.equal(await page.getByRole('log',{name:'Переписка'}).count(),0);
  assert.equal(await page.getByLabel('Передать клиента',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Закрыть переписку'}).click();
  lead.manager_id=2;await page.evaluate(()=>window.dispatchEvent(new Event('aen-change')));
  await page.reload();await page.locator('[data-lead-id="1"]').click();
  await page.getByLabel('Передать клиента',{exact:true}).selectOption('1');
  await page.getByRole('button',{name:'Передать',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Недавние действия',exact:true}).count(),0);
  await page.getByText('Переписка закрыта',{exact:true}).waitFor();
  assert.equal(transferCalls,1);assert.equal(lead.manager_id,1);
  assert.equal(await page.getByLabel('Ответ клиенту',{exact:true}).count(),0);
  assert.equal(await page.getByRole('log',{name:'Переписка'}).count(),0);
  console.log('PASS: funnel chat, read badge, mocked reply, stage editing, live notification, mobile dialog, inbox');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
