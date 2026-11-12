import asyncio, base64, hashlib, hmac, os, re, threading, time, uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
import httpx
from fastapi import Depends, HTTPException, Request, Response, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy import ForeignKey, String, Text, LargeBinary, DateTime, Integer, select, func, event
from sqlalchemy.orm import Mapped, mapped_column, Session, deferred, column_property
from pydantic import BaseModel, Field
from . import main as m

MAX_FILE=16*1024*1024
class Asset(m.Base):
    __tablename__='media_assets'
    id:Mapped[str]=mapped_column(String(40),primary_key=True,default=lambda:uuid.uuid4().hex)
    lead_id:Mapped[int]=mapped_column(ForeignKey('leads.id'),index=True)
    message_id:Mapped[int|None]=mapped_column(ForeignKey('instagram_messages.id'),nullable=True,index=True)
    purpose:Mapped[str]=mapped_column(String(20),default='chat')
    name:Mapped[str]=mapped_column(String(180))
    mime:Mapped[str]=mapped_column(String(100))
    data:Mapped[bytes|None]=mapped_column(LargeBinary,nullable=True,deferred=True)
    ready=column_property(data.is_not(None))
    remote:Mapped[str|None]=mapped_column(Text,nullable=True)
    created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=lambda:datetime.now(timezone.utc))
class Profile(m.Base):
    __tablename__='instagram_profiles'
    conversation_id:Mapped[int]=mapped_column(ForeignKey('instagram_conversations.id'),primary_key=True)
    username:Mapped[str|None]=mapped_column(String(120),nullable=True)
    retry_at:Mapped[datetime]=mapped_column(DateTime(timezone=True))

# This deployment runs one API worker. Invalidation contains no customer data.
_revision=0
_revision_label=''
@event.listens_for(Session,'before_flush')
def track_changes(db,*args):
    if db.new or db.dirty or db.deleted:
        db.info['changed']=True
        labels={'Lead':'Обновлена сделка','Order':'Обновлён заказ','Asset':'Добавлено вложение','Customer':'Обновлены данные клиента','Audit':'Обновлена история сделки'}
        for obj in list(db.new)+list(db.dirty):
            if type(obj).__name__ in labels: db.info['label']=labels[type(obj).__name__]
@event.listens_for(Session,'after_commit')
def notify_changes(db):
    global _revision, _revision_label
    if db.info.pop('changed',False):
        _revision+=1;_revision_label=db.info.pop('label','')
@event.listens_for(Session,'after_rollback')
def clear_changes(db): db.info.pop('changed',None)

@m.app.get('/api/events')
async def events(request:Request,user=Depends(m.current_user),db=Depends(m.get_db)):
    uid=user.id
    db.close()  # Do not reserve a pool connection for the lifetime of SSE.
    async def stream():
        previous=-1; heartbeat=0
        while not await request.is_disconnected():
            if heartbeat%60==0:
                with m.SessionLocal() as db:
                    u=db.get(m.User,uid)
                    if not u or not u.active: return
            if previous!=_revision:
                previous=_revision
                yield 'data: '+m.json.dumps({'revision':previous,'label':_revision_label},ensure_ascii=False)+'\n\n'
            elif heartbeat%30==0: yield ': heartbeat\n\n'
            heartbeat+=1
            await asyncio.sleep(0.5)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'})

def safe_remote(url):
    try:
        p=urlparse(url);port=p.port
    except (ValueError,TypeError): return False
    return p.scheme=='https' and port in (None,443) and not p.username and any((p.hostname or '').endswith('.'+d) for d in ('fbcdn.net','cdninstagram.com','fbsbx.com'))

def validate_file(data,mime):
    ok=(mime=='image/jpeg' and data.startswith(b'\xff\xd8\xff') or mime=='image/png' and data.startswith(b'\x89PNG\r\n\x1a\n') or mime=='image/webp' and data[:4]==b'RIFF' and data[8:12]==b'WEBP' or mime=='application/pdf' and data.startswith(b'%PDF-') or mime in ('video/mp4','audio/mp4') and data[4:8]==b'ftyp' or mime=='audio/ogg' and data.startswith(b'OggS') or mime=='audio/mpeg' and (data.startswith(b'ID3') or data[:1]==b'\xff') or mime in ('audio/wav','audio/x-wav') and data[:4]==b'RIFF' and data[8:12]==b'WAVE')
    if not data or len(data)>MAX_FILE: raise HTTPException(413,'Максимальный размер файла — 16 МБ')
    if not ok: raise HTTPException(400,'Поддерживаются JPEG, PNG, WebP, MP4, M4A, MP3, OGG, WAV и PDF')

