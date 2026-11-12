import unittest,os
from unittest.mock import patch,AsyncMock
import httpx
from sqlalchemy import select,func
import test_instagram as base
from test_instagram import m
class AITests(unittest.TestCase):
    setUp=base.InstagramTests.setUp
    tearDown=base.InstagramTests.tearDown
    def prepare(self):
        base.InstagramTests.post(self,base.InstagramTests.payload(self))
        with m.SessionLocal() as db:
            admin=db.scalar(select(m.User).where(m.User.role=='admin'));db.expunge(admin)
        m.app.dependency_overrides[m.current_user]=lambda:admin
    def test_draft_no_delivery_and_request_shape(self):
        self.prepare()
        response=httpx.Response(200,json={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'Какой цвет вам нужен?'}]}],'usage':{'input_tokens':40,'output_tokens':10}})
        with patch.dict(os.environ,{'AI_PROVIDER':'openai','OPENAI_API_KEY':'test-only'}),patch('httpx.AsyncClient.post',new=AsyncMock(return_value=response)) as call,patch.object(m,'whatsapp_bridge',new=AsyncMock()) as bridge:
            result=self.client.post('/api/inbox/conversations/1/ai-draft')
            self.assertEqual(result.status_code,200,result.text);self.assertEqual(result.json()['text'],'Какой цвет вам нужен?')
            self.assertFalse(call.call_args.kwargs['json']['store']);self.assertEqual(call.call_args.args[0],'https://api.openai.com/v1/responses');bridge.assert_not_called()
        with m.SessionLocal() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(m.InstagramMessage)),1)
            self.assertIsNone(db.get(m.Lead,1).manager_id)
    def test_missing_key_and_error_redaction(self):
        self.prepare()
        with patch.dict(os.environ,{'AI_PROVIDER':'openai','OPENAI_API_KEY':''}):self.assertEqual(self.client.post('/api/ai/test').status_code,503)
        with patch.dict(os.environ,{'AI_PROVIDER':'openai','OPENAI_API_KEY':'secret-value'}),patch('httpx.AsyncClient.post',new=AsyncMock(return_value=httpx.Response(401,text='secret-value'))):
            r=self.client.post('/api/ai/test');self.assertEqual(r.status_code,502);self.assertNotIn('secret-value',r.text)
    def test_access_and_daily_limit(self):
        self.prepare()
        with m.SessionLocal() as db:
            manager=m.User(username='ai-manager',full_name='Manager',password_hash='unused',role='manager',city_id=1,active=True)
            db.add(manager);db.flush();db.get(m.Lead,1).manager_id=999
            db.commit();db.refresh(manager);db.expunge(manager)
        m.app.dependency_overrides[m.current_user]=lambda:manager
        self.assertEqual(self.client.post('/api/ai/test').status_code,403)
        self.assertEqual(self.client.post('/api/inbox/conversations/1/ai-draft').status_code,403)
        with m.SessionLocal() as db:
            db.get(m.Lead,1).manager_id=None;m.log(db,manager,'ai.request','test');db.commit()
        with patch.dict(os.environ,{'AI_PROVIDER':'openai','OPENAI_API_KEY':'test','AI_DAILY_REQUEST_LIMIT':'1'}),patch('httpx.AsyncClient.post',new=AsyncMock()) as call:
            self.assertEqual(self.client.post('/api/inbox/conversations/1/ai-draft').status_code,429);call.assert_not_called()

    def test_gemini_draft_and_safe_output(self):
        self.prepare()
        from app import ai
        response=httpx.Response(200,json={'candidates':[{'finishReason':'STOP','content':{'parts':[{'thought':True,'text':'hidden reasoning'},{'text':'Which color?'}]}}]})
        with patch.dict(os.environ,{'AI_PROVIDER':'gemini','GEMINI_API_KEY':'test-key'}),patch('httpx.AsyncClient.post',new=AsyncMock(return_value=response)) as call:
            result=self.client.post('/api/inbox/conversations/1/ai-draft')
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()['text'],'Which color?')
            self.assertIn('gemini-3.1-flash-lite:generateContent',call.call_args.args[0])
            self.assertNotIn('test-key',call.call_args.args[0])
            self.assertEqual(call.call_args.kwargs['headers']['x-goog-api-key'],'test-key')
            for payload in ({'candidates':[]},{'candidates':[{'finishReason':'MAX_TOKENS','content':{'parts':[{'text':'partial'}]}}]}):
                call.return_value=httpx.Response(200,json=payload)
                self.assertEqual(self.client.post('/api/ai/test').status_code,502)
        with m.SessionLocal() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(m.InstagramMessage)),1)
            self.assertIsNone(db.get(m.Lead,1).manager_id)
