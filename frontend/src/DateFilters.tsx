import {useState} from 'react';
export const businessDate=(value:string|Date=new Date())=>{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
 return ['year','month','day'].map(t=>parts.find(p=>p.type===t)?.value).join('-');
};
export function DatePresets({start,end,onChange}:{start:string;end:string;onChange:(start:string,end:string)=>void}){
 const today=businessDate();
 const ago=(days:number)=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);};
 const options=[['Всё время','',''],['Сегодня',today,today],['Вчера',ago(1),ago(1)],['Неделя',ago(6),today],['Месяц',ago(29),today]];
 return <div className="date-presets" aria-label="Период">{options.map(([label,from,to])=><button type="button" key={label} title={label==='Неделя'?'Последние 7 дней':label==='Месяц'?'Последние 30 дней':label} aria-pressed={start===from&&end===to} onClick={()=>onChange(from,to)}>{label}</button>)}</div>;
}
export function DateFilter({start,end,onChange}:{start:string;end:string;onChange:(start:string,end:string)=>void}){
 const [expanded,setExpanded]=useState(false);
 return <div className="date-filter"><DatePresets start={start} end={end} onChange={onChange}/><button type="button" className="text-link" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>Расширенные фильтры</button>{expanded&&<div className="date-range"><label>С<input aria-label="Аналитика с" type="date" value={start} max={end||undefined} onChange={e=>onChange(e.target.value,end)}/></label><label>По<input aria-label="Аналитика по" type="date" value={end} min={start||undefined} onChange={e=>onChange(start,e.target.value)}/></label></div>}</div>;
}
