import os
import hmac
import hashlib
import json
import logging
from .webhook_security import signature_status
import httpx
from fastapi import Request, Query
from sqlalchemy import UniqueConstraint
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from typing import Optional
import jwt
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, String, Integer, ForeignKey, DateTime, Numeric, Text, Boolean, select, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, Session, sessionmaker
from pwdlib import PasswordHash

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql+psycopg://aen:aen@db:5432/aen')
if DATABASE_URL.startswith(('postgres://','postgresql://')):
    DATABASE_URL = 'postgresql+psycopg://' + DATABASE_URL.split('://',1)[1]
SECRET_KEY = os.environ.get('SECRET_KEY', '')
if len(SECRET_KEY) < 32:
    raise RuntimeError('SECRET_KEY must be at least 32 characters')
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(engine)
hasher = PasswordHash.recommended()
security = HTTPBearer()

class Base(DeclarativeBase): pass
class City(Base):
    __tablename__='cities'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
class User(Base):
    __tablename__='users'
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20), default='manager')
    city_id: Mapped[Optional[int]] = mapped_column(ForeignKey('cities.id'), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
class Customer(Base):
    __tablename__='customers'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    instagram: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    city_id: Mapped[int] = mapped_column(ForeignKey('cities.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda:datetime.now(timezone.utc))
class Lead(Base):
    __tablename__='leads'
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey('customers.id'))
    city_id: Mapped[int] = mapped_column(ForeignKey('cities.id'))
    manager_id: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id'), nullable=True)
    stage: Mapped[str] = mapped_column(String(30), default='new')
    source: Mapped[str] = mapped_column(String(30), default='manual')
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    refusal_reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda:datetime.now(timezone.utc))
class InstagramConversation(Base):
    __tablename__='instagram_conversations'
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[str] = mapped_column(String(80), index=True)
    sender_id: Mapped[str] = mapped_column(String(80), index=True)
    city_id: Mapped[int] = mapped_column(ForeignKey('cities.id'))
    customer_id: Mapped[int] = mapped_column(ForeignKey('customers.id'))
    lead_id: Mapped[int] = mapped_column(ForeignKey('leads.id'))
    __table_args__=(UniqueConstraint('account_id','sender_id',name='uq_ig_conversation'),)
class InstagramMessage(Base):
    __tablename__='instagram_messages'
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey('instagram_conversations.id'))
    external_id: Mapped[Optional[str]] = mapped_column(String(255),unique=True,nullable=True)
    direction: Mapped[str] = mapped_column(String(12))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda:datetime.now(timezone.utc))

class Order(Base):
    __tablename__='orders'
    id: Mapped[int] = mapped_column(primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey('leads.id'))
    city_id: Mapped[int] = mapped_column(ForeignKey('cities.id'))
    status: Mapped[str] = mapped_column(String(30), default='pending')
    discount: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda:datetime.now(timezone.utc))
class OrderItem(Base):
    __tablename__='order_items'
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey('orders.id'))
    name: Mapped[str] = mapped_column(String(200))
    size: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    color: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer)
    price: Mapped[int] = mapped_column(Integer)
class Audit(Base):
    __tablename__='audit_logs'
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    action: Mapped[str] = mapped_column(String(100))
    detail: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda:datetime.now(timezone.utc))

@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        for name in ('Семей','Караганда','Өскемен'):
            if not db.scalar(select(City).where(City.name==name)): db.add(City(name=name))
        db.commit()
        admin_name=os.environ.get('ADMIN_USERNAME','admin')
        admin_password=os.environ.get('ADMIN_PASSWORD','')
        if not db.scalar(select(User).where(User.role=='admin')):
            if len(admin_password)<12: raise RuntimeError('ADMIN_PASSWORD must be at least 12 characters for initial setup')
            db.add(User(username=admin_name,password_hash=hasher.hash(admin_password),full_name='AEN Administrator',role='admin'))
            db.commit()
    yield
