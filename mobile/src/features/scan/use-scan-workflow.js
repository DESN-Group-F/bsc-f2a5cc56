import { useEffect, useRef, useState } from 'react';
import { businessStorage, native } from '../../platform/runtime.mjs';
import { inventoryResponse } from '../../shared/lib/client/inventory-request.js';
import { usePhoneContext } from '../../app/phone-ui.jsx';
import { useWorkflowLock } from '../../business/workflow-boundary.jsx';
import { createScanController, acquisitionOf } from './scan-controller.mjs';
import { FEEDBACK_KEY, readFeedbackPreferences } from './feedback.mjs';
import { useScanFeedback } from './use-scan-feedback.js';
import { useOwnedNfcReader } from './use-owned-nfc-reader.js';

export function useScanWorkflow({ kind, data, user, dataset, teachingGroup, scope, onChanged, onLockedChange, reviewOpen, input = 'native' }) {
  const surfaceActive=usePhoneContext()?.active!==false, activeSurface=useRef(surfaceActive);activeSurface.current=surfaceActive;
  const storage = businessStorage(), changed = useRef(onChanged), [controller] = useState(() => createScanController({
    storage, accountId: user.id, dataset, kind, inventory: data, teachingGroup, scope,
    write: async (action, payload) => (await inventoryResponse(await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset, action, payload }) }))).result,
    loadInventory: async () => inventoryResponse(await fetch(`/api/inventory?dataset=${dataset}`, { cache: 'no-store' })),
    onChanged: () => changed.current?.(),
  }));
  changed.current = onChanged;
  controller.updateInventory(data);
  const [state, setState] = useState(controller.getSnapshot), [foreground, setForeground] = useState(() => document.visibilityState !== 'hidden');
  const [deviceEvidence, setDeviceEvidence] = useState(null);
  const [preferences, setPreferences] = useState(() => readFeedbackPreferences(storage));
  const {feedback,present:feedbackOutcome,beginAcquisition,resetEncounter}=useScanFeedback({preferences,native});
  const live = useRef(true);
  useWorkflowLock(true);
  useEffect(() => { onLockedChange?.(true); return () => onLockedChange?.(false); }, [onLockedChange]);
  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => { const update = () => setForeground(document.visibilityState !== 'hidden'), hide = () => setForeground(false); document.addEventListener('visibilitychange', update); window.addEventListener('pagehide', hide); window.addEventListener('pageshow', update); return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', update); }; }, []);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  function present(result) {
    if (!live.current || !activeSurface.current || document.visibilityState === 'hidden' || !result) return;
    feedbackOutcome(result);
  }
  async function action(work, acquiring = false) {
    if(!activeSurface.current)return null;
    if (acquiring) beginAcquisition();
    const report=result=>{if(result)present(acquiring?result:{type:'notice',message:result.message});};
    try { const result = await work(); if (Array.isArray(result)) result.forEach(report); else report(result); return result; }
    catch (error) { present({ type:acquiring?'failure':'notice',message:error.message || 'The operation could not be completed.' }); return null; }
  }
  async function changePreferences(patch) {
    const next = { ...preferences, ...patch };
    try { storage.setItem(FEEDBACK_KEY, JSON.stringify(next)); await storage.flush(); setPreferences(next); }
    catch (error) { present({type:'notice',message:`Feedback preferences could not be saved. ${error.message}`}); }
  }
  const queueSource = state.session.queue[0] ? acquisitionOf(state.session.queue[0]) : null;
  const readingAllowed = native && surfaceActive && foreground && !reviewOpen && input === 'native' && (!state.blocked || state.busy) && !state.storageError && !state.session.attempt && !state.session.roomConfirmationRequired && (!queueSource || queueSource === 'native-nfc-reader');
  const {reader,resumeReader,cancelReader}=useOwnedNfcReader({storage,enabled:readingAllowed,storageError:state.storageError,contextKey:`${user.id}:${dataset}:${kind}`,
    onRetryStorage:()=>controller.getSnapshot().storageError?controller.retryStorage():storage.retryPersistence(),
    onRead:async({proposal,bridge,current})=>{
      beginAcquisition(proposal.tagId,proposal.attemptId);setDeviceEvidence(proposal);
      if(dataset!=='demo'){present({type:'notice',message:'Device evidence saved. Use Select for Working transactions.'});return;}
      const evidence=await bridge.adopt(proposal);if(!current())return;
      const result=await controller.addTag(proposal.tagId,'native-nfc-reader',evidence);if(current())present({...result,acquisitionId:proposal.attemptId});
    },onFailure:present,onIdle:resetEncounter,
  });
  useEffect(() => {
    if (!state.busy && !state.session.queue.length && !state.session.attempt) return;
    const protect = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, [state.busy, state.session.queue.length, state.session.attempt]);
  return { ...state, controller, reader, foreground, deviceEvidence, feedback, preferences, changePreferences, action, beginAcquisition, resumeReader, pauseReader:cancelReader };
}

