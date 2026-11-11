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
  let read=0,replyCalls=0;
  let savedDetails=null,waConnects=0,mediaCalls=0;const files=[];
  const photo={id:"photo1",name:"product.png",mime:"image/png",url:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4l0AAAAASUVORK5CYII="};
  const lead={id:1,customer_id:1,customer_name:'Тестовый клиент',city_id:1,stage:'new',source:'instagram',created_at:new Date().toISOString()};
  const activity=[];
  const messages=[{id:1,direction:'in',text:'Есть размер M?',created_at:new Date().toISOString()}];
  const conv=()=>({id:1,lead_id:1,customer_name:'Тестовый клиент',city_id:1,last_message:messages.at(-1).text,message_count:messages.length,unread_count:messages.filter(m=>m.direction==='in'&&m.id>read).length,last_incoming_id:messages.filter(m=>m.direction==='in').at(-1).id});
  await page.addInitScript(()=>sessionStorage.setItem('aen_token','test-only'));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());const endpoint=url.pathname;
   let data=[];
   if(endpoint==='/api/me')data={id:1,role:'admin',full_name:'Tester'};
   else if(endpoint==='/api/cities')data=[{id:1,name:'Семей'}];
   else if(endpoint==='/api/leads')data=[lead];
   else if(endpoint==='/api/customers')data=[{id:1,name:'Тестовый клиент',city_id:1}];
   else if(endpoint.endsWith('/files')){if(route.request().method()==='POST'){data={...photo,purpose:url.searchParams.get('purpose')};if(data.purpose!=='chat')files.push(data);}else data=files;}
   else if(endpoint.endsWith('/media')){mediaCalls++;messages.push({id:messages.length+1,direction:'out',text:'',created_at:new Date().toISOString(),attachments:[photo]});data={ok:true};}
   else if(endpoint.endsWith('/unread')){read=0;data={ok:true};}
   else if(endpoint.endsWith('/details')){savedDetails=route.request().postDataJSON();data={ok:true};}
   else if(endpoint.endsWith('/stage')){Object.assign(lead,route.request().postDataJSON());data=lead;}
   else if(endpoint.endsWith('/activity'))data=activity;
   else if(endpoint.endsWith('/comments')){activity.unshift({id:1,text:route.request().postDataJSON().text,action:'lead.comment',actor:'Tester',created_at:new Date().toISOString()});data={ok:true};}
   else if(endpoint==='/api/whatsapp/status')data={state:'disconnected'};
   else if(endpoint==='/api/whatsapp/connect'){waConnects++;data={state:'connecting'};}
   else if(endpoint==='/api/stats')data={leads:1};
   else if(endpoint==='/api/instagram/status')data={configured:true,demo_enabled:false};
   else if(endpoint==='/api/inbox/conversations')data=[conv()];
   else if(endpoint.endsWith('/messages'))data=messages;
   else if(endpoint.endsWith('/read')){read=Math.max(read,route.request().postDataJSON().last_message_id);data={ok:true};}
   else if(endpoint.endsWith('/reply')){replyCalls++;messages.push({id:messages.length+1,direction:'out',text:route.request().postDataJSON().text,created_at:new Date().toISOString()});data={ok:true};}
   await route.fulfill({json:data});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>document.title.includes('AEN CRM'));
  await page.getByRole('button',{name:'Воронка продаж',exact:true}).click();
  await page.getByRole('textbox',{name:'Поиск клиентов и сделок'}).fill('missing');
  assert.equal(await page.locator('.lead-card').count(),0);
  await page.getByRole('button',{name:'Очистить поиск'}).click();
  if(process.env.QA_DIR)await page.screenshot({path:path.join(process.env.QA_DIR,'aen-board.png'),fullPage:true});
  await page.getByRole('button',{name:'⚙ Расширенные фильтры'}).click();
  await page.getByLabel('Сделки с').fill('2099-01-01');assert.equal(await page.locator('.lead-card').count(),0);
  await page.getByRole('button',{name:'Сбросить',exact:true}).click();
  await page.getByRole('button',{name:'⚙ Расширенные фильтры'}).click();
  await page.locator('.lead-card').click();
  await page.locator('dialog[open] .bubble').waitFor();
  assert.equal(await page.locator('dialog .bubble').innerText().then(s=>s.includes('Есть размер M?')),true);
  await page.waitForFunction(()=>document.title==='AEN CRM');
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
  await page.locator('.chat-item').click();
  await page.locator('.chat-content .bubble').first().waitFor();
  if(process.env.QA_DIR)await page.screenshot({path:path.join(process.env.QA_DIR,'aen-mobile.png'),fullPage:true});
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: funnel chat, read badge, mocked reply, stage editing, live notification, mobile dialog, inbox');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
