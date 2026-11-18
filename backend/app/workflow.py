"""Persistent lead tasks and each employee's saved replies."""
from datetime import datetime, timezone
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import ForeignKey, String, Text, DateTime, Boolean, select
from sqlalchemy.orm import Mapped, mapped_column
from . import main as m

class LeadTask(m.Base):
    __tablename__ = 'lead_tasks'
    id: Mapped[int] = mapped_column(primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey('leads.id'), index=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    title: Mapped[str] = mapped_column(String(300))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class QuickReply(m.Base):
    __tablename__ = 'quick_replies'
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    title: Mapped[str] = mapped_column(String(80))
    text: Mapped[str] = mapped_column(Text)

def iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat() if value and value.tzinfo is None else value.isoformat() if value else None

def task_out(t):
    return dict(id=t.id, lead_id=t.lead_id, title=t.title, due_at=iso(t.due_at), done=t.done)

def task_summaries(db, leads, user):
    ids=[l.id for l in leads if user.role=='admin' or l.manager_id in (None,user.id)]
    result={}
    for t in db.scalars(select(LeadTask).where(LeadTask.lead_id.in_(ids),LeadTask.done==False).order_by(LeadTask.due_at.asc().nulls_last(),LeadTask.id)):
        result.setdefault(t.lead_id,[]).append(task_out(t))
    return {lid:{'task_count':len(rows),'next_task':rows[0]} for lid,rows in result.items()}

class TaskIn(BaseModel):
    title: str = Field(min_length=1,max_length=300)
    due_at: datetime | None = None

class TaskState(BaseModel):
    done: bool

@m.app.get('/api/leads/{lead_id}/tasks')
def tasks(lead_id:int,db=Depends(m.get_db),user=Depends(m.current_user)):
    m.conversation_access(db,lead_id,user)
    return [task_out(t) for t in db.scalars(select(LeadTask).where(LeadTask.lead_id==lead_id).order_by(LeadTask.done,LeadTask.due_at.asc().nulls_last(),LeadTask.id))]

@m.app.post('/api/leads/{lead_id}/tasks',status_code=201)
def add_task(lead_id:int,data:TaskIn,db=Depends(m.get_db),user=Depends(m.current_user)):
    m.owned_lead(db,lead_id,user)
    if not data.title.strip(): raise HTTPException(400,'Введите задачу')
    if data.due_at and data.due_at.tzinfo is None: raise HTTPException(400,'Укажите часовой пояс срока')
    t=LeadTask(lead_id=lead_id,creator_id=user.id,title=data.title.strip(),due_at=data.due_at)
    db.add(t);m.log(db,user,'lead.task',f'{lead_id}: Добавлена задача — {t.title}');db.commit()
    return task_out(t)

@m.app.patch('/api/leads/{lead_id}/tasks/{task_id}')
def set_task(lead_id:int,task_id:int,data:TaskState,db=Depends(m.get_db),user=Depends(m.current_user)):
    m.owned_lead(db,lead_id,user)
    t=db.get(LeadTask,task_id)
    if not t or t.lead_id!=lead_id: raise HTTPException(404,'Задача не найдена')
    if t.done!=data.done:
        t.done=data.done
        m.log(db,user,'lead.task',f'{lead_id}: '+('Выполнена' if t.done else 'Возобновлена')+' задача — '+t.title)
        db.commit()
    return task_out(t)

class ReplyIn(BaseModel):
    title: str = Field(min_length=1,max_length=80)
    text: str = Field(min_length=1,max_length=2000)

def reply_out(r): return dict(id=r.id,title=r.title,text=r.text)

@m.app.get('/api/quick-replies')
def replies(db=Depends(m.get_db),user=Depends(m.current_user)):
    return [reply_out(r) for r in db.scalars(select(QuickReply).where(QuickReply.user_id==user.id).order_by(QuickReply.id))]

@m.app.post('/api/quick-replies',status_code=201)
def add_reply(data:ReplyIn,db=Depends(m.get_db),user=Depends(m.current_user)):
    if not data.title.strip() or not data.text.strip(): raise HTTPException(400,'Заполните название и текст')
    r=QuickReply(user_id=user.id,title=data.title.strip(),text=data.text.strip());db.add(r);db.commit()
    return reply_out(r)

@m.app.put('/api/quick-replies/{reply_id}')
def edit_reply(reply_id:int,data:ReplyIn,db=Depends(m.get_db),user=Depends(m.current_user)):
    r=db.get(QuickReply,reply_id)
    if not r or r.user_id!=user.id: raise HTTPException(404,'Ответ не найден')
    if not data.title.strip() or not data.text.strip(): raise HTTPException(400,'Заполните название и текст')
    r.title=data.title.strip();r.text=data.text.strip();db.commit();return reply_out(r)

@m.app.delete('/api/quick-replies/{reply_id}')
def delete_reply(reply_id:int,db=Depends(m.get_db),user=Depends(m.current_user)):
    r=db.get(QuickReply,reply_id)
    if not r or r.user_id!=user.id: raise HTTPException(404,'Ответ не найден')
    db.delete(r);db.commit();return {'ok':True}