def media_out(a):
    token=m.jwt.encode({'sub':a.id,'aud':'media','exp':datetime.now(timezone.utc)+timedelta(minutes=30)},m.SECRET_KEY,algorithm='HS256')
    return {'ready':bool(a.ready),'pending':bool(a.remote),'id':a.id,'name':a.name,'mime':a.mime,'purpose':a.purpose,'url':f'/api/media/{a.id}?ticket={token}','created_at':a.created_at.isoformat()}

@m.app.get('/api/media/{asset_id}')
def get_media(asset_id:str,ticket:str,request:Request,db=Depends(m.get_db)):
    try:
        payload=m.jwt.decode(ticket,m.SECRET_KEY,algorithms=['HS256'],audience='media')
        if payload['sub']!=asset_id: raise ValueError()
    except Exception: raise HTTPException(403,'Ссылка истекла. Обновите переписку.')
    a=db.get(Asset,asset_id)
    if not a or not a.data: raise HTTPException(404,'Файл недоступен или ещё загружается')
    data=a.data; headers={'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Accept-Ranges':'bytes'}
    r=request.headers.get('range','')
    if r:
        match=re.fullmatch(r'bytes=(\d+)-(\d*)',r)
        if not match: raise HTTPException(416,'Invalid range')
        start=int(match[1]);end=min(int(match[2]) if match[2] else len(data)-1,len(data)-1)
        if start>end: raise HTTPException(416,'Invalid range')
        headers['Content-Range']=f'bytes {start}-{end}/{len(data)}'
        return Response(data[start:end+1],status_code=206,media_type=a.mime,headers=headers)
    return Response(data,media_type=a.mime,headers=headers)

@m.app.post('/api/leads/{lead_id}/files',status_code=201)
async def upload(lead_id:int,request:Request,name:str='file',purpose:str='chat',db=Depends(m.get_db),user=Depends(m.current_user)):
    lead=db.get(m.Lead,lead_id)
    if not lead: raise HTTPException(404,'Сделка не найдена')
    m.city_access(user,lead.city_id)
    if purpose not in ('chat','receipt','product'): raise HTTPException(400,'Неверный тип файла')
    data=bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data)>MAX_FILE: raise HTTPException(413,'Максимальный размер файла — 16 МБ')
    mime=request.headers.get('content-type','').split(';')[0]
    validate_file(data,mime)
    a=Asset(lead_id=lead.id,name=name.replace('\\','/').split('/')[-1][:180],mime=mime,data=bytes(data),purpose=purpose)
    db.add(a);db.flush()
    m.log(db,user,'lead.file',f'{lead.id}: Прикреплён '+('чек' if purpose=='receipt' else 'файл товара' if purpose=='product' else 'файл для сообщения'))
    db.commit();return media_out(a)

@m.app.get('/api/leads/{lead_id}/files')
def files(lead_id:int,db=Depends(m.get_db),user=Depends(m.current_user)):
    lead=db.get(m.Lead,lead_id)
    if not lead: raise HTTPException(404,'Сделка не найдена')
    m.city_access(user,lead.city_id)
    return [media_out(a) for a in db.scalars(select(Asset).where(Asset.lead_id==lead_id,Asset.purpose!='chat').order_by(Asset.created_at.desc()))]

_media_send_lock=asyncio.Lock()
class MediaSend(BaseModel): asset_id:str; text:str=Field(default='',max_length=2000)
@m.app.post('/api/inbox/conversations/{cid}/media')
async def send_media(cid:int,body:MediaSend,request:Request,db=Depends(m.get_db),user=Depends(m.current_user)):
    async with _media_send_lock:
        return await _send_media(cid,body,request,db,user)

