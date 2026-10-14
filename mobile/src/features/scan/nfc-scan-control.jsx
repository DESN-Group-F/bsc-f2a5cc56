import React from 'react';
import { Pressable } from '../../app/phone-ui.jsx';
import { iosPresentation } from '../../app/ios-runtime-presentation.mjs';
import { native } from '../../platform/runtime.mjs';
import { ScanCharacter } from './scan-character.jsx';
import './nfc-scan-control.css';

/** A deliberate start opens one reader session; accepted batch reads reuse it. */
export function NfcScanControl({ reader = {}, onStart, onPause, disabled = false, batch = false, ...character }) {
  const explicit = reader.manualActivation || iosPresentation;
  const running = ['starting', 'ready', 'listening', 'lookup', 'processing'].includes(reader.state);
  const canStart = native && !disabled && (reader.canStart ?? !running);
  const label = reader.hasStarted ? 'Continue scanning' : 'Start scanning';
  function start() {
    if (!canStart) return;
    onStart?.();
  }
  if (!explicit) return <><ScanCharacter {...character}/>{native && ['fault', 'unavailable', 'paused'].includes(reader.state) && <button className="scan-text-button" disabled={disabled} onClick={onStart}>Check reader again</button>}</>;
  return <div className="nfc-scan-control" data-running={running}>
    <Pressable className="nfc-scan-ball" aria-label={label} disabled={!canStart} onClick={start}>
      <ScanCharacter {...character} activationSequence={reader.startSequence||0}/>
    </Pressable>
    <strong className="nfc-scan-label">{!native ? 'Native NFC unavailable in browser' : running ? reader.state === 'starting' ? 'Opening NFC reader…' : 'Scanning' : label}</strong>
    {batch && <p className="nfc-scan-hint">One tap starts a batch. Present one tag at a time; cancel the system reader to review.</p>}
    {running && onPause && <Pressable className="scan-text-button" onClick={() => onPause('Reading paused · Tap the ball to continue')}>Pause scanning</Pressable>}
  </div>;
}
