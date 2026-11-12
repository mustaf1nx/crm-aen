import {useState} from 'react';
import {Moon,Sun} from 'lucide-react';

function initialTheme(){
 try{const saved=localStorage.getItem('aen-theme');if(saved==='dark'||saved==='light')return saved;}catch{}
 return window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
}
document.documentElement.dataset.theme=initialTheme();

export function ThemeToggle(){
 const [theme,setTheme]=useState(document.documentElement.dataset.theme||'light');
 const toggle=()=>{const next=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;setTheme(next);try{localStorage.setItem('aen-theme',next);}catch{}};
 return <button type="button" className="secondary theme-toggle" aria-label={theme==='dark'?'Включить светлую тему':'Включить тёмную тему'} title={theme==='dark'?'Светлая тема':'Тёмная тема'} onClick={toggle}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}<span>{theme==='dark'?'Светлая тема':'Тёмная тема'}</span></button>;
}
