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
        m.Base.metadata.drop_all(m.engine)
        self.client = TestClient(m.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

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


if __name__=='__main__':
    unittest.main()