app=FastAPI(title='AEN CRM API',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
app.add_middleware(CORSMiddleware,allow_origins=[x.strip() for x in os.environ.get('CORS_ORIGINS','http://localhost:5173').split(',')],allow_credentials=True,allow_methods=['*'],allow_headers=['*'])

def get_db():
    with SessionLocal() as db: yield db

def current_user(credentials:HTTPAuthorizationCredentials=Depends(security),db:Session=Depends(get_db)):
    try:
        payload=jwt.decode(credentials.credentials,SECRET_KEY,algorithms=['HS256'])
        uid=int(payload['sub'])
    except Exception: raise HTTPException(401,'Недействительный токен')
    user=db.get(User,uid)
    if not user or not user.active: raise HTTPException(401,'Пользователь неактивен')
    return user

def admin_only(user:User=Depends(current_user)):
    if user.role!='admin': raise HTTPException(403,'Требуется администратор')
    return user

def city_access(user,city_id):
    if user.role!='admin' and user.city_id!=city_id: raise HTTPException(403,'Нет доступа к городу')

def log(db,user,action,detail): db.add(Audit(actor_id=user.id,action=action,detail=detail))

class LoginIn(BaseModel): username:str; password:str
class UserIn(BaseModel): username:str=Field(min_length=3); password:str=Field(min_length=12); full_name:str; city_id:Optional[int]=None; role:str='manager'
class CustomerIn(BaseModel): name:str=Field(min_length=1); city_id:int; phone:Optional[str]=None; instagram:Optional[str]=None; notes:Optional[str]=None
class LeadIn(BaseModel): customer_id:int; city_id:int; manager_id:Optional[int]=None; source:str='manual'; notes:Optional[str]=None
class StageIn(BaseModel): stage:str; refusal_reason:Optional[str]=None
class ItemIn(BaseModel): name:str; size:Optional[str]=None; color:Optional[str]=None; quantity:int=Field(gt=0); price:int=Field(ge=0)
class OrderIn(BaseModel): lead_id:int; city_id:int; status:str='pending'; discount:int=Field(ge=0); items:list[ItemIn]=Field(min_length=1)
class OrderStatusIn(BaseModel): status:str

@app.get('/api/health')
def health(db:Session=Depends(get_db)):
    db.execute(select(1))
    return {'ok':True}
@app.post('/api/auth/login')
def login(data:LoginIn,db:Session=Depends(get_db)):
    user=db.scalar(select(User).where(User.username==data.username))
    if not user or not user.active or not hasher.verify(data.password,user.password_hash): raise HTTPException(401,'Неверный логин или пароль')
    token=jwt.encode({'sub':str(user.id),'exp':datetime.now(timezone.utc)+timedelta(hours=8)},SECRET_KEY,algorithm='HS256')
    return {'access_token':token,'user':user_out(user)}
def user_out(u): return {'id':u.id,'username':u.username,'full_name':u.full_name,'role':u.role,'city_id':u.city_id,'active':u.active}
@app.get('/api/me')
def me(user:User=Depends(current_user)): return user_out(user)
@app.get('/api/cities')
def cities(db:Session=Depends(get_db),user:User=Depends(current_user)):
    return [{'id':x.id,'name':x.name} for x in db.scalars(select(City).order_by(City.id)) if user.role=='admin' or x.id==user.city_id]
@app.get('/api/users')
def users(db:Session=Depends(get_db),user:User=Depends(current_user)):
    rows=db.scalars(select(User).order_by(User.id)).all()
    return [user_out(x) for x in rows if user.role=='admin' or x.city_id==user.city_id]
@app.post('/api/users',status_code=201)
def create_user(data:UserIn,db:Session=Depends(get_db),user:User=Depends(admin_only)):
    if data.role not in ('admin','manager'): raise HTTPException(400,'Недопустимая роль')
    if data.role=='manager' and not db.get(City,data.city_id): raise HTTPException(400,'Выберите город')
    if db.scalar(select(User).where(User.username==data.username)): raise HTTPException(409,'Логин занят')
    obj=User(username=data.username,password_hash=hasher.hash(data.password),full_name=data.full_name,city_id=data.city_id,role=data.role)
    db.add(obj);db.flush();log(db,user,'user.create',str(obj.id));db.commit();return user_out(obj)
@app.get('/api/customers')
def customers(db:Session=Depends(get_db),user:User=Depends(current_user)):
    q=select(Customer).order_by(Customer.id.desc())
    if user.role!='admin':q=q.where(Customer.city_id==user.city_id)
    return [customer_out(x) for x in db.scalars(q)]
def customer_out(x):return {'id':x.id,'name':x.name,'phone':x.phone,'instagram':x.instagram,'notes':x.notes,'city_id':x.city_id}
@app.post('/api/customers',status_code=201)
def create_customer(data:CustomerIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
    city_access(user,data.city_id)
    if not db.get(City,data.city_id):raise HTTPException(400,'Город не найден')
    obj=Customer(**data.model_dump());db.add(obj);db.flush();log(db,user,'customer.create',str(obj.id));db.commit();return customer_out(obj)
@app.get('/api/leads')
def leads(db:Session=Depends(get_db),user:User=Depends(current_user)):
    q=select(Lead).order_by(Lead.id.desc())
    if user.role!='admin':q=q.where(Lead.city_id==user.city_id)
    return [lead_out(x,db) for x in db.scalars(q)]
def lead_out(x,db):
    customer=db.get(Customer,x.customer_id)
    return {'id':x.id,'customer_id':x.customer_id,'customer_name':customer.name if customer else '—','city_id':x.city_id,'manager_id':x.manager_id,'stage':x.stage,'source':x.source,'notes':x.notes,'refusal_reason':x.refusal_reason,'created_at':x.created_at.isoformat()}
@app.post('/api/leads',status_code=201)
def create_lead(data:LeadIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
    city_access(user,data.city_id)
    customer=db.get(Customer,data.customer_id)
    if not customer or customer.city_id!=data.city_id:raise HTTPException(400,'Клиент не найден в городе')
    if data.source not in ('manual','whatsapp','instagram','offline'):raise HTTPException(400,'Недопустимый источник')
    manager=db.get(User,data.manager_id) if data.manager_id else None
    if manager and (not manager.active or (manager.role!='admin' and manager.city_id!=data.city_id)):raise HTTPException(400,'Менеджер не подходит')
    obj=Lead(**data.model_dump());db.add(obj);db.flush();log(db,user,'lead.create',str(obj.id));db.commit();return lead_out(obj,db)
@app.patch('/api/leads/{lead_id}/stage')
def update_stage(lead_id:int,data:StageIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
    obj=db.get(Lead,lead_id)
    if not obj:raise HTTPException(404,'Лид не найден')
    city_access(user,obj.city_id)
    if data.stage not in ('new','working','payment','success','refusal'):raise HTTPException(400,'Недопустимый этап')
    if data.stage=='refusal' and not (data.refusal_reason or '').strip():raise HTTPException(400,'Укажите причину отказа')
    old=obj.stage;obj.stage=data.stage;obj.refusal_reason=data.refusal_reason if data.stage=='refusal' else None
    log(db,user,'lead.stage',f'{lead_id}: {old} -> {data.stage}');db.commit();return lead_out(obj,db)
@app.get('/api/orders')
def orders(db:Session=Depends(get_db),user:User=Depends(current_user)):
    q=select(Order).order_by(Order.id.desc())
    if user.role!='admin':q=q.where(Order.city_id==user.city_id)
    return [order_out(x,db) for x in db.scalars(q)]
def order_out(o,db):
    items=db.scalars(select(OrderItem).where(OrderItem.order_id==o.id)).all()
    return {'id':o.id,'lead_id':o.lead_id,'city_id':o.city_id,'status':o.status,'discount':o.discount,'total':max(0,sum(x.quantity*x.price for x in items)-o.discount),'items':[{'name':x.name,'size':x.size,'color':x.color,'quantity':x.quantity,'price':x.price} for x in items]}
@app.post('/api/orders',status_code=201)
def create_order(data:OrderIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
    city_access(user,data.city_id)
    lead=db.get(Lead,data.lead_id)
    if not lead or lead.city_id!=data.city_id:raise HTTPException(400,'Лид не найден в городе')
    if data.status not in ('pending','paid','cancelled'):raise HTTPException(400,'Недопустимый статус')
    if data.discount>sum(x.quantity*x.price for x in data.items):raise HTTPException(400,'Скидка больше суммы')
    obj=Order(lead_id=data.lead_id,city_id=data.city_id,status=data.status,discount=data.discount)
    db.add(obj);db.flush()
    for x in data.items:db.add(OrderItem(order_id=obj.id,**x.model_dump()))
    log(db,user,'order.create',str(obj.id));db.commit();return order_out(obj,db)
@app.patch('/api/orders/{order_id}/status')
def update_order(order_id:int,data:OrderStatusIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
    obj=db.get(Order,order_id)
    if not obj:raise HTTPException(404,'Заказ не найден')
    city_access(user,obj.city_id)
    if data.status not in ('pending','paid','cancelled'):raise HTTPException(400,'Недопустимый статус')
    obj.status=data.status;log(db,user,'order.status',f'{order_id}: {data.status}');db.commit();return order_out(obj,db)
@app.get('/api/stats')
def stats(db:Session=Depends(get_db),user:User=Depends(current_user)):
    leads_q=select(Lead)
    orders_q=select(Order)
    if user.role!='admin':
        leads_q=leads_q.where(Lead.city_id==user.city_id)
        orders_q=orders_q.where(Order.city_id==user.city_id)
    lead_rows=db.scalars(leads_q).all();order_rows=db.scalars(orders_q).all()
    paid=[x for x in order_rows if x.status=='paid']
    revenue=0
    for x in paid:revenue+=order_out(x,db)['total']
    return {'leads':len(lead_rows),'success':sum(x.stage=='success' for x in lead_rows),'refusal':sum(x.stage=='refusal' for x in lead_rows),'orders':len(order_rows),'paid_orders':len(paid),'revenue':revenue}

# Instagram messaging integration: webhook events are verified before storage.
IG_VERIFY_TOKEN=os.environ.get('IG_VERIFY_TOKEN','')
META_APP_SECRET=os.environ.get('META_APP_SECRET','')
IG_ACCOUNT_ID=os.environ.get('IG_ACCOUNT_ID','')
IG_PAGE_ID=os.environ.get('IG_PAGE_ID','')
IG_ACCESS_TOKEN=os.environ.get('IG_ACCESS_TOKEN','')
IG_CITY_NAME=os.environ.get('IG_CITY_NAME','Семей')
IG_GRAPH_VERSION=os.environ.get('IG_GRAPH_VERSION','v24.0')

def ingest_instagram(db:Session, account_id:str, sender_id:str, body:str, external_id:str):
    if not sender_id or not account_id: return False
    if external_id and db.scalar(select(InstagramMessage.id).where(InstagramMessage.external_id==external_id)):
        return False
    conv=db.scalar(select(InstagramConversation).where(InstagramConversation.account_id==account_id,InstagramConversation.sender_id==sender_id))
    if conv is None:
        city=db.scalar(select(City).where(City.name==IG_CITY_NAME)) or db.scalar(select(City).order_by(City.id))
        if not city: raise ValueError('No city configured')
        customer=Customer(name='Instagram · '+sender_id[-12:],instagram=sender_id,city_id=city.id,notes='Автоматически из Instagram Direct')
        db.add(customer);db.flush()
        manager=db.scalar(select(User).where(User.role=='manager',User.active==True,User.city_id==city.id).order_by(User.id))
        lead=Lead(customer_id=customer.id,city_id=city.id,manager_id=manager.id if manager else None,source='instagram',notes='Автоматически создан из Instagram Direct')
        db.add(lead);db.flush()
        conv=InstagramConversation(account_id=account_id,sender_id=sender_id,city_id=city.id,customer_id=customer.id,lead_id=lead.id)
        db.add(conv);db.flush()
    db.add(InstagramMessage(conversation_id=conv.id,external_id=external_id or None,direction='in',text=body or '[Вложение или неподдерживаемый тип сообщения]'))
    db.commit()
    return True

@app.get('/api/webhooks/instagram')
def verify_instagram(request:Request):
    q=request.query_params
    if not IG_VERIFY_TOKEN: raise HTTPException(503,'Webhook is not configured')
    if q.get('hub.mode')=='subscribe' and hmac.compare_digest(q.get('hub.verify_token',''),IG_VERIFY_TOKEN):
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse(q.get('hub.challenge',''))
    raise HTTPException(403,'Verification failed')

@app.post('/api/webhooks/instagram')
async def instagram_webhook(request:Request):
    if not META_APP_SECRET: raise HTTPException(503,'App secret is not configured')
    raw=await request.body()
    signature=request.headers.get('x-hub-signature-256','')
    result=signature_status(raw,signature,META_APP_SECRET)
    logging.getLogger('uvicorn.error').info(
        'Instagram webhook signature=%s prefix_ok=%s header_length=%d body_bytes=%d',
        result,signature.startswith('sha256='),len(signature),len(raw))
    if result!='valid': raise HTTPException(403,'Invalid signature')
    try: payload=json.loads(raw)
    except (ValueError,UnicodeDecodeError): raise HTTPException(400,'Invalid JSON')
    if not isinstance(payload,dict): raise HTTPException(400,'Invalid JSON object')
    if payload.get('object') not in ('instagram','page'): return {'ok':True}
    with SessionLocal() as db:
        for entry in payload.get('entry',[]):
            account_id=str(entry.get('id',''))
            for event in entry.get('messaging',[]):
                message=event.get('message') or {}
                if not message or message.get('is_echo'): continue
                sender=str((event.get('sender') or {}).get('id',''))
                recipient=str((event.get('recipient') or {}).get('id',''))
                if IG_ACCOUNT_ID and account_id not in (IG_ACCOUNT_ID,IG_PAGE_ID) and recipient not in (IG_ACCOUNT_ID,IG_PAGE_ID): continue
                if sender in (IG_ACCOUNT_ID,IG_PAGE_ID): continue
                ingest_instagram(db,IG_ACCOUNT_ID or account_id,sender,str(message.get('text') or ''),str(message.get('mid') or '') )
    return {'ok':True}

@app.get('/api/instagram/conversations')
def instagram_conversations(db:Session=Depends(get_db),user:User=Depends(current_user)):
    stmt=select(InstagramConversation).order_by(InstagramConversation.id.desc())
    if user.role!='admin': stmt=stmt.where(InstagramConversation.city_id==user.city_id)
    out=[]
    for c in db.scalars(stmt):
        customer=db.get(Customer,c.customer_id)
        last=db.scalar(select(InstagramMessage).where(InstagramMessage.conversation_id==c.id).order_by(InstagramMessage.id.desc()))
        out.append({'id':c.id,'customer_name':customer.name if customer else 'Instagram','sender_id':c.sender_id,'city_id':c.city_id,'lead_id':c.lead_id,'last_message':last.text if last else '', 'last_direction':last.direction if last else ''})
    return out

@app.get('/api/instagram/status')
def instagram_status(user:User=Depends(current_user)):
    return {'configured':bool(META_APP_SECRET and IG_ACCESS_TOKEN and IG_ACCOUNT_ID and IG_VERIFY_TOKEN),
            'demo_enabled':user.role=='admin' and os.environ.get('ENABLE_DEMO_INGEST','false').lower()=='true'}

@app.get('/api/instagram/conversations/{conversation_id}/messages')
def conversation_messages(conversation_id:int,db:Session=Depends(get_db),user:User=Depends(current_user)):
    conv=db.get(InstagramConversation,conversation_id)
    if not conv: raise HTTPException(404,'Диалог не найден')
    city_access(user,conv.city_id)
    return [{'id':m.id,'direction':m.direction,'text':m.text,'created_at':m.created_at.isoformat()} for m in db.scalars(select(InstagramMessage).where(InstagramMessage.conversation_id==conversation_id).order_by(InstagramMessage.id))]

class ReplyIn(BaseModel): text:str=Field(min_length=1,max_length=2000)
@app.post('/api/instagram/conversations/{conversation_id}/reply')
async def reply_instagram(conversation_id:int,data:ReplyIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
    conv=db.get(InstagramConversation,conversation_id)
    if not conv: raise HTTPException(404,'Диалог не найден')
    city_access(user,conv.city_id)
    if not IG_ACCESS_TOKEN or not IG_ACCOUNT_ID: raise HTTPException(503,'Instagram token/account not configured')
    url=f'https://graph.instagram.com/{IG_GRAPH_VERSION}/{IG_ACCOUNT_ID}/messages'
    # Instagram API with Instagram Login uses graph.instagram.com; Facebook Login uses graph.facebook.com.
    if os.environ.get('IG_AUTH_MODE','facebook')=='facebook':
        url=f'https://graph.facebook.com/{IG_GRAPH_VERSION}/{IG_ACCOUNT_ID}/messages'
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response=await client.post(url,headers={'Authorization':'Bearer '+IG_ACCESS_TOKEN},json={'recipient':{'id':conv.sender_id},'message':{'text':data.text}})
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(502,'Meta не приняла сообщение; проверьте токен, права и окно переписки') from exc
    db.add(InstagramMessage(conversation_id=conv.id,direction='out',text=data.text,external_id=(response.json().get('message_id') or None)))
    db.commit()
    return {'ok':True}

class DemoIn(BaseModel): sender_id:str=Field(min_length=2); text:str=Field(min_length=1)
@app.post('/api/instagram/demo-incoming')
def demo_incoming(data:DemoIn,db:Session=Depends(get_db),user:User=Depends(admin_only)):
    if os.environ.get('ENABLE_DEMO_INGEST','false').lower()!='true': raise HTTPException(404,'Demo disabled')
    ingest_instagram(db,IG_ACCOUNT_ID or 'demo-instagram',data.sender_id,data.text,'demo-'+os.urandom(12).hex())
    return {'ok':True}

# Railway serves the built frontend from the same origin as the API.
if os.environ.get('STATIC_DIR'):
    from fastapi.staticfiles import StaticFiles
    from pathlib import Path
    from fastapi.responses import FileResponse
    static_dir=Path(os.environ['STATIC_DIR']).resolve()
    app.mount('/assets',StaticFiles(directory=static_dir/'assets'),name='assets')
    @app.get('/')
    def frontend_index():
        return FileResponse(static_dir/'index.html',headers={'Cache-Control':'no-cache'})
