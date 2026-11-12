import {useEffect,useState} from 'react';
import {api} from './messaging';
export function AIConnection(){
 const [status,setStatus]=useState<any>(null),[busy,setBusy]=useState(false),[result,setResult]=useState(''),[error,setError]=useState('');
 useEffect(()=>{api('/ai/status').then(setStatus).catch(e=>setError(e.message));},[]);
 const check=async()=>{setBusy(true);setError('');setResult('');try{setStatus(await api('/ai/status'));const r=await api('/ai/test','POST',{});setResult(r.text);}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <section className="wa-connect"><div><strong>{status?.provider==='gemini'?'Gemini':'OpenAI'} · черновики ответов</strong><p>{status?.configured?'Ключ настроен':`Добавьте ${status?.provider==='gemini'?'GEMINI_API_KEY':'OPENAI_API_KEY'} в Railway → Variables`} · {status?.model||'gpt-4.1-mini'}</p><small>Автоотправка выключена. Тест использует выдуманное сообщение и квоту API.</small></div><button className="secondary" disabled={busy} onClick={check}>{busy?'Проверяем…':'Проверить подключение'}</button>{error&&<div className="error">{error}</div>}{result&&<div className="ai-draft"><strong>Подключение работает</strong><p>{result}</p></div>}</section>;
}
