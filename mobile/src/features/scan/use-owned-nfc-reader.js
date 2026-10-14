import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { native, saveFile } from '../../platform/runtime.mjs';
import { usePhoneContext } from '../../app/phone-ui.jsx';
import { createNativeReaderSession, projectNativeReaderFailure } from './native-reader-session.mjs';

/** Enabled excludes only the controller's own transient acquisition work, not protected requests. */
export function useOwnedNfcReader(options) {
  const active=usePhoneContext()?.active!==false, latest=useRef(options), visible=useRef(document.visibilityState!=='hidden'), mounted=useRef(true), manualResume=useRef(null);
  latest.current={...options,active};
  const iosContinuous=()=>native&&latest.current.continuous===true&&Capacitor.getPlatform()==='ios';
  const needsResume=()=>iosContinuous()&&manualResume.current===latest.current.contextKey;
  const requested=native&&options.enabled&&active&&visible.current&&document.visibilityState!=='hidden'&&!needsResume();
  const control=()=>({enabled:native&&latest.current.enabled&&latest.current.active&&visible.current&&document.visibilityState!=='hidden',contextKey:latest.current.contextKey});
  const [reader,setReader]=useState(()=>({...(native?(requested?{state:'starting',stage:'setup',operation:'preparation',attemptId:null,message:'Preparing NFC reader'}:{state:'paused',message:'Reading paused'}):{state:'unavailable',message:'Native NFC unavailable in browser'}),control:control()}));
  const [session]=useState(()=>createNativeReaderSession({storage:options.storage,
    continuous:options.continuous===true&&Capacitor.getPlatform()==='ios',
    isAllowed:key=>mounted.current&&native&&latest.current.active&&latest.current.enabled&&latest.current.contextKey===key&&visible.current&&document.visibilityState!=='hidden'&&!needsResume(),
    onState:value=>{if(mounted.current){
      // A native terminal pause while admitted needs deliberate continuation.
      // Ordinary disabled panels retain their existing automatic re-admission.
      if(iosContinuous()&&value.state==='paused'&&control().enabled)manualResume.current=latest.current.contextKey;
      setReader({...value,control:control()});
    }},onRead:value=>latest.current.onRead(value),onObserved:options.onObserved?value=>latest.current.onObserved?.(value):undefined,onFailure:value=>latest.current.onFailure?.(value),onIdle:()=>latest.current.onIdle?.(),
  }));
  const queueFailure=()=>latest.current.storageError?{stage:'evidence',operation:'queue',code:'QUEUE_PERSISTENCE',message:latest.current.storageError}:undefined;
  const pause=reason=>session.pause(reason,{failure:queueFailure()});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;session.dispose();};},[session]);
  useEffect(()=>{
    const hide=()=>{if(iosContinuous())manualResume.current=latest.current.contextKey;visible.current=false;pause('Reading paused · App is in the background');};
    const change=()=>{if(document.visibilityState==='hidden')hide();else{
      visible.current=true;
      if(needsResume())setReader(value=>({...value,...(value.state==='paused'?{message:'Reading paused · Continue scanning when ready'}:{}),control:control()}));
      else if(latest.current.enabled&&latest.current.active&&native)session.start(latest.current.contextKey);
    }};
    const expired=()=>{visible.current=false;pause('Reading paused · Account session needs review');};
    document.addEventListener('visibilitychange',change);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',change);window.addEventListener('battery-mobile-session',expired);
    return()=>{document.removeEventListener('visibilitychange',change);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',change);window.removeEventListener('battery-mobile-session',expired);};
  },[session]);
  useEffect(()=>{if(options.enabled&&active&&native){if(!needsResume())session.start(options.contextKey);}else pause(native?'Reading paused':'Native NFC unavailable in browser');},[session,options.enabled,options.contextKey,options.storageError,active]);
  // Render a new admission as preparation before its effect starts the reader.
  // An explicit pause retains the same admitted control and remains paused.
  const displayed=options.storageError?{...projectNativeReaderFailure(Object.assign(new Error(options.storageError),queueFailure()),{attemptId:reader.control.contextKey===options.contextKey?reader.attemptId:null,eventId:reader.eventId}).reader,control:control()}:requested&&(!reader.control.enabled||reader.control.contextKey!==options.contextKey)?{state:'starting',stage:'setup',operation:'preparation',attemptId:null,message:'Preparing NFC reader',control:control()}:reader;
  const recovery=options.storage.retryPersistence&&options.storage.exportRaw?{
    async retry(){
      const key=latest.current.contextKey,generation=session.getGeneration();
      if(latest.current.onRetryStorage)await latest.current.onRetryStorage();else await options.storage.retryPersistence();
      if(mounted.current&&session.getGeneration()===generation&&latest.current.contextKey===key&&control().enabled&&!needsResume())session.resume(key);
    },
    export:()=>saveFile({filename:'mobile-recovery-data.json',blob:new Blob([options.storage.exportRaw()],{type:'application/json'})}),
  }:undefined;
  return {reader:{...displayed,recovery,controlIssues:session.getCancellationIssues()},resumeReader:()=>{
    if(iosContinuous()&&!control().enabled)return;
    manualResume.current=null;session.resume(latest.current.contextKey);
  },cancelReader:pause};
}
