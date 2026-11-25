import {useState} from 'react';

function initialTheme(){
 try{const saved=localStorage.getItem('aen-theme');if(saved==='dark'||saved==='light')return saved;}catch{}
 return window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
}
document.documentElement.dataset.theme=initialTheme();

export function ThemeToggle(){
 const [theme,setTheme]=useState(document.documentElement.dataset.theme||'light');
 const toggle=()=>{const next=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;setTheme(next);try{localStorage.setItem('aen-theme',next);}catch{}};
 return <button type="button" role="switch" aria-checked={theme==='dark'} aria-label="Тёмная тема" title="Тёмная тема" onClick={toggle} style={{display:'inline-flex',alignItems:'center',width:44,height:26,minHeight:26,padding:3,border:'1px solid currentColor',borderRadius:16,background:theme==='dark'?'#28734d':'#616974',cursor:'pointer'}}><span aria-hidden="true" style={{width:18,height:18,borderRadius:'50%',background:'white',transform:theme==='dark'?'translateX(18px)':'none'}}/></button>;
}
