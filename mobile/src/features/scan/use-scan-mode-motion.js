import { useEffect, useRef } from 'react';
import { usePhoneReducedMotion } from '../../app/phone-ui.jsx';

/** Opacity does not move hit targets; a new local change interrupts the previous fade. */
export function useScanModeMotion(ref,mode) {
  const previous=useRef(mode),reduced=usePhoneReducedMotion();
  useEffect(()=>{const changed=previous.current!==mode;previous.current=mode;if(!changed||reduced)return;const animation=ref.current?.animate?.([{opacity:.35},{opacity:1}],{duration:180,easing:'ease-out'});return()=>animation?.cancel();},[ref,mode,reduced]);
}
