"""Workflow persistence, access control and inbox ordering; no external sends."""
import unittest
from sqlalchemy import select
import test_instagram as base
from test_instagram import m
import test_ownership as ownership


class WorkflowTests(unittest.TestCase):
    setUp = base.InstagramTests.setUp
    tearDown = base.InstagramTests.tearDown
    prepare = ownership.OwnershipTests.prepare
    as_user = ownership.OwnershipTests.as_user

    def test_tasks_order_completion_transfer_and_privacy(self):
        self.prepare()
        route='/api/leads/1/tasks'
        first=self.client.post(route,json={'title':'Без срока'})
        self.assertEqual(first.status_code,201)
        timed=self.client.post(route,json={'title':'Отправить фото','due_at':'2030-01-01T12:00:00+05:00'})
        self.assertEqual(timed.status_code,201)
        task=timed.json()
        lead=self.client.get('/api/leads').json()[0]
        self.assertEqual(lead['task_count'],2)
        self.assertEqual(lead['next_task']['title'],'Отправить фото')
        self.assertIsNone(lead['manager_id'])  # Creating a task does not claim the conversation.
        self.assertEqual(self.client.patch(f'{route}/{task["id"]}',json={'done':True}).status_code,200)
        lead=self.client.get('/api/leads').json()[0]
        self.assertEqual(lead['task_count'],1)
        self.assertEqual(lead['next_task']['title'],'Без срока')
        self.assertEqual(self.client.patch(f'{route}/{task["id"]}',json={'done':False}).status_code,200)
        self.as_user(self.admin)
        self.assertEqual(self.client.post('/api/leads/1/transfer',json={'manager_id':self.one.id}).status_code,200)
        self.as_user(self.two)
        self.assertEqual(self.client.get(route).status_code,403)
        self.assertEqual(self.client.post(route,json={'title':'Bypass'}).status_code,403)
        self.assertEqual(self.client.patch(f'{route}/{task["id"]}',json={'done':True}).status_code,403)
        lead=self.client.get('/api/leads').json()[0]
        self.assertEqual((lead['task_count'],lead['next_task']),(0,None))
        self.as_user(self.one)
        self.assertEqual(len(self.client.get(route).json()),2)
        self.assertEqual(self.client.post('/api/leads/1/transfer',json={'manager_id':self.two.id}).status_code,200)
        self.assertEqual(self.client.get(route).status_code,403)
        self.as_user(self.two)
        self.assertEqual(len(self.client.get(route).json()),2)
        self.as_user(self.admin)
        self.assertEqual(len(self.client.get(route).json()),2)
        self.assertTrue(any(a['action']=='lead.task' for a in self.client.get('/api/leads/1/activity').json()))

    def test_task_validation_city_boundary_and_mismatched_lead(self):
        self.prepare()
        for data,code in [({'title':'   '},400),({'title':'x'*301},422),({'title':'Test','due_at':'2030-01-01T12:00:00'},400)]:
            self.assertEqual(self.client.post('/api/leads/1/tasks',json=data).status_code,code)
        with m.SessionLocal() as db:
            m.ingest_whatsapp(db,m.WhatsAppEvent(account='77020000000',sender='77010000001@s.whatsapp.net',mid='second',text='Hello'))
        task=self.client.post('/api/leads/1/tasks',json={'title':'Задача'}).json()
        self.assertEqual(self.client.patch(f'/api/leads/2/tasks/{task["id"]}',json={'done':True}).status_code,404)
        self.two.city_id=2
        self.as_user(self.two)
        self.assertEqual(self.client.get('/api/leads/1/tasks').status_code,403)
        self.assertEqual(self.client.post('/api/leads/1/tasks',json={'title':'Bypass'}).status_code,403)

    def test_personal_quick_replies_crud_and_isolation(self):
        self.prepare()
        data={'title':'Размеры','text':'Здравствуйте! Есть S, M и L.'}
        created=self.client.post('/api/quick-replies',json=data)
        self.assertEqual(created.status_code,201)
        rid=created.json()['id'];route=f'/api/quick-replies/{rid}'
        self.assertEqual(self.client.get('/api/quick-replies').json()[0]['text'],data['text'])
        self.as_user(self.two)
        self.assertEqual(self.client.get('/api/quick-replies').json(),[])
        self.assertEqual(self.client.put(route,json=data).status_code,404)
        self.assertEqual(self.client.delete(route).status_code,404)
        self.as_user(self.one)
        self.assertEqual(self.client.put(route,json={**data,'text':'Размер M остался'}).status_code,200)
        self.assertEqual(self.client.get('/api/quick-replies').json()[0]['text'],'Размер M остался')
        self.assertEqual(self.client.post('/api/quick-replies',json={'title':'   ','text':'test'}).status_code,400)
        self.assertEqual(self.client.delete(route).status_code,200)
        self.assertEqual(self.client.get('/api/quick-replies').json(),[])

    def test_fitting_and_new_message_moves_existing_dialog_to_top(self):
        self.prepare()
        self.assertEqual(self.client.patch('/api/leads/1/stage',json={'stage':'fitting'}).status_code,200)
        self.assertEqual(self.client.get('/api/leads').json()[0]['stage'],'fitting')
        with m.SessionLocal() as db:
            m.ingest_whatsapp(db,m.WhatsAppEvent(account='77020000000',sender='77010000001@s.whatsapp.net',mid='second',text='Second'))
        self.assertEqual([c['id'] for c in self.client.get('/api/inbox/conversations').json()],[2,1])
        with m.SessionLocal() as db:
            m.ingest_whatsapp(db,m.WhatsAppEvent(account='77020000000',sender='77010000000@s.whatsapp.net',mid='latest',text='New message'))
        rows=self.client.get('/api/inbox/conversations').json()
        self.assertEqual([c['id'] for c in rows],[1,2])
        self.assertGreater(rows[0]['last_message_id'],rows[1]['last_message_id'])


if __name__=='__main__': unittest.main()
