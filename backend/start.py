"""Run API and private WhatsApp bridge with a shared ephemeral authentication secret."""
import os
import secrets
import signal
import subprocess
import time

os.environ['WA_BRIDGE_SECRET']=secrets.token_urlsafe(48)
children=[]
def stop(*_):
    for p in children:
        if p.poll() is None:p.terminate()
signal.signal(signal.SIGTERM,stop)
signal.signal(signal.SIGINT,stop)
children.append(subprocess.Popen(['node','/app/whatsapp/server.mjs']))
children.append(subprocess.Popen(['uvicorn','app.main:app','--host','0.0.0.0','--port',os.environ.get('PORT','8080'),'--proxy-headers','--no-access-log']))
while all(p.poll() is None for p in children):time.sleep(1)
stop()
for p in children:
    try:p.wait(timeout=10)
    except subprocess.TimeoutExpired:p.kill()
raise SystemExit(1)
