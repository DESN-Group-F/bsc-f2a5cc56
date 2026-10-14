import { readWorkflowRecovery, nextPendingWorkflow } from '../shared/lib/client/workflow-recovery.js';
import { recoverTeachingCheckoutAttempt, teachingCheckoutStorageKey } from '../shared/lib/client/teaching-checkout-request.js';
import { recoverTeachingCheckoutDraft, teachingCheckoutDraftStorageKey } from '../shared/lib/client/teaching-checkout-draft.js';
import { recoverTeachingGroupAttempt, teachingGroupStorageKey } from '../shared/lib/teaching-groups.js';
import { discoverLocationAttempts, locationRequestStorageKey, recoverLocationAttempt } from '../shared/lib/client/location-request.js';
import { mobileRegistrationStorageKey } from '../shared/lib/mobile-registration-session.js';
import { recoverMovementAttempt, movementStorageKey } from '../shared/lib/movement-session.js';
import { recoverScanSession } from '../shared/lib/scan-session.js';
import { recoverMobileScanSession } from '../features/scan/scan-controller.mjs';
import { readTaskRecordAction, taskRecordActionStorageKey } from '../shared/lib/client/task-record-action.js';
import { recoverTaskCreate, taskCreateStorageKey } from '../shared/lib/task-create-session.js';
import { readTaskCompletion } from '../features/workspace/task-completion.mjs';
import { operatorRegistrationStorageKey, operatorRegistrationDraftKey, recoverOperatorRegistrationAttempt, recoverOperatorRegistrationDraft } from '../features/lifecycle/manual-registration-model.mjs';
import { removalScopeStorageKey, recoverRemovalScope } from '../features/lifecycle/removal-controller.mjs';
import { modelCreateStorageKey, recoverModelCreate } from '../shared/components/inventory/battery-model-picker.js';
import { readInspectionAttempt } from '../shared/components/inventory/inspection-request.js';
import { lifecycleStorageKey } from '../shared/lib/lifecycle-session.js';
import { removalDraftStorageKey, recoverRemovalDraft } from '../shared/lib/removal-draft.js';
import { intakeStorageKey } from '../shared/lib/intake-session.js';
import { recoverIntakeDraft } from '../shared/lib/intake-draft.js';
import { acknowledgeWorkflowStorage } from '../shared/lib/client/workflow-storage.js';
import { readPhoneFormDraft } from './phone-form-draft.mjs';