async def _send_media(cid,body,request,db,user):
    c=db.get(m.InstagramConversation,cid)
    if not c: raise HTTPException(404,'Диалог не найден')
    m.city_access(user,c.city_id)
    a=db.get(Asset,body.asset_id)
    if not a or a.lead_id!=c.lead_id or a.purpose!='chat' or not a.data: raise HTTPException(400,'Файл не принадлежит этой переписке')
    if a.message_id: raise HTTPException(409,'Файл уже отправлен')
    kind=a.mime.split('/')[0]
    if c.account_id.startswith('wa:'):
        result=await m.whatsapp_bridge('send',{'account':c.account_id[3:],'jid':c.sender_id,'text':body.text,'media':{'data':base64.b64encode(a.data).decode(),'mime':a.mime,'name':a.name},'asset_id':a.id})
        m.ingest_whatsapp(db,m.WhatsAppEvent(account=c.account_id[3:],sender=c.sender_id,mid=result['id'],text=body.text,direction='out',asset_id=a.id))
    else:
        if kind not in ('image','audio','video'): raise HTTPException(400,'Instagram поддерживает фото, аудио и видео; PDF отправьте в WhatsApp')
        host='graph.facebook.com' if os.getenv('IG_AUTH_MODE','facebook')=='facebook' else 'graph.instagram.com'
        domain=os.getenv('RAILWAY_PUBLIC_DOMAIN')
        base='https://'+domain if domain else str(request.base_url).rstrip('/')
        url=base+media_out(a)['url']
        try:
            async with httpx.AsyncClient(timeout=35) as client:
                r=await client.post(f'https://{host}/{m.IG_GRAPH_VERSION}/{c.account_id}/messages',headers={'Authorization':'Bearer '+m.IG_ACCESS_TOKEN},json={'recipient':{'id':c.sender_id},'message':{'attachment':{'type':kind,'payload':{'url':url}}}})
            r.raise_for_status()
        except httpx.HTTPError: raise HTTPException(502,'Meta не приняла файл. Проверьте формат, размер и окно ответа.')
        msg=m.InstagramMessage(conversation_id=c.id,direction='out',text='',external_id=r.json().get('message_id'))
        db.add(msg);db.flush();a.message_id=msg.id;db.commit()
    return {'ok':True}

def attach_incoming(db,msg,lead_id,attachments):
    for item in attachments[:10]:
        if item.get('asset_id'):
            a=db.get(Asset,item['asset_id'])
            if a and a.lead_id==lead_id and a.purpose=='chat' and not a.message_id: a.message_id=msg.id
            continue
        mime=item.get('mime','application/octet-stream').split(';')[0]
        data=None;remote=None
        if item.get('data'):
            try:
                data=base64.b64decode(item['data'],validate=True);validate_file(data,mime)
            except Exception: continue
        elif safe_remote(item.get('url','')): remote=item['url']
        else: continue
        db.add(Asset(lead_id=lead_id,message_id=msg.id,name=item.get('name','Вложение')[:180],mime=mime,data=data,remote=remote))

_profile_lock=threading.Lock()
def enrich():
    if not _profile_lock.acquire(False): return
    try:
        with m.SessionLocal() as db, httpx.Client(timeout=8,follow_redirects=False) as client:
            now=datetime.now(timezone.utc)
            if m.IG_ACCESS_TOKEN:
                rows=db.scalars(select(m.InstagramConversation).outerjoin(Profile,Profile.conversation_id==m.InstagramConversation.id).where(m.InstagramConversation.account_id==m.IG_ACCOUNT_ID,(Profile.retry_at==None)|(Profile.retry_at<now)).limit(10)).all()
                for c in rows:
                    p=db.get(Profile,c.id) or Profile(conversation_id=c.id)
                    p.retry_at=now+timedelta(hours=1);db.add(p)
                    try:
                        host='graph.facebook.com' if os.getenv('IG_AUTH_MODE','facebook')=='facebook' else 'graph.instagram.com'
                        r=client.get(f'https://{host}/{m.IG_GRAPH_VERSION}/{c.sender_id}',params={'fields':'username'},headers={'Authorization':'Bearer '+m.IG_ACCESS_TOKEN})
                        r.raise_for_status();username=r.json().get('username','')
                        if re.fullmatch(r'[a-zA-Z0-9_.]{1,30}',username):
                            customer=db.get(m.Customer,c.customer_id)
                            if customer.name in ('Instagram · '+c.sender_id[-12:], '@'+(p.username or '')): customer.name='@'+username
                            customer.instagram='@'+username;p.username=username;p.retry_at=now+timedelta(days=1)
                    except (httpx.HTTPError,ValueError,TypeError): pass
                    db.commit()
            for a in db.scalars(select(Asset).where(Asset.remote!=None).limit(10)):
                try:
                    if not safe_remote(a.remote): continue
                    with client.stream('GET',a.remote) as r:
                        r.raise_for_status();data=bytearray()
                        for chunk in r.iter_bytes():
                            data.extend(chunk)
                            if len(data)>MAX_FILE: raise ValueError()
                        mime=r.headers.get('content-type','').split(';')[0];validate_file(data,mime)
                        a.data=bytes(data);a.mime=mime
                except (httpx.HTTPError,ValueError,HTTPException): pass
                # Do not endlessly re-fetch expired/unsupported links.
                a.remote=None;db.commit()
    finally: _profile_lock.release()

