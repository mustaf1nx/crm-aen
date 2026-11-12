import unittest
from datetime import datetime,timezone
from test_instagram import m
import test_instagram as base
from sqlalchemy import select
class AuditTests(unittest.TestCase):
    setUp=base.InstagramTests.setUp
    tearDown=base.InstagramTests.tearDown
    def test_admin_filters_pagination_and_city_time(self):
        with m.SessionLocal() as db:
            admin=db.scalar(select(m.User).where(m.User.role=='admin'))
            manager=m.User(username='auditmanager',full_name='Manager',role='manager',city_id=1,active=True,password_hash='unused')
            db.add(manager);db.flush()
            for i,hour in enumerate([18,19,20]):db.add(m.Audit(actor_id=manager.id,action='message.send',detail=str(i),created_at=datetime(2026,11,12,hour,tzinfo=timezone.utc)))
            db.add(m.Audit(actor_id=admin.id,action='lead.create',detail='1',created_at=datetime(2026,11,12,21,tzinfo=timezone.utc)))
            db.commit()
            for u in [admin,manager]:db.refresh(u);db.expunge(u)
        m.app.dependency_overrides[m.current_user]=lambda:manager
        self.assertEqual(self.client.get('/api/audit').status_code,403)
        m.app.dependency_overrides[m.current_user]=lambda:admin
        query=f'/api/audit?start=2026-11-13&end=2026-11-13&actor_id={manager.id}&action=message.send&limit=1'
        first=self.client.get(query).json();self.assertEqual(first['items'][0]['detail'],'2');self.assertIsNotNone(first['next_cursor'])
        second=self.client.get(query+'&before='+str(first['next_cursor'])).json();self.assertEqual(second['items'][0]['detail'],'1');self.assertIsNone(second['next_cursor'])
        self.assertEqual(self.client.get('/api/audit?start=invalid').status_code,400)
        self.assertEqual(self.client.get('/api/audit?limit=1000').status_code,422)
    def test_login_logged_without_password(self):
        r=self.client.post('/api/auth/login',json={'username':'admin','password':'test-admin-password'})
        self.assertEqual(r.status_code,200)
        with m.SessionLocal() as db:
            row=db.scalar(select(m.Audit).where(m.Audit.action=='auth.login'))
            self.assertIsNotNone(row);self.assertNotIn('password',row.detail)
