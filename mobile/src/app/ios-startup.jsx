import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { IosBrandMark } from './ios-brand-mark.jsx';
import { IosInkCharacter } from './ios-ink-character.jsx';
import { animateIosOrbFeedback } from './ios-orb-feedback.mjs';
import { startupPresentation } from './startup-state.mjs';
import { Pressable } from './phone-ui.jsx';

export function IosStartupFailure({ state, onRetry, onExport, busy, children }) {
  const content=startupPresentation(state);
  return <section className="ios-startup ios-startup-failure" data-startup-phase={state.phase} aria-busy={busy}>
    <IosBrandMark/><p className="ios-startup-eyebrow">Battery Inventory</p>
    <div role="alert"><h1>{content.title}</h1><p>{content.detail}</p></div>
    <div className="ios-startup-actions"><Pressable className="phone-primary" busy={busy} onClick={onRetry}><RefreshCw size={18}/>{busy?'Retrying…':content.action}</Pressable>{state.failedStage==='local'&&onExport&&<Pressable className="phone-secondary" disabled={busy} onClick={onExport}><Download size={18}/>Export retained data</Pressable>}<details><summary>Technical details</summary><p>{state.saveError||state.error}</p></details></div>{children}
  </section>;
}

/** Readiness comes from storage, authentication and the actual first destination, never a timer. */
export function IosLaunchScene({ phase, entry = 'loading', reducedMotion = false, initialVisible = true, onComplete }) {
  const [visible,setVisible]=useState(initialVisible), [foreground,setForeground]=useState(()=>document.visibilityState!=='hidden');
  const scene=useRef(null), mark=useRef(null), ink=useRef(null), run=useRef(0), completion=useRef(onComplete), landing=useRef(null);
  completion.current=onComplete;
  const busy=['opening','restoring','checking-session'].includes(phase)||phase==='authenticated'&&entry==='loading';
  useEffect(()=>{
    const stopLanding=()=>{landing.current?.();landing.current=null;};
    const changed=()=>{setForeground(document.visibilityState!=='hidden');if(document.visibilityState==='hidden')stopLanding();};
    document.addEventListener('visibilitychange',changed);
    window.addEventListener('pointerdown',stopLanding,true);
    return()=>{document.removeEventListener('visibilitychange',changed);window.removeEventListener('pointerdown',stopLanding,true);stopLanding();};
  },[]);
  useEffect(()=>{if(reducedMotion||busy||phase!=='authenticated'||entry!=='scan'){landing.current?.();landing.current=null;}},[reducedMotion,busy,phase,entry]);
  useEffect(()=>{
    if (busy) {
      if (phase!=='authenticated'&&!visible) setVisible(true);
      scene.current?.removeAttribute('data-departing');
      ink.current?.cancel();
      return;
    }
    if (!visible) return;
    const id=++run.current, element=scene.current, motions=[];
    let finished=false;
    const target=phase==='authenticated'&&entry==='scan'?document.querySelector('.phone-route:not([hidden]) .ios-scan-primary .ios-ink'):null;
    const restoreTarget=()=>{if(target?.dataset.iosLaunchDestination===String(id)){target.removeAttribute('data-ios-launch-destination');target.classList.remove('ios-launch-destination');}};
    const finish=(arrived=false)=>{
      if(run.current!==id||finished)return;
      finished=true;
      restoreTarget();
      if(arrived&&target?.isConnected&&document.visibilityState!=='hidden'){
        landing.current?.();
        target.dataset.launchArrival='true';
        const cancel=animateIosOrbFeedback(target,{onFinish:()=>{target.removeAttribute('data-launch-arrival');landing.current=null;}});
        landing.current=()=>{cancel();target.removeAttribute('data-launch-arrival');};
      }
      setVisible(false);completion.current?.();
    };
    const hidden=()=>{if(document.visibilityState==='hidden')finish();};
    const interrupted=()=>finish();
    document.addEventListener('visibilitychange',hidden);
    // Decoration never captures input or keeps the ready destination from being used.
    window.addEventListener('pointerdown',interrupted,{capture:true,once:true});
    window.addEventListener('keydown',interrupted,{capture:true,once:true});
    window.addEventListener('resize',interrupted,{once:true});
    if(reducedMotion||document.visibilityState==='hidden'||!element?.animate)finish();
    else {
      element.dataset.departing='true';
      const start=mark.current.getBoundingClientRect(), end=target?.getBoundingClientRect();
      if(end&&end.width>0&&end.height>0) {
        const x=end.x+end.width/2-start.x-start.width/2, y=end.y+end.height/2-start.y-start.height/2;
        const scale=end.width/start.width, timing={duration:760,easing:'cubic-bezier(.3,.65,.2,1)',fill:'forwards'};
        target.dataset.iosLaunchDestination=String(id);
        // The original character observes class changes to pause and resume its own motion.
        target.classList.add('ios-launch-destination');
        const flight=mark.current.animate([{transform:'translate3d(0,0,0) scale(1)'},{transform:'translate3d(0,-8px,0) scale(.92)',offset:.24},{transform:`translate3d(${x}px,${y}px,0) scale(${scale*1.025})`,offset:.86},{transform:`translate3d(${x}px,${y}px,0) scale(${scale})`}],timing);
        motions.push(flight);
        motions.push(mark.current.querySelector('.ios-brand-mark').animate([{opacity:1},{opacity:1,offset:.24},{opacity:0,offset:.52},{opacity:0}],{duration:760,fill:'forwards'}));
        motions.push(mark.current.querySelector('.ios-launch-ink').animate([{opacity:0},{opacity:0,offset:.24},{opacity:1,offset:.52},{opacity:1}],{duration:760,fill:'forwards'}));
        motions.push(element.animate([{backgroundColor:'#10141b'},{backgroundColor:'#10141b',offset:.14},{backgroundColor:'rgba(16,20,27,0)',offset:.68},{backgroundColor:'rgba(16,20,27,0)'}],{duration:760,fill:'forwards'}));
        motions.push(element.querySelector('.ios-launch-copy').animate([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'}));
        flight.onfinish=()=>finish(true);
      } else { const fade=element.animate([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'});motions.push(fade);fade.onfinish=()=>finish(); }
    }
    return()=>{
      run.current++;motions.forEach(motion=>motion.cancel());restoreTarget();
      document.removeEventListener('visibilitychange',hidden);
      window.removeEventListener('pointerdown',interrupted,true);window.removeEventListener('keydown',interrupted,true);window.removeEventListener('resize',interrupted);
    };
  },[busy,phase,entry,reducedMotion,visible]);
  if(!visible)return null;
  const content=startupPresentation({phase});
  return <div ref={scene} className="ios-launch-scene" data-startup-phase={phase} data-reduced-motion={reducedMotion} data-foreground={foreground} data-ready={!busy} aria-busy={busy} aria-hidden={!busy?true:undefined}>
    <div ref={mark} className="ios-launch-mark"><IosBrandMark/><span className="ios-launch-ink"><IosInkCharacter ref={ink} active={!busy&&!reducedMotion&&foreground} color="blue"/></span></div>
    <div className="ios-launch-copy" role="status" aria-live="polite"><strong>Battery Inventory</strong><span>{phase==='authenticated'?'Opening your inventory':content.title}</span></div>
  </div>;
}
