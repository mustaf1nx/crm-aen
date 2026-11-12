import base64
from unittest.mock import patch, AsyncMock
import httpx
import unittest
import test_instagram as base
from test_instagram import m
from sqlalchemy import select
from app import features as f

class FeaturesTests(unittest.TestCase):
    setUp=base.InstagramTests.setUp
    tearDown=base.InstagramTests.tearDown
    post=base.InstagramTests.post
    payload=base.InstagramTests.payload
    def login(self):
        return {'Authorization':'Bearer '+self.client.post('/api/auth/login',json={'username':'admin','password':'test-admin-password'}).json()['access_token']}
    def test_media_scope_and_private_receipts(self):
        self.post(self.payload());h=self.login();data=b'\x89PNG\r\n\x1a\n'+b'test'
        r=self.client.post('/api/leads/1/files?purpose=receipt&name=check.png',content=data,headers={**h,'Content-Type':'image/png'})
        self.assertEqual(r.status_code,201,r.text);asset=r.json()
        self.assertEqual(self.client.get(asset['url']).content,data)
        self.assertEqual(self.client.get(asset['url'].replace('ticket=','ticket=x')).status_code,403)
        self.assertEqual(self.client.post('/api/inbox/conversations/1/media',json={'asset_id':asset['id']},headers=h).status_code,400)
        self.assertEqual(self.client.get('/api/leads',headers=h).json()[0]['receipt_count'],1)
        self.assertEqual(self.client.post('/api/leads/1/files',content=b'<script>',headers={**h,'Content-Type':'image/png'}).status_code,400)
        with m.SessionLocal() as db:
            u=m.User(id=900,role='manager',city_id=2)
        m.app.dependency_overrides[m.current_user]=lambda:u
        self.assertEqual(self.client.get('/api/leads/1/files').status_code,403)
    def test_whatsapp_media_ingestion_and_send(self):
        with m.SessionLocal() as db:
            m.ingest_whatsapp(db,m.WhatsAppEvent(account='77020000000',sender='77010000000@s.whatsapp.net',mid='image1',text='',attachments=[{'data':base64.b64encode(b'\xff\xd8\xffphoto').decode(),'mime':'image/jpeg','name':'photo.jpg'}]))
        h=self.login();rows=self.client.get('/api/inbox/conversations/1/messages',headers=h).json()
        self.assertEqual(len(rows[0]['attachments']),1)
        a=self.client.post('/api/leads/1/files?name=product.jpg',content=b'\xff\xd8\xffphoto',headers={**h,'Content-Type':'image/jpeg'}).json()
        with patch.object(m,'whatsapp_bridge',new=AsyncMock(return_value={'id':'out-media'})):
            r=self.client.post('/api/inbox/conversations/1/media',json={'asset_id':a['id']},headers=h)
        self.assertEqual(r.status_code,200,r.text)
        rows=self.client.get('/api/inbox/conversations/1/messages',headers=h).json()
        self.assertEqual(len(rows[-1]['attachments']),1)
        self.assertEqual(self.client.post('/api/inbox/conversations/1/media',json={'asset_id':a['id']},headers=h).status_code,409)
    def test_unread_and_analytics(self):
        self.post(self.payload());h=self.login()
        self.client.post('/api/inbox/conversations/1/read',json={'last_message_id':1},headers=h)
        self.client.post('/api/inbox/conversations/1/unread',headers=h)
        self.assertEqual(self.client.get('/api/inbox/conversations',headers=h).json()[0]['unread_count'],1)
        order={'lead_id':1,'city_id':1,'status':'paid','discount':100,'items':[{'name':'Куртка','size':'M','color':'Чёрный','quantity':2,'price':1000}]}
        r=self.client.post('/api/orders',json=order,headers=h);self.assertEqual(r.status_code,201,r.text)
        a=self.client.get('/api/analytics',headers=h).json()
        self.assertEqual((a['revenue'],a['paid_orders'],a['products'][0]['quantity'],a['unanswered']),(1900,1,2,1))
        self.assertEqual(self.client.get('/api/analytics?start=invalid',headers=h).status_code,400)
    def test_profile_cache_preserves_custom_names(self):
        self.post(self.payload());self.enrich_patch.stop()
        class Client:
            calls=0
            def __init__(self,**kw): pass
            def __enter__(self):return self
            def __exit__(self,*args): pass
            def get(self,url,**kw):
                Client.calls+=1
                return httpx.Response(200,json={'username':'test.buyer'},request=httpx.Request('GET',url))
        with patch.object(f.httpx,'Client',Client):
            f.enrich();f.enrich()
        self.assertEqual(Client.calls,1)
        with m.SessionLocal() as db:
            c=db.get(m.Customer,1);self.assertEqual(c.name,'@test.buyer');c.name='Свой клиент'
            p=db.get(f.Profile,1);p.retry_at=m.datetime.now(m.timezone.utc)-m.timedelta(days=1);db.commit()
        with patch.object(f.httpx,'Client',Client):f.enrich()
        with m.SessionLocal() as db:self.assertEqual(db.get(m.Customer,1).name,'Свой клиент')
    def test_revision_and_rollback(self):
        before=f._revision
        self.post(self.payload());self.assertGreater(f._revision,before)
        before=f._revision
        with m.SessionLocal() as db:
            db.add(m.City(name='rollback'));db.flush();db.rollback()
        self.assertEqual(f._revision,before)
    def test_event_stream_emits_commit_without_customer_data(self):
        import asyncio
        class Request:
            async def is_disconnected(self): return False
        async def check():
            with m.SessionLocal() as db:
                user=db.scalar(select(m.User).where(m.User.role=='admin'))
                response=await f.events(Request(),user,db)
                first=await anext(response.body_iterator)
                with m.SessionLocal() as changed:
                    changed.add(m.City(name='Stream test'));changed.commit()
                second=await anext(response.body_iterator)
                self.assertNotEqual(first,second)
                self.assertNotIn('Stream test',second)
                await response.body_iterator.aclose()
        asyncio.run(check())

    def test_instagram_media_uses_scoped_recipient_and_signed_url(self):
        self.post(self.payload());h=self.login()
        a=self.client.post('/api/leads/1/files?name=photo.jpg',content=b'\xff\xd8\xffphoto',headers={**h,'Content-Type':'image/jpeg'}).json()
        captured=[]
        class Client:
            def __init__(self,**kw): pass
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,url,**kw):
                captured.append(kw['json']);return httpx.Response(200,json={'message_id':'media-out'},request=httpx.Request('POST',url))
        with patch.object(m.httpx,'AsyncClient',Client):
            r=self.client.post('/api/inbox/conversations/1/media',json={'asset_id':a['id']},headers=h)
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(captured[0]['recipient']['id'],'customer1')
        self.assertEqual(captured[0]['message']['attachment']['type'],'image')
        self.assertIn('/api/media/',captured[0]['message']['attachment']['payload']['url'])
        self.assertEqual(len(self.client.get('/api/inbox/conversations/1/messages',headers=h).json()[-1]['attachments']),1)
    def test_validation_and_stable_media_links(self):
        self.post(self.payload());h=self.login()
        self.assertEqual(self.client.get('/api/analytics?start=2026-11-12&end=2026-11-01',headers=h).status_code,400)
        self.assertEqual(self.client.post('/api/leads',json={'customer_id':1,'city_id':1,'manager_id':9999},headers=h).status_code,400)
        self.assertEqual(self.client.post('/api/customers',json={'name':'  ','city_id':1},headers=h).status_code,400)
        a=self.client.post('/api/leads/1/files?name=photo.jpg',content=b'\xff\xd8\xffphoto',headers={**h,'Content-Type':'image/jpeg'}).json()
        with m.SessionLocal() as db:
            asset=db.get(f.Asset,a['id'])
            with patch.object(f.time,'time',return_value=1800000010): first=f.media_out(asset)['url']
            with patch.object(f.time,'time',return_value=1800000015): second=f.media_out(asset)['url']
            self.assertEqual(first,second)
        r=self.client.get(a['url'],headers={'Range':'bytes=-3'})
        self.assertEqual((r.status_code,r.content),(206,b'oto'))
        self.assertEqual(self.client.get(a['url'],headers={'Range':'bytes=-0'}).status_code,416)

    def test_transient_media_error_retries_then_completes(self):
        self.post(self.payload());self.enrich_patch.stop()
        with m.SessionLocal() as db:
            a=f.Asset(lead_id=1,message_id=1,name='photo.jpg',mime='image/jpeg',remote='https://test.cdninstagram.com/photo')
            db.add(a);db.commit();aid=a.id
        class Download:
            headers={'content-type':'image/jpeg'}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def raise_for_status(self):pass
            def iter_bytes(self):yield b'\xff\xd8\xffphoto'
        class Client:
            calls=0
            def __init__(self,**kw):pass
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def stream(self,*args):
                Client.calls+=1
                if Client.calls==1:raise httpx.ReadTimeout('test')
                return Download()
        with patch.object(m,'IG_ACCESS_TOKEN',''),patch.object(f.httpx,'Client',Client):
            f.enrich();f.enrich()
            self.assertEqual(Client.calls,1)
            with m.SessionLocal() as db:
                self.assertIsNotNone(db.get(f.Asset,aid).remote)
                db.get(f.MediaRetry,aid).retry_at=m.datetime.now(m.timezone.utc)-m.timedelta(minutes=1);db.commit()
            f.enrich()
        with m.SessionLocal() as db:
            a=db.get(f.Asset,aid)
            self.assertTrue(a.ready);self.assertIsNone(a.remote)