/** Read original device work; never recapture, clear or submit during discovery. */
export function discoverMobileRecovery(storage, accountId, { protectedOnly = false } = {}) {
  const workflowState = readWorkflowRecovery(storage, accountId);
  if(protectedOnly)for(const dataset of ['demo','live'])for(const kind of ['checkout','return']) {
    // Skipping a draft must not skip the validation its phone controller needs.
    recoverMobileScanSession(storage.getItem(`battery-scan:${accountId}:${dataset}:${kind}`),kind,accountId);
  }
  if(protectedOnly)for(const dataset of ['demo','live'])readPhoneFormDraft(storage,{accountId,dataset,kind:'intake-common',recordId:'common'});
  const emptyKeys=emptyLifecycleKeys(storage,accountId);
  for(const dataset of ['demo','live']) {
    const raw=storage.getItem(locationRequestStorageKey(accountId,dataset));
    if(raw!==null&&!recoverLocationAttempt(raw,accountId,dataset))throw new Error('A retained location request is unreadable. Its original data has not been replaced.');
  }
  const locations = discoverLocationAttempts(accountId, storage);
  if (locations.length) return { type: 'location', dataset: locations[0].dataset, attempt: locations[0] };
  for (const dataset of ['demo', 'live']) {
    const definitionRaw = storage.getItem(teachingGroupStorageKey(accountId,dataset));
    if (definitionRaw !== null) {
      if (!recoverTeachingGroupAttempt(definitionRaw,accountId,dataset)) throw new Error('A retained teaching group definition is unreadable or belongs to a different account or inventory. Its original request has not been replaced.');
      return { type:'workspace',dataset,view:'teaching-groups',initialTools:true };
    }
    const modelRaw=storage.getItem(modelCreateStorageKey(accountId,dataset));
    if(modelRaw!==null){if(!recoverModelCreate(modelRaw,accountId,dataset))throw new Error('A retained model request is unreadable. Its original data has not been replaced.');return {type:'manual_registration',dataset};}
    const inspectionPrefix=`battery-inspection-request:${encodeURIComponent(accountId)}:${dataset}:`;
    for(const key of Object.keys(storage.entries()))if(key.startsWith(inspectionPrefix)) {
      const batteryId=decodeURIComponent(key.slice(inspectionPrefix.length));
      const saved=readInspectionAttempt(accountId,dataset,batteryId,storage);
      if(saved.error||!saved.input)throw new Error(saved.error||'A retained inspection request is unreadable. Its original data is preserved.');
      return {type:'inspection',dataset,batteryId};
    }
    const scopeRaw=storage.getItem(removalScopeStorageKey(accountId,dataset));
    if(scopeRaw!==null&&!emptyKeys.has(removalScopeStorageKey(accountId,dataset))) {
      const scope=recoverRemovalScope(scopeRaw,accountId);
      if(!protectedOnly||storage.getItem(lifecycleStorageKey(accountId,dataset))!==null)return {type:'removal',dataset,scope};
    }
    const completion=readTaskCompletion(storage,accountId,dataset);
    if(completion)return {type:'workspace',dataset,view:'task-plans',initialTaskId:completion.input.payload.cycleId};
    for(const resource of ['messages','plans']) {
      if(storage.getItem(taskRecordActionStorageKey(resource,accountId,dataset))!==null) {
        const saved=readTaskRecordAction(resource,accountId,dataset,storage);
        if(saved.error)throw new Error(saved.error);
        return {type:'workspace',dataset,view:resource==='messages'?'messages':'task-plans',initialTools:resource==='plans'};
      }
    }
    const taskCreateRaw=storage.getItem(taskCreateStorageKey(accountId,dataset));
    if(taskCreateRaw!==null){if(!recoverTaskCreate(taskCreateRaw,accountId,dataset))throw new Error('A retained task creation is unreadable. Its original data has not been replaced.');return {type:'workspace',dataset,view:'task-plans',initialTools:true};}
    const registrationRaw=storage.getItem(operatorRegistrationStorageKey(accountId,dataset)),draftRaw=storage.getItem(operatorRegistrationDraftKey(accountId,dataset));
    if(registrationRaw!==null&&!recoverOperatorRegistrationAttempt(registrationRaw,accountId,dataset)||draftRaw!==null&&!recoverOperatorRegistrationDraft(draftRaw,accountId,dataset))throw new Error('Retained manual registration is unreadable or has a different account context. Export the preserved recovery data.');
    if(registrationRaw!==null||!protectedOnly&&draftRaw!==null)return {type:'manual_registration',dataset};
    const teachingRaw=storage.getItem(teachingCheckoutStorageKey(accountId,dataset));
    const attempt = recoverTeachingCheckoutAttempt(teachingRaw, accountId, dataset);
    if(teachingRaw!==null&&!attempt)throw new Error('A retained teaching request is unreadable. Its original data has not been replaced.');
    if (attempt) return { type: 'teaching', dataset, draft: { kind: 'recover', attempt } };
    const teachingDraftRaw=storage.getItem(teachingCheckoutDraftStorageKey(accountId,dataset));
    const saved = recoverTeachingCheckoutDraft(teachingDraftRaw, accountId, dataset);
    if(teachingDraftRaw!==null&&!saved)throw new Error('A retained teaching draft is unreadable. Its original data has not been replaced.');
    if (saved && !protectedOnly) return { type: 'teaching', dataset, draft: { kind: 'resume', saved } };
    for (const kind of ['checkout', 'return']) {
      const movementRaw = storage.getItem(movementStorageKey(accountId, dataset, kind));
      if (movementRaw !== null && !recoverMovementAttempt(movementRaw, accountId, dataset, kind)) throw new Error('A retained movement request is unreadable. Export recovery data; it has not been replaced.');
      const scanRaw = storage.getItem(`battery-scan:${accountId}:${dataset}:${kind}`);
      if (scanRaw !== null && !recoverScanSession(scanRaw, kind, true)) throw new Error('A retained scan session is unreadable. Export recovery data; it has not been replaced.');
    }
  }
  const registrationKey = mobileRegistrationStorageKey(accountId, 'demo');
  if (storage.getItem(registrationKey) !== null || storage.getItem(registrationKey + ':draft') !== null) return { type: 'registration', dataset: 'demo' };
  if(protectedOnly) {
    // Ordinary drafts stay under their own controller keys. Only an original
    // request or unresolved return-room decision can redirect a chosen entry.
    workflowState.removals=workflowState.removals.filter(({dataset})=>storage.getItem(lifecycleStorageKey(accountId,dataset))!==null);
    workflowState.intakes=workflowState.intakes.filter(({dataset})=>!!recoverIntakeDraft(storage.getItem(intakeStorageKey(accountId,dataset)),accountId,dataset)?.attempt);
    workflowState.scans=workflowState.scans.filter(({dataset,kind})=>{
      const session=recoverMobileScanSession(storage.getItem(`battery-scan:${accountId}:${dataset}:${kind}`),kind,accountId);
      return !!session?.attempt||!!session?.roomConfirmationRequired;
    });
  }
  const pending = nextPendingWorkflow(workflowState);
  return pending ? { type: pending.type, ...pending.pending } : null;
}

