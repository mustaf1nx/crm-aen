import unittest
from unittest.mock import patch, AsyncMock
from fastapi import HTTPException
from sqlalchemy import select
import test_instagram as base
from test_instagram import m

class OwnershipTests(unittest.TestCase):
    setUp=base.InstagramTests.setUp
    tearDown=base.InstagramTests.tearDown
    def prepare(self):
        with m.SessionLocal() as db:
            m.ingest_whatsapp(db,m.WhatsAppEvent(account='77020000000',sender='77010000000@s.whatsapp.net',mid='start',text='Hello'))
            users=[m.User(username='manager'+str(i),full_name='Manager '+str(i),password_hash='unused',role='manager',city_id=1,active=True) for i in (1,2)]
            db.add_all(users);db.commit()
            admin=db.scalar(select(m.User).where(m.User.role=='admin'))
            for u in [*users,admin]:db.refresh(u);db.expunge(u)
        self.one,self.two,self.admin=*users,admin
        self.as_user(self.one)
    def as_user(self,user):m.app.dependency_overrides[m.current_user]=lambda:user
    def reply(self):return self.client.post('/api/inbox/conversations/1/reply',json={'text':'Reply'})
    def owner(self):
        with m.SessionLocal() as db:return db.get(m.Lead,1).manager_id
    def test_first_reply_transfer_admin_and_bypass(self):
        self.prepare();self.assertIsNone(self.owner())
        with patch.object(m,'whatsapp_bridge',new=AsyncMock(return_value={'id':'reply1'})) as bridge:
            self.assertEqual(self.reply().status_code,200)
            self.assertEqual(self.owner(),self.one.id)
            self.as_user(self.two)
            self.assertEqual(self.client.get('/api/inbox/conversations').json(),[])
            self.assertEqual(self.client.get('/api/inbox/conversations/1/messages').status_code,403)
            self.assertEqual(self.client.get('/api/instagram/conversations/1/messages').status_code,403)
            self.assertEqual(self.client.get('/api/leads/1/activity').status_code,403)
            self.assertEqual(self.reply().status_code,403)
            self.assertEqual(self.client.post('/api/instagram/conversations/1/reply',json={'text':'Bypass'}).status_code,403)
            self.assertEqual(bridge.await_count,1)
            self.assertEqual(self.client.post('/api/leads/1/transfer',json={'manager_id':self.two.id}).status_code,403)
            self.assertEqual(self.client.patch('/api/leads/1/details',json={'customer_name':'Hijack','manager_id':self.two.id}).status_code,403)
            self.as_user(self.one)
            self.assertEqual(self.client.post('/api/leads/1/transfer',json={'manager_id':self.two.id}).status_code,200)
            self.assertEqual(self.reply().status_code,403)
            self.as_user(self.two)
            self.assertEqual(self.client.post('/api/leads/1/transfer',json={'manager_id':self.admin.id}).status_code,200)
            self.as_user(self.admin)
            bridge.return_value={'id':'adminreply'}
            self.assertEqual(self.reply().status_code,200)
            self.assertEqual(self.owner(),self.admin.id)
            self.assertTrue(any(x['action']=='lead.transfer' for x in self.client.get('/api/leads/1/activity').json()))
    def test_failed_send_does_not_claim_and_media_is_guarded(self):
        self.prepare()
        with patch.object(m,'whatsapp_bridge',new=AsyncMock(side_effect=HTTPException(502,'Offline'))):
            self.assertEqual(self.reply().status_code,502)
        self.assertIsNone(self.owner())
        asset=self.client.post('/api/leads/1/files?name=product.jpg',content=b'\xff\xd8\xffphoto',headers={'Content-Type':'image/jpeg'}).json()
        with patch.object(m,'whatsapp_bridge',new=AsyncMock(return_value={'id':'media1'})) as bridge:
            self.assertEqual(self.client.post('/api/inbox/conversations/1/media',json={'asset_id':asset['id']}).status_code,200)
            self.assertEqual(self.owner(),self.one.id)
            self.as_user(self.two)
            self.assertEqual(self.client.post('/api/leads/1/files?name=other.jpg',content=b'\xff\xd8\xffphoto',headers={'Content-Type':'image/jpeg'}).status_code,403)
            self.assertEqual(bridge.await_count,1)
    def test_hidden_media_and_read_routes_after_assignment(self):
        self.prepare();self.as_user(self.two)
        asset=self.client.post('/api/leads/1/files?name=photo.jpg',content=b'\xff\xd8\xffphoto',headers={'Content-Type':'image/jpeg'}).json()
        self.assertEqual(self.client.get(asset['url']).status_code,200)
        self.as_user(self.admin)
        self.assertEqual(self.client.post('/api/leads/1/transfer',json={'manager_id':self.one.id}).status_code,200)
        self.as_user(self.two)
        self.assertEqual(self.client.get(asset['url']).status_code,403)
        self.assertEqual(self.client.get('/api/leads/1/files').status_code,403)
        self.assertEqual(self.client.post('/api/inbox/conversations/1/read',json={'last_message_id':1}).status_code,403)
        self.assertEqual(self.client.post('/api/inbox/conversations/1/unread',json={}).status_code,403)
        self.assertEqual(self.client.post('/api/leads/1/comments',json={'text':'Hidden'}).status_code,403)
        self.as_user(self.admin)
        self.assertEqual(len(self.client.get('/api/inbox/conversations').json()),1)
        self.assertEqual(self.client.get('/api/inbox/conversations/1/messages').status_code,200)

    def test_transfer_targets_and_admin_directory(self):
        self.prepare()
        self.assertIn(self.admin.id,[u['id'] for u in self.client.get('/api/users').json()])
        self.assertEqual(self.client.post('/api/leads/1/transfer',json={'manager_id':self.two.id}).status_code,403)
        self.as_user(self.admin)
        self.assertEqual(self.client.post('/api/leads/1/transfer',json={'manager_id':99999}).status_code,400)
        with m.SessionLocal() as db:
            other=m.User(username='elsewhere',full_name='Other',password_hash='unused',role='manager',city_id=2,active=True)
            db.add(other);db.commit();uid=other.id
        self.assertEqual(self.client.post('/api/leads/1/transfer',json={'manager_id':uid}).status_code,400)

if __name__=='__main__':unittest.main()
