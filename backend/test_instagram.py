"""Offline tests using a disposable SQLite database and mocked outbound Meta API."""
import hashlib
import hmac
import json
import os
import unittest
from unittest.mock import patch

os.environ.update(DATABASE_URL='sqlite://',
                  SECRET_KEY='test-only-' * 5, ADMIN_PASSWORD='test-admin-password',
                  META_APP_SECRET='test-app-secret', IG_VERIFY_TOKEN='test-verify',
                  IG_ACCOUNT_ID='account1', IG_PAGE_ID='page1', IG_ACCESS_TOKEN='fake-test-token',
                  ENABLE_DEMO_INGEST='false')
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app import main as m
from app.webhook_security import signature_status
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker
m.engine.dispose()
m.engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
m.SessionLocal=sessionmaker(m.engine)


class InstagramTests(unittest.TestCase):
    def test_cloud_health_and_static(self):
        self.assertEqual(self.client.get('/api/health').status_code,200)
        self.assertEqual(self.client.get('/api/customers').status_code,403)
        self.assertEqual(self.client.get('/api/unknown').status_code,404)
        if os.environ.get('STATIC_DIR'):
            page=self.client.get('/')
            self.assertEqual(page.status_code,200)
            self.assertIn('text/html',page.headers['content-type'])

    def setUp(self):
        self.enrich_patch=patch.object(m.features,'enrich');self.enrich_patch.start();self.addCleanup(self.enrich_patch.stop)
        m.Base.metadata.drop_all(m.engine)
        self.client = TestClient(m.app)
        self.client.__enter__()

    def tearDown(self):
        m.app.dependency_overrides.clear()
        self.client.__exit__(None, None, None)

    def test_unread_counts_read_cursor_and_new_arrival(self):
        self.post(self.payload())
        self.post(self.payload())  # Meta retry does not inflate counters.
        with m.SessionLocal() as db:
            admin=db.scalar(select(m.User).where(m.User.role=='admin'))
            m.app.dependency_overrides[m.current_user]=lambda:admin
            db.add(m.InstagramMessage(conversation_id=1,direction='out',text='reply'))
            db.commit()
            db.refresh(admin);db.expunge(admin)
        endpoint='/api/instagram/conversations'
        first=self.client.get(endpoint).json()[0]
        self.assertEqual((first['message_count'],first['unread_count']),(2,1))
        rows=self.client.get(endpoint+'/1/messages').json()
        self.assertEqual(self.client.get(endpoint).json()[0]['unread_count'],1)
        self.post(self.payload(mid='new-after-fetch'))
        read=lambda mid:self.client.post(endpoint+'/1/read',json={'last_message_id':mid})
        self.assertEqual(read(rows[-1]['id']).status_code,200)
        self.assertEqual(self.client.get(endpoint).json()[0]['unread_count'],1)
        self.assertEqual(read(3).status_code,200)
        self.assertEqual(read(1).status_code,200)  # Stale tab cannot roll back cursor.
        self.assertEqual(self.client.get(endpoint).json()[0]['unread_count'],0)
        self.assertEqual(read(99999).status_code,400)
        with m.SessionLocal() as db:
            self.assertEqual(db.get(m.InstagramReadState,(admin.id,1)).last_message_id,3)

    def test_read_state_is_personal_and_city_restricted(self):
        self.post(self.payload())
        with m.SessionLocal() as db:
            city=db.get(m.InstagramConversation,1).city_id
            admin=db.scalar(select(m.User).where(m.User.role=='admin'))
            colleague=m.User(username='colleague',full_name='Colleague',password_hash='unused',role='manager',city_id=city)
            outsider=m.User(username='outsider',full_name='Outsider',password_hash='unused',role='manager',city_id=city+1)
            db.add_all([colleague,outsider]);db.commit()
            for u in (admin,colleague,outsider):db.refresh(u);db.expunge(u)
            m.ingest_instagram(db,'account1','another-sender','Other conversation','other-mid')
        endpoint='/api/instagram/conversations'
        m.app.dependency_overrides[m.current_user]=lambda:admin
        self.assertEqual(self.client.post(endpoint+'/1/read',json={'last_message_id':2}).status_code,400)
        self.assertEqual(self.client.post(endpoint+'/1/read',json={'last_message_id':1}).status_code,200)
        m.app.dependency_overrides[m.current_user]=lambda:colleague
        conv=next(c for c in self.client.get(endpoint).json() if c['id']==1)
        self.assertEqual(conv['unread_count'],1)
        m.app.dependency_overrides[m.current_user]=lambda:outsider
        self.assertEqual(self.client.get(endpoint).json(),[])
        self.assertEqual(self.client.get(endpoint+'/1/messages').status_code,403)
        self.assertEqual(self.client.post(endpoint+'/1/read',json={'last_message_id':1}).status_code,403)

    def post(self, raw, secret='test-app-secret', signature=None):
        sig = signature if signature is not None else 'sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        return self.client.post('/api/webhooks/instagram', content=raw,
                                headers={'x-hub-signature-256':sig})

    def payload(self, mid='mid1', account='account1', echo=False):
        return json.dumps({'object':'instagram','entry':[{'id':account,'messaging':[
            {'sender':{'id':'customer1'},'recipient':{'id':account},
             'message':{'mid':mid,'text':'Привет, Өскемен!','is_echo':echo}}]}]}, ensure_ascii=False).encode()

    def count(self, model):
        with m.SessionLocal() as db:
            return db.scalar(select(func.count()).select_from(model))

    def test_signed_delivery_and_retry_deduplication(self):
        raw=self.payload()
        self.assertEqual(self.post(raw).status_code,200)
        self.assertEqual(self.post(raw).status_code,200)
        for model in (m.Customer,m.Lead,m.InstagramConversation,m.InstagramMessage):
            self.assertEqual(self.count(model),1)
        with m.SessionLocal() as db:
            self.assertEqual(db.scalar(select(m.Lead)).stage,'new')
            self.assertEqual(db.scalar(select(m.City.name).join(m.Lead,m.Lead.city_id==m.City.id)),'Семей')

    def test_rejects_wrong_missing_malformed_and_changed_bytes(self):
        raw=self.payload()
        sig='sha256='+hmac.new(b'test-app-secret',raw,hashlib.sha256).hexdigest()
        for candidate in ('','sha256=no','sha1='+'a'*64,'sha256='+'a'*64):
            self.assertEqual(self.post(raw,signature=candidate).status_code,403)
        self.assertEqual(self.post(raw,secret='wrong-secret').status_code,403)
        self.assertEqual(self.post(raw+b' ',signature=sig).status_code,403)
        self.assertEqual(signature_status(raw,'sha256='+'я'*64,'test-app-secret'),'malformed')
        self.assertEqual(self.count(m.Customer),0)

    def test_get_verification_and_json_errors(self):
        r=self.client.get('/api/webhooks/instagram',params={'hub.mode':'subscribe','hub.verify_token':'test-verify','hub.challenge':'123'})
        self.assertEqual((r.status_code,r.text),(200,'123'))
        self.assertEqual(self.client.get('/api/webhooks/instagram',params={'hub.verify_token':'bad'}).status_code,403)
        for raw in (b'{',b'[]',b'null'):
            self.assertEqual(self.post(raw).status_code,400)

    def test_ignores_echo_and_other_account(self):
        self.assertEqual(self.post(self.payload(echo=True)).status_code,200)
        self.assertEqual(self.post(self.payload(account='unrelated')).status_code,200)
        self.assertEqual(self.count(m.Lead),0)

    def test_logs_have_metadata_only(self):
        raw=self.payload()
        with self.assertLogs('uvicorn.error',level='INFO') as logs:
            self.post(raw,secret='wrong')
        output=' '.join(logs.output)
        self.assertIn('signature=mismatch',output)
        for private in ('test-app-secret','customer1','Привет','test-verify'):
            self.assertNotIn(private,output)

    def test_reply_with_mocked_meta(self):
        self.post(self.payload())
        token=self.client.post('/api/auth/login',json={'username':'admin','password':'test-admin-password'}).json()['access_token']
        class FakeClient:
            def __init__(self,**kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self,*args): pass
            async def post(self,url,**kwargs):
                import httpx
                self_test.assertEqual(kwargs['json']['recipient']['id'],'customer1')
                return httpx.Response(200,json={'message_id':'out1'},request=httpx.Request('POST',url))
        self_test=self
        with patch.object(m.httpx,'AsyncClient',FakeClient):
            r=self.client.post('/api/instagram/conversations/1/reply',json={'text':'Здравствуйте'},headers={'Authorization':'Bearer '+token})
        self.assertEqual(r.status_code,200)
        self.assertEqual(self.count(m.InstagramMessage),2)

    def test_whatsapp_ingest_and_city_authorization(self):
        data={'account':'77020000000','sender':'77010000000@s.whatsapp.net','mid':'msg1','text':'Test','name':'Test buyer'}
        with patch.dict(os.environ,{'WA_BRIDGE_SECRET':'bridge-test-only'}):
            self.assertEqual(self.client.post('/api/internal/whatsapp/events',json=data).status_code,403)
            for _ in range(2):
                self.assertEqual(self.client.post('/api/internal/whatsapp/events',json=data,headers={'Authorization':'Bearer bridge-test-only'}).status_code,200)
        self.assertEqual(self.count(m.InstagramMessage),1)
        with m.SessionLocal() as db:
            lead=db.scalar(select(m.Lead));self.assertEqual(lead.source,'whatsapp')
            self.assertEqual(db.scalar(select(m.Customer)).phone,'+77010000000')
            m.ingest_whatsapp(db,m.WhatsAppEvent(**{**data,'direction':'out','mid':'sent1'}))
            m.ingest_whatsapp(db,m.WhatsAppEvent(**{**data,'direction':'out','mid':'sent1'}))
            m.ingest_whatsapp(db,m.WhatsAppEvent(**{**data,'sender':'77033333333@s.whatsapp.net','direction':'out','mid':'unrelated'}))
        self.assertEqual(self.count(m.InstagramMessage),2)
        self.assertEqual(self.count(m.Lead),1)
        token=self.client.post('/api/auth/login',json={'username':'admin','password':'test-admin-password'}).json()['access_token']
        headers={'Authorization':'Bearer '+token}
        conv=self.client.get('/api/inbox/conversations',headers=headers).json()[0]
        self.assertEqual((conv['channel'],conv['unread_count'],conv['message_count']),('whatsapp',1,2))
        from unittest.mock import AsyncMock
        with patch.object(m,'whatsapp_bridge',new=AsyncMock(return_value={'id':'sent-from-crm'})) as bridge:
            self.assertEqual(self.client.post('/api/inbox/conversations/1/reply',json={'text':'Reply from CRM'},headers=headers).status_code,200)
            self.assertEqual(bridge.call_args.args[1]['account'],'77020000000')
        with m.SessionLocal() as db:
            m.ingest_whatsapp(db,m.WhatsAppEvent(**{**data,'direction':'out','mid':'sent-from-crm'}))
        self.assertEqual(self.count(m.InstagramMessage),3)
        self.assertEqual(self.client.get('/api/whatsapp/status').status_code,403)
        with m.SessionLocal() as db:
            outsider=m.User(username='outside',full_name='Outside',password_hash='unused',role='manager',city_id=2)
            db.add(outsider);db.commit();db.refresh(outsider);db.expunge(outsider)
        m.app.dependency_overrides[m.current_user]=lambda:outsider
        self.assertEqual(self.client.get('/api/inbox/conversations').json(),[])
        self.assertEqual(self.client.post('/api/inbox/conversations/1/reply',json={'text':'Test'}).status_code,403)
        self.assertEqual(self.client.get('/api/whatsapp/status').status_code,403)

    def test_details_comments_and_restricted_access(self):
        self.post(self.payload())
        token=self.client.post('/api/auth/login',json={'username':'admin','password':'test-admin-password'}).json()['access_token']
        headers={'Authorization':'Bearer '+token}
        data={'customer_name':'New name','phone':'+77010000000','manager_id':None,'notes':'Size M'}
        self.assertEqual(self.client.patch('/api/leads/1/details',json=data,headers=headers).status_code,200)
        self.assertEqual(self.client.patch('/api/leads/1/details',json={**data,'manager_id':9999},headers=headers).status_code,400)
        self.assertEqual(self.client.post('/api/leads/1/comments',json={'text':'Internal note'},headers=headers).status_code,201)
        rows=self.client.get('/api/leads/1/activity',headers=headers).json()
        self.assertEqual(rows[0]['text'],'Internal note')
        with m.SessionLocal() as db:
            self.assertEqual(db.get(m.Customer,1).name,'New name')
            outsider=m.User(id=999,role='manager',city_id=2)
        m.app.dependency_overrides[m.current_user]=lambda:outsider
        self.assertEqual(self.client.patch('/api/leads/1/details',json=data).status_code,403)
        self.assertEqual(self.client.get('/api/leads/1/activity').status_code,403)
        self.assertEqual(self.client.post('/api/leads/1/comments',json={'text':'Blocked'}).status_code,403)


if __name__=='__main__':
    unittest.main()
