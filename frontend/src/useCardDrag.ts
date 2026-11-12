import {useEffect,useRef} from 'react';

// Pointer drag avoids the browser's translucent native drag image.
export function useCardDrag(onDrop:(id:number,stage:string)=>void){
 const callback=useRef(onDrop);callback.current=onDrop;
 const cancel=useRef<()=>void>(()=>{}), suppressClick=useRef(false);
 useEffect(()=>()=>cancel.current(),[]);
 const onPointerDown=(e:React.PointerEvent<HTMLButtonElement>,id:number)=>{
  if(e.button!==0||!e.isPrimary)return;
  cancel.current();suppressClick.current=false;
  const card=e.currentTarget,board=card.closest('.board') as HTMLElement;
  if(!board)return;
  const rect=card.getBoundingClientRect(),startX=e.clientX,startY=e.clientY;
  let x=startX,y=startY,ghost:HTMLElement|null=null,target:HTMLElement|null=null,frame=0;
  const highlight=()=>{
   const next=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-stage]')||null;
   const lane=next&&board.contains(next)?next:null;
   if(target!==lane){target?.classList.remove('lane-drop-target');target=lane;target?.classList.add('lane-drop-target');}
  };
  const tick=()=>{
   if(!ghost)return;
   const bounds=board.getBoundingClientRect();
   if(y>=bounds.top&&y<=bounds.bottom){
    const edge=60;
    if(x>bounds.right-edge)board.scrollLeft+=Math.min(18,(x-bounds.right+edge)/3);
    else if(x<bounds.left+edge)board.scrollLeft-=Math.min(18,(bounds.left+edge-x)/3);
   }
   if(y<70)window.scrollBy(0,-12);else if(y>innerHeight-70)window.scrollBy(0,12);
   highlight();frame=requestAnimationFrame(tick);
  };
  const cleanup=()=>{
   cancelAnimationFrame(frame);ghost?.remove();card.classList.remove('card-drag-origin');
   target?.classList.remove('lane-drop-target');document.body.classList.remove('card-dragging');
   window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);
   window.removeEventListener('pointercancel',abort);window.removeEventListener('keydown',key);window.removeEventListener('blur',abort);
   cancel.current=()=>{};
  };
  const move=(event:PointerEvent)=>{
   if(event.pointerId!==e.pointerId)return;x=event.clientX;y=event.clientY;
   if(!ghost&&Math.hypot(x-startX,y-startY)<7)return;
   event.preventDefault();
   if(!ghost){
    suppressClick.current=true;ghost=card.cloneNode(true) as HTMLElement;
    ghost.classList.add('card-drag-overlay');ghost.setAttribute('aria-hidden','true');ghost.removeAttribute('data-lead-id');ghost.tabIndex=-1;
    Object.assign(ghost.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0'});
    document.body.appendChild(ghost);card.classList.add('card-drag-origin');document.body.classList.add('card-dragging');frame=requestAnimationFrame(tick);
   }
   ghost.style.transform=`translate3d(${x-startX}px,${y-startY}px,0)`;highlight();
  };
  const up=(event:PointerEvent)=>{if(event.pointerId!==e.pointerId)return;const stage=ghost?target?.dataset.stage:null;cleanup();if(stage)callback.current(id,stage);};
  const abort=()=>cleanup();
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();cleanup();}};
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',abort);window.addEventListener('keydown',key);window.addEventListener('blur',abort);cancel.current=cleanup;
 };
 return {onPointerDown,consumeClick:()=>{const result=suppressClick.current;suppressClick.current=false;return result;}};
}
