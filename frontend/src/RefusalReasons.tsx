import {useId} from 'react';

export const refusalReasons=[
 'Молчун с начала','Перестал отвечать','Дорого','Спам',
 'Нет в ассортименте','Неправильный размер','Нет нужного размера',
 'Нет нужного цвета','Не подошёл фасон','Не устроила доставка',
 'Купил в другом месте','Передумал',
];
const other='Другая причина';
const prefix=other+': ';
export const validRefusalReason=(value:string)=>!!value.trim()&&value.trim()!==other&&value.trim()!==prefix.trim();

export function RefusalReasons({value,onChange,disabled=false,compact=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean;compact?:boolean}){
 const id=useId();
 const selected=refusalReasons.includes(value)?value:value?other:'';
 const explanation=value.startsWith(prefix)?value.slice(prefix.length):value===other?'':value;
 return <fieldset className="refusal-reasons" disabled={disabled}><legend>Причина отказа</legend>
 {compact?<select aria-label="Причина отказа" required value={selected} onChange={e=>onChange(e.target.value===other?prefix:e.target.value)}><option value="" disabled>Выберите причину</option>{[...refusalReasons,other].map(reason=><option key={reason}>{reason}</option>)}</select>:<div className="reason-options">{[...refusalReasons,other].map(reason=><label className={selected===reason?'reason-option selected':'reason-option'} key={reason}><input type="radio" name={id} required value={reason} checked={selected===reason} onChange={()=>onChange(reason===other?prefix:reason)}/><span>{reason}</span></label>)}</div>}
 {selected===other&&<label className="field"><span>Уточните причину</span><textarea required maxLength={200-prefix.length} rows={2} value={explanation} onChange={e=>onChange(prefix+e.target.value)} placeholder="Что помешало покупке?"/></label>}
 </fieldset>;
}
