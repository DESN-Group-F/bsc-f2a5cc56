import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { usePhoneContext, usePhoneReducedMotion } from './phone-ui.jsx';
import { InkOrb } from '../features/scan/ink-orb.jsx';
import { animateIosOrbFeedback, cancelIosActivationFeedback, showIosActivationFeedback } from './ios-orb-feedback.mjs';
import './ios-ink-character.css';

const toneOf=value=>['failure','duplicate','success'].find(tone=>String(value||'').split(/\s+/).includes(tone))||'';

/** Reuse the original character; this adapter owns only the extra iOS activation splash. */
export const IosInkCharacter=forwardRef(function IosInkCharacter({compact=false,color='blue',feedback='',active=true,sequence=0,event='',successSequence=0,activationSequence=0,gazeScope},ref) {
  const host=useRef(null), body=useRef(null), splash=useRef(null), cancelMotion=useRef(null), serial=useRef(0), latest=useRef(null), prior=useRef(activationSequence);
  const context=usePhoneContext(), preference=usePhoneReducedMotion(), [systemReduced,setSystemReduced]=useState(()=>Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const reduced=preference||systemReduced, enabled=active&&context?.active!==false, tone=toneOf(feedback);
  const originalGazeScope=gazeScope||(compact?'button, [data-ink-gaze-scope]':'[data-ink-gaze-scope], .mobile-scan-surface, .scan-focused-surface, .mobile-scan-home');
  latest.current={enabled,reduced};
  function stop() { serial.current++; cancelMotion.current?.(); cancelMotion.current=null; if(host.current)host.current.dataset.animating='false'; }
  function animate(kind='activation',departing=false) {
    stop();
    if(!latest.current.enabled||document.visibilityState==='hidden')return;
    const element=host.current, run=serial.current;
    element.dataset.interaction=String(Number(element.dataset.interaction||0)+1);
    element.dataset.event=kind;
    if(latest.current.reduced||typeof body.current?.animate!=='function')return;
    if(departing){showIosActivationFeedback(element);return;}
    element.dataset.animating='true';
    cancelMotion.current=animateIosOrbFeedback(element,{onFinish:()=>{if(serial.current!==run)return;cancelMotion.current=null;element.dataset.animating='false';}});
  }
  useImperativeHandle(ref,()=>({burst:options=>animate('activation',options?.departing===true),cancel:stop}));
  useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)'),update=()=>setSystemReduced(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  useEffect(()=>{const previous=prior.current;prior.current=activationSequence;if(activationSequence!==previous)animate('activation');},[activationSequence]);
  useEffect(()=>{if(!enabled||reduced)stop();},[enabled,reduced]);
  useEffect(()=>{if(reduced)cancelIosActivationFeedback();},[reduced]);
  useEffect(()=>{
    const hide=()=>{if(document.visibilityState==='hidden')stop();};
    document.addEventListener('visibilitychange',hide);
    return()=>{stop();document.removeEventListener('visibilitychange',hide);};
  },[]);
  return <div ref={host} className="ios-ink" data-color={color} data-tone={tone||'neutral'} data-compact={compact} data-active={enabled} data-reduced-motion={reduced} aria-hidden="true" style={{display:'inline-block',width:`var(--ios-ink-size,${compact?48:120}px)`,aspectRatio:'1',overflow:'visible',flexShrink:0}}>
    <div ref={body} className="ios-ink-body"><InkOrb compact={compact} color={color} feedback={feedback} active={enabled} sequence={sequence} event={event} successSequence={successSequence} gazeScope={originalGazeScope}/></div>
    <svg className="ios-ink-canvas" viewBox="0 0 120 120">
      <g ref={splash} className="ios-ink-splash">{Array.from({length:8},(_,index)=><ellipse key={index} className="ios-ink-drop" cx="60" cy="60" rx={compact?6.5:3.5} ry={compact?8:4.5} style={{opacity:0,transformOrigin:'60px 60px'}}/>)}</g>
    </svg>
  </div>;
});