@m.app.post('/api/inbox/conversations/{cid}/unread')
def unread(cid:int,db=Depends(m.get_db),user=Depends(m.current_user)):
    c=db.get(m.InstagramConversation,cid)
    if not c: raise HTTPException(404,'Диалог не найден')
    m.city_access(user,c.city_id)
    latest=db.scalar(select(func.max(m.InstagramMessage.id)).where(m.InstagramMessage.conversation_id==cid,m.InstagramMessage.direction=='in'))
    if latest:
        state=db.get(m.InstagramReadState,(user.id,cid)) or m.InstagramReadState(user_id=user.id,conversation_id=cid)
        state.last_message_id=latest-1;db.add(state);db.commit()
    return {'ok':True}

@m.app.get('/api/analytics')
def analytics(start:str='',end:str='',city_id:int|None=None,db=Depends(m.get_db),user=Depends(m.current_user)):
    try:
        lo=datetime.fromisoformat(start).replace(tzinfo=timezone.utc) if start else None
        hi=datetime.fromisoformat(end).replace(tzinfo=timezone.utc)+timedelta(days=1) if end else None
    except ValueError: raise HTTPException(400,'Неверная дата')
    ls=select(m.Lead);osq=select(m.Order)
    city=city_id if user.role=='admin' else user.city_id
    if city is not None: ls=ls.where(m.Lead.city_id==city);osq=osq.where(m.Order.city_id==city)
    if lo: ls=ls.where(m.Lead.created_at>=lo);osq=osq.where(m.Order.created_at>=lo)
    if hi: ls=ls.where(m.Lead.created_at<hi);osq=osq.where(m.Order.created_at<hi)
    leads=list(db.scalars(ls));orders=list(db.scalars(osq));paid=[o for o in orders if o.status=='paid']
    items=list(db.scalars(select(m.OrderItem).where(m.OrderItem.order_id.in_([o.id for o in paid])))) if paid else []
    totals={};products={};buyers={}
    for i in items:
        totals[i.order_id]=totals.get(i.order_id,0)+i.price*i.quantity
        key=(i.name,i.size or '—',i.color or '—');products[key]=products.get(key,0)+i.quantity
    revenue=0
    for o in paid:
        net=max(0,totals.get(o.id,0)-o.discount);revenue+=net
        l=db.get(m.Lead,o.lead_id);b=buyers.setdefault(l.customer_id,{'orders':0,'total':0,'name':db.get(m.Customer,l.customer_id).name});b['orders']+=1;b['total']+=net
    channels={}
    for l in leads:
        c=channels.setdefault(l.source,{'leads':0,'won':0});c['leads']+=1;c['won']+=l.stage=='success'
    # First manager reply per conversation, within selected lead cohort.
    convs=list(db.scalars(select(m.InstagramConversation).where(m.InstagramConversation.lead_id.in_([l.id for l in leads])))) if leads else []
    waits=[];unanswered=0
    for c in convs:
        rows=list(db.scalars(select(m.InstagramMessage).where(m.InstagramMessage.conversation_id==c.id).order_by(m.InstagramMessage.id)))
        first=next((x for x in rows if x.direction=='in'),None)
        reply=next((x for x in rows if first and x.direction=='out' and x.id>first.id),None)
        if reply: waits.append(max(0,(reply.created_at-first.created_at).total_seconds()/60))
        if rows and rows[-1].direction=='in': unanswered+=1
    return {'revenue':revenue,'paid_orders':len(paid),'average_order':round(revenue/len(paid)) if paid else 0,'repeat_buyers':sum(b['orders']>1 for b in buyers.values()),'products':[{'name':k[0],'size':k[1],'color':k[2],'quantity':v} for k,v in sorted(products.items(),key=lambda p:p[1],reverse=True)[:30]],'buyers':sorted(buyers.values(),key=lambda b:b['total'],reverse=True)[:20],'channels':channels,'unanswered':unanswered,'first_reply_minutes':round(sum(waits)/len(waits),1) if waits else None,'lead_count':len(leads)}
