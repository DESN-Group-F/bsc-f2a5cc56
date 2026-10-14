import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PhoneUIBoundary } from './phone-ui.jsx';
import { restorePhoneFocus } from './phone-interaction.mjs';
export const PHONE_FOCUS_ENTRY_MS = 420, PHONE_FOCUS_EXIT_MS = 240;
let workflowBoundarySequence = 0;

export function FloatingWorkflow({ open = true, label, owner, inactive = false, reducedMotion = false, children }) {
  const surface=useRef(null), retained=useRef(null), fallbackOwner=useRef(null), [shown,setShown]=useState(open);
  if (!fallbackOwner.current) fallbackOwner.current = `phone-workflow:${++workflowBoundarySequence}`;
  if (open) retained.current={label,children,owner:owner || fallbackOwner.current};
  const workflowOwner = retained.current?.owner || owner || fallbackOwner.current;
  useEffect(()=>{
    if(open){setShown(true);return;}
    if(!shown)return;
    if(reducedMotion){setShown(false);retained.current=null;return;}
    const exit=setTimeout(()=>{setShown(false);retained.current=null;},PHONE_FOCUS_EXIT_MS);
    return()=>clearTimeout(exit);
  },[open,shown,reducedMotion]);
  useEffect(()=>{
    if(!open)return;
    const previousFocus=document.activeElement;
    const node=surface.current;
    const controlSelector='button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]';
    const visibleControls=()=>[...node.querySelectorAll(controlSelector)].filter(control=>control.getClientRects().length);
    // A child may already have focused its heading during the layout commit.
    if(node&&!node.contains(document.activeElement)) {
      const firstVisible=[...node.querySelectorAll(controlSelector)].find(control=>control.getClientRects().length);
      (firstVisible||node).focus({preventScroll:true});
    }
    const containFocus=event=>{
      if(event.key!=='Tab'||!node||node.inert||event.target.closest?.('dialog[open],[role="dialog"],[role="alertdialog"]')!==node)return;
      const controls=visibleControls();
      const first=controls[0],last=controls.at(-1);if(!first){event.preventDefault();node.focus();return;}
      if(!controls.includes(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();}
      else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',containFocus);
    return()=>{document.removeEventListener('keydown',containFocus);restorePhoneFocus(previousFocus);};
  },[open]);
  if(!open&&!shown)return createPortal(null,document.body);
  return createPortal(<div ref={surface} className="phone-app phone-workflow-layer" data-phone-workflow-owner={workflowOwner} style={{'--phone-focus-enter':`${PHONE_FOCUS_ENTRY_MS}ms`,'--phone-focus-exit':`${PHONE_FOCUS_EXIT_MS}ms`}} data-state={open?'open':'closed'} role="dialog" aria-modal={open?true:undefined} aria-label={retained.current?.label||label} aria-hidden={!open?true:undefined} tabIndex={-1} inert={inactive||!open?true:undefined}><PhoneUIBoundary active={open && !inactive} workflowOwner={workflowOwner}>{retained.current?.children}</PhoneUIBoundary></div>,document.body);
}