/** Ordinary work is an explicit landing-page choice, never a startup reader. */
export function discoverMobileDrafts(storage,accountId) {
  const state=readWorkflowRecovery(storage,accountId),saved=[];
  for(const pending of state.intakes)if(!recoverIntakeDraft(storage.getItem(intakeStorageKey(accountId,pending.dataset)),accountId,pending.dataset)?.attempt)saved.push({type:'intake',...pending,label:'Intake'});
  const prepared=recoverIntakeDraft(storage.getItem(intakeStorageKey(accountId,'demo')),accountId,'demo');
  if(prepared?.batch&&!prepared.attempt&&!saved.some(item=>item.type==='intake'&&item.dataset==='demo'))saved.push({type:'intake',dataset:'demo',label:'Intake'});
  for(const pending of state.removals)if(storage.getItem(lifecycleStorageKey(accountId,pending.dataset))===null)saved.push({type:'removal',...pending,label:'Removal',scope:recoverRemovalScope(storage.getItem(removalScopeStorageKey(accountId,pending.dataset)),accountId)});
  for(const pending of state.scans) {
    const session=recoverMobileScanSession(storage.getItem(`battery-scan:${accountId}:${pending.dataset}:${pending.kind}`),pending.kind,accountId);
    if(!session.attempt&&!session.roomConfirmationRequired)saved.push({type:'scan',...pending,label:pending.kind==='checkout'?'Check out':'Return'});
  }
  for(const dataset of ['demo','live']) {
    const scopeKey=removalScopeStorageKey(accountId,dataset),scopeRaw=storage.getItem(scopeKey);
    if(scopeRaw!==null&&!emptyLifecycleKeys(storage,accountId).has(scopeKey)&&!saved.some(item=>item.type==='removal'&&item.dataset===dataset)&&storage.getItem(lifecycleStorageKey(accountId,dataset))===null)saved.push({type:'removal',dataset,label:'Removal',scope:recoverRemovalScope(scopeRaw,accountId)});
    const manual=recoverOperatorRegistrationDraft(storage.getItem(operatorRegistrationDraftKey(accountId,dataset)),accountId,dataset);
    if(manual)saved.push({type:'manual_registration',dataset,label:'Manual registration'});
    const teaching=recoverTeachingCheckoutDraft(storage.getItem(teachingCheckoutDraftStorageKey(accountId,dataset)),accountId,dataset);
    if(teaching)saved.push({type:'teaching',dataset,label:'Teaching review',draft:{kind:'resume',saved:teaching}});
    const form=readPhoneFormDraft(storage,{accountId,dataset,kind:'intake-common',recordId:'common'});
    if(form&&!saved.some(item=>item.type==='intake'&&item.dataset===dataset))saved.push({type:'intake',dataset,label:'Intake preparation'});
  }
  return saved;
}

function emptyLifecycleKeys(storage,accountId) {
  const ignored=new Set();
  for(const dataset of ['demo','live']) {
    const key=removalDraftStorageKey(accountId,dataset),raw=storage.getItem(key),draft=recoverRemovalDraft(raw,accountId,dataset);
    if(draft&&!draft.items.length&&storage.getItem(lifecycleStorageKey(accountId,dataset))===null) {
      const scopeKey=removalScopeStorageKey(accountId,dataset),scopeRaw=storage.getItem(scopeKey);
      if(scopeRaw!==null)recoverRemovalScope(scopeRaw,accountId);
      ignored.add(key);if(scopeRaw!==null)ignored.add(scopeKey);
    }
  }
  const intakeKey=intakeStorageKey(accountId,'demo'),intake=recoverIntakeDraft(storage.getItem(intakeKey),accountId,'demo');
  if(intake&&!intake.batch&&!intake.entries.length&&!intake.attempt)ignored.add(intakeKey);
  return ignored;
}

export function accountHasDeviceWork(storage, accountId) {
  let ignored;try{ignored=emptyLifecycleKeys(storage,accountId);}catch{return true;}
  const accountSegments=new Set([accountId,encodeURIComponent(accountId)]);
  return Object.keys(storage.entries()).some(key => !key.startsWith('preference:') && key.split(/[:/]/).some(segment=>accountSegments.has(segment)) && !ignored.has(key));
}

export async function clearEmptyDeviceWork(storage,accountId) {
  const remove=[...emptyLifecycleKeys(storage,accountId)],expected=Object.fromEntries(remove.map(key=>[key,storage.getItem(key)])),updates={};
  const intake=recoverIntakeDraft(storage.getItem(intakeStorageKey(accountId,'demo')),accountId,'demo');
  if(intake&&!intake.batch&&!intake.entries.length&&!intake.attempt)for(const receipt of intake.completed){const key=`preference:intake-receipt:${receipt.requestId}`,raw=JSON.stringify(receipt),existing=storage.getItem(key);if(existing!==null&&existing!==raw)throw new Error('Saved intake receipt history differs. Original recovery is preserved.');updates[key]=raw;expected[key]=existing;}
  if(remove.length)await acknowledgeWorkflowStorage({remove,expected,updates,storage});
}
