import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ScanLine, Package, LayoutGrid, UserRound, RefreshCw, ArrowLeft, Radio, ChevronRight, Settings2 } from 'lucide-react';
import { useInventoryData, useInventoryPolling } from '../shared/hooks/use-inventory-data.js';
import { useMessageCount } from '../shared/hooks/use-message-count.js';
import { inventoryResponse } from '../shared/lib/client/inventory-request.js';
import { defaultInventoryFilter } from '../shared/lib/inventory-query.js';
import { captureIntakeAttempt, verifyIntakeReceipt } from '../shared/lib/intake-session.js';
import { captureLifecycleAttempt, verifyLifecycleReceipt } from '../shared/lib/lifecycle-session.js';
import { verifyMovementReceipt } from '../shared/lib/movement-session.js';
import { MovementDialog } from '../shared/components/inventory/movement-dialog.js';
import { RemovalHistory } from '../shared/components/inventory/removal-station.js';
import { TeachingCheckoutDialog } from '../shared/components/inventory/teaching-checkout-dialog.js';
import { GroupMaintenanceDialog } from '../shared/components/inventory/group-maintenance-dialog.js';
import { TeachingGroupsPanel } from '../shared/components/inventory/teaching-groups-panel.js';
import { RecordEditor } from '../shared/components/inventory/record-editor.js';
import { ExportDialog } from '../shared/components/inventory/export-dialog.js';
import { BatteryDetails } from '../shared/components/inventory/battery-detail.js';
import { LocationToolsPanel } from '../shared/components/inventory/location-tools-panel.js';
import { Registration } from '../business/registration.jsx';
import { NfcDiagnostics } from '../business/nfc-read.jsx';
import { businessStorage, native } from '../platform/runtime.mjs';
import { ScanHome, ScanWorkflow } from '../features/scan/scan.jsx';
import { LookupWorkflow } from '../features/scan/lookup.jsx';
import { PhoneBusinessSurface } from '../features/workspace/phone-business-surface.jsx';
import { InitialContentSurface } from './startup-surface.jsx';
import { markPhoneMilestone } from './phone-milestones.mjs';
import { MobileIntake } from '../features/lifecycle/intake.jsx';
import { MobileRemoval } from '../features/lifecycle/removal.jsx';
import { ManualRegistration } from '../features/lifecycle/manual-registration.jsx';
import { InventoryScreen } from '../features/inventory/inventory.jsx';
import { inventoryBoundaryIds, prepareTeachingGroupView, selectedOperationState } from '../features/inventory/inventory-model.mjs';
import { MeScreen, WorkspaceScreen, WorkspacePage } from '../features/workspace/workspace.jsx';
import { BatteryPage } from './battery-page.jsx';
import { MobileImportDialog } from './mobile-import-dialog.jsx';
import { FloatingWorkflow, PHONE_FOCUS_ENTRY_MS, PHONE_FOCUS_EXIT_MS } from './floating-workflow.jsx';
import { accountHasDeviceWork, clearEmptyDeviceWork, discoverMobileRecovery, discoverMobileDrafts } from './recovery.mjs';
import { phoneAdmission } from './phone-admission.mjs';
import { captureDetailBoundary, verifyDetailBoundary } from './detail-boundary.mjs';
import { MOBILE_BUILD } from './build-info.mjs';
import { createPhoneNavigation } from './phone-navigation.mjs';
import { capturePhoneEntryIntent, phoneEntryMessage } from './phone-entry-intent.mjs';
import { createPhoneBackRegistry, createPhoneEntryGate, dismissPhoneOverlay, phoneEditable, restorePhoneFocus, topPhoneOverlay, visiblePhoneOverlays, phoneWorkflowOwnsOverlay, trackPhoneInputModality } from './phone-interaction.mjs';
import { PhoneUIBoundary, PhoneUIProvider, Pressable } from './phone-ui.jsx';
import { PhoneChoice } from './phone-choice.jsx';
import { usePhoneViewport } from './phone-viewport.js';
import { PhoneReadError } from './phone-read-error.jsx';
import { phoneScrollIntent, trackPhoneScroll } from './phone-scroll.mjs';
import { MissingInspectionRecovery } from './missing-inspection-recovery.jsx';
import { PhoneArrivalsProvider, usePhoneArrivals } from './phone-arrivals.jsx';
import { IosDock, IosSearch } from './ios-chrome.jsx';
import { usesIosPresentation, iosSearchDestination, iosRouteTransition } from './ios-presentation.mjs';

const areas = [['scan','Scan',ScanLine],['inventory','Inventory',Package],['workspace','Workspace',LayoutGrid],['me','Me',UserRound]];
const pageTitles = { 'assets':'Intake & removal','intake-choice':'Working intake','removal-history':'Removal history','inspection-recovery':'Inspection recovery','service':'App settings','diagnostics':'Device diagnostics','battery-records':'Battery records','teaching-groups':'Teaching groups','task-plans':'Recurring tasks','messages':'Messages','my-activity':'My activity','account':'My account','manage':'Manage records','directories':'Directories','accounts':'Staff accounts','activity':'Activity history' };
const personalBoundary = scope => scope?.kind === 'owner' ? 'responsible' : scope?.kind === 'holder' ? 'borrowed' : 'all';
const nativeUI = registerPlugin('BatteryUi');
const lifecyclePages = ['assets','intake-choice','removal-history'];
const lifecycleRoute = value => lifecyclePages.includes(value.page) || value.lifecycleContext === true;
const RECOVERY_NOTICE = 'Unfinished device work restored. Nothing was submitted automatically.';
const LIFECYCLE_EXIT_NOTICE = 'Use Exit to leave Intake & removal after resolving protected work.';
const LIFECYCLE_BLOCKED_NOTICE = 'Finish or resolve the protected work before exiting.';
const clearLifecycleNotice = value => [LIFECYCLE_EXIT_NOTICE,LIFECYCLE_BLOCKED_NOTICE].includes(value) ? '' : value;
const INVENTORY_UPDATING_NOTICE = 'Updating inventory. This task will be available when current records are ready.';
const INVENTORY_REFRESH_NOTICE = 'Refresh this inventory before starting another task.';
const clearReadinessNotice = value => [INVENTORY_UPDATING_NOTICE,INVENTORY_REFRESH_NOTICE].includes(value) ? '' : value;
const MemoScanHome = memo(ScanHome);
const MemoArrivalInventoryView = memo(ArrivalInventoryView);
const MemoWorkspaceScreen = memo(WorkspaceScreen);
const MemoMeScreen = memo(MeScreen);

export function MobileShell({ initialUser, origin, storageError, saving, onSignedOut, onFieldTest, onExportRecovery }) {
  const [iosPresentation] = useState(() => usesIosPresentation({ platform:Capacitor.getPlatform(), native, search:globalThis.location?.search }));
  useLayoutEffect(() => {
    if (!iosPresentation) return;
    const previous=document.body.getAttribute('data-ios-presentation'); document.body.setAttribute('data-ios-presentation','true');
    return () => { if (previous === null) document.body.removeAttribute('data-ios-presentation'); else document.body.setAttribute('data-ios-presentation',previous); };
  }, [iosPresentation]);
  const inventory = useInventoryData(initialUser);
  const { data,user,dataset,loading,error,revision,load:inventoryLoad,changeDataset,acceptReviewedInventory,setError:setReadError } = inventory;
  const namespace = user.id + ':' + dataset, datasetPickerOwner = 'dataset-picker:' + namespace, sessions = useRef(new Map()), main = useRef(null);
  if (!sessions.current.has(namespace)) sessions.current.set(namespace,createPhoneNavigation(namespace));
  const navigation = sessions.current.get(namespace), view = useSyncExternalStore(navigation.subscribe,navigation.getSnapshot), route = view.current;
  const { area } = view, { page,pageContext,scope,detail } = route;
  const backRegistry = useMemo(() => createPhoneBackRegistry(),[namespace]), entryGate = useRef(createPhoneEntryGate());
  const entryIntent = useRef(null), [entryPending,setEntryPending] = useState(null);
  const cancelOpening = useCallback((restore = true) => { const pending = entryIntent.current; if (!pending) return false; const originalNamespace = live.current.namespace; entryGate.current.invalidate(); entryIntent.current = null; setEntryPending(null); if (restore !== false) requestAnimationFrame(() => { if (document.visibilityState !== 'hidden' && live.current.namespace === originalNamespace && live.current.navigation.getSnapshot().current.key === pending.routeKey) restorePhoneFocus(pending.trigger); }); return true; },[]);
  const [workflow,setWorkflow] = useState(null), [fullRecord,setFullRecord] = useState(false), [editor,setEditor] = useState(null), [exportDraft,setExportDraft] = useState(null), [importKind,setImportKind] = useState(null);
  const [closingWorkflow,setClosingWorkflow]=useState(false),[savedWork,setSavedWork]=useState([]);
  const [teaching,setTeaching] = useState(null), [groupMaintenance,setGroupMaintenance] = useState(null), [groupDefinition,setGroupDefinition] = useState(null), [locations,setLocations] = useState(false), [movement,setMovement] = useState(null);
  const [panelLocks,setPanelLocks] = useState({}), lockCallbacks = useRef(new Map()), [boundaryLocked,setBoundaryLocked] = useState(false), [portalLocked,setPortalLocked] = useState(false), [externalPortalLocked,setExternalPortalLocked] = useState(false), [datasetOtherPortalLocked,setDatasetOtherPortalLocked] = useState(false);
  const [notice,setNotice] = useState(''), [actionError,setError] = useState(''), [recoveryError,setRecoveryError] = useState(''), [recovering,setRecovering] = useState(null), [recoveryChecked,setRecoveryChecked] = useState(false), [sessionBusy,setSessionBusy] = useState(false);
  const [backgroundRefreshing,setBackgroundRefreshing] = useState(false), syncTracker = useRef({ namespace,active:true,reads:0,epoch:0,latest:null }), destinationMotion = useRef(null), destinationView = useRef(null), readFeedback = useRef(null);
  if (syncTracker.current.namespace !== namespace) { syncTracker.current.active = false; syncTracker.current = { namespace,active:true,reads:0,epoch:0,latest:null }; }
  const [preferences,setPreferences] = useState(() => { try { return { haptics:true,sounds:false,...JSON.parse(businessStorage().getItem('preference:mobile-feedback') || '{}') }; } catch { return { haptics:true,sounds:false }; } });
  const [motionPreference,setMotionPreference] = useState(() => businessStorage().getItem('preference:mobile-motion') === 'reduce' ? 'reduce' : 'system');
  const { keyboardOpen,systemReduced,layout = 'portrait' } = usePhoneViewport(), reducedMotion = systemReduced || motionPreference === 'reduce';
  const panelLocked = Object.values(panelLocks).some(Boolean), recoveryStarted = useRef(false), restoreFocus = useRef(null), live = useRef(null);
  const overlayOpen = !!(editor || exportDraft || importKind || teaching || groupMaintenance || groupDefinition || locations || movement || fullRecord);
  const lifecycleDestination = lifecycleRoute(route), protectedWithoutPortal = !recoveryChecked || !!workflow || overlayOpen || panelLocked || boundaryLocked || !!storageError || saving || !!recovering || !!recoveryError || sessionBusy, protectedLocked = protectedWithoutPortal || portalLocked;
  const operationLocked = protectedLocked || lifecycleDestination || page === 'inspection-recovery';
  const entryLockedWithoutSaving = !recoveryChecked || !!workflow || overlayOpen || panelLocked || boundaryLocked || !!storageError || !!recovering || !!recoveryError || sessionBusy || portalLocked;
  const datasetPickerLocked = protectedWithoutPortal || datasetOtherPortalLocked || lifecycleDestination || page === 'inspection-recovery';
  const inventoryReading = loading || backgroundRefreshing;
  const ready = recoveryChecked && !!data && data.dataset === dataset && data.user.id === user.id && !inventoryReading && !error && !storageError && !recoveryError;
  useEffect(() => { if (ready) setNotice(clearReadinessNotice); },[ready,notice]);

  const { unreadCount,acceptUnreadCount } = useMessageCount(dataset,user.id,area === 'me' && page === 'messages',revision);
  const backgroundLoad = useCallback(async (...args) => {
    const tracker = syncTracker.current;
    if (!tracker.active || tracker.namespace !== namespace) return;
    const attempt = { epoch:++tracker.epoch,outcome:'reading' }; tracker.latest = attempt;
    tracker.reads++; setBackgroundRefreshing(true);
    try { const result = await inventoryLoad(...args); attempt.outcome = args[1]?.aborted ? 'cancelled' : 'accepted'; return result; }
    catch (failure) { attempt.outcome = args[1]?.aborted || failure.name === 'AbortError' ? 'cancelled' : 'failed'; throw failure; }
    finally { tracker.reads--; if (tracker.active && tracker === syncTracker.current) setBackgroundRefreshing(tracker.reads > 0); }
  },[inventoryLoad,namespace]);
  const load = backgroundLoad;
  const refresh = useCallback(async () => {
    const tracker = syncTracker.current, epoch = tracker.epoch + 1;
    try { await load(dataset,undefined,!live.current.data); }
    catch (failure) { if (tracker.active && tracker === syncTracker.current && tracker.latest?.epoch === epoch) setReadError(failure.message); }
  },[load,dataset,setReadError]);
  live.current = { namespace,navigation,data,user,dataset,loading:inventoryReading,error,refresh,saving,workflow,locked:operationLocked,entryLocked:protectedLocked,entryLockedWithoutSaving,lifecycleDestination,ready,boundaryLocked,groupDefinition,groupViewBlocked:!!workflow || !!(editor || exportDraft || importKind || teaching || groupMaintenance || locations || movement || fullRecord) || panelLocked || boundaryLocked || saving || !!storageError || !!recovering || !!recoveryError || sessionBusy || lifecycleDestination,detailBlocked:!!workflow || overlayOpen || panelLocked || saving || !!storageError || !!recovering || !!recoveryError || sessionBusy };
  live.current.admissionState={hidden:document.visibilityState==='hidden',storageError,recoveryError,saving,closing:closingWorkflow&&boundaryLocked,reading:inventoryReading,ready,protected:!recoveryChecked||!!workflow||overlayOpen||panelLocked||boundaryLocked&&!closingWorkflow||portalLocked||!!recovering||sessionBusy};
  live.current.admission=phoneAdmission(live.current.admissionState);
  useEffect(()=>{if(closingWorkflow&&!boundaryLocked)setClosingWorkflow(false);},[closingWorkflow,boundaryLocked]);
  function explainBlocked(){setNotice(saving?'Device work is being saved. Try this view again when the save finishes.':closingWorkflow?'The previous task is closing. Try this view again when it finishes.':'Finish or resolve protected work before opening another view.');}
  useInventoryPolling({ paused:operationLocked,dataset,load:backgroundLoad,onError:setReadError });
  useEffect(() => { setBackgroundRefreshing(false); },[namespace]);

  function lockHandler(owner) {
    if (!lockCallbacks.current.has(owner)) lockCallbacks.current.set(owner,value => setPanelLocks(previous => !!previous[owner] === !!value ? previous : { ...previous,[owner]:!!value }));
    return lockCallbacks.current.get(owner);
  }
  const workflowLock = lockHandler('workflow:' + (workflow?.nonce || 'none'));
  const remember = useCallback(() => navigation.rememberScroll(navigation.getSnapshot().current.key,main.current?.scrollTop || 0),[navigation]);
  function goBack() {
    if (cancelOpening()) return;
    const current = navigation.getSnapshot().current, previousKey = navigation.getSnapshot().stacks[current.area].at(-2), previous = navigation.getSnapshot().routes.find(value => value.key === previousKey);
    const internal = live.current.lifecycleDestination && !live.current.entryLocked && previous && lifecycleRoute(previous);
    if (live.current.lifecycleDestination && !live.current.entryLocked && !internal) { exitLifecycle(); return; }
    if (live.current.locked && !internal) { setNotice(live.current.saving?'Device work is being saved. Try Back again when the save finishes.':live.current.lifecycleDestination ? LIFECYCLE_EXIT_NOTICE : 'Finish or resolve the current protected work before leaving.'); return; }
    remember(); restoreFocus.current = current.trigger; entryGate.current.invalidate(); navigation.back();
  }
  function exitLifecycle(destination) {
    const current = live.current;
    if (current.entryLocked || !current.lifecycleDestination) { setNotice(LIFECYCLE_BLOCKED_NOTICE); return false; }
    setNotice(clearLifecycleNotice);
    remember(); entryGate.current.invalidate();
    do { const departing = navigation.getSnapshot().current; restoreFocus.current = departing.trigger; if (!navigation.back()) { navigation.replace({ page:null,pageContext:{},scope:null,detail:null,lifecycleContext:false }); break; } } while (lifecycleRoute(navigation.getSnapshot().current));
    if (typeof destination === 'string' && areas.some(([id]) => id === destination)) navigation.activate(destination);
    return true;
  }
  function exitInspectionRecovery() {
    const current=live.current, snapshot=current.navigation.getSnapshot();
    if(snapshot.current.page!=='inspection-recovery')return;if (current.entryLocked) { if(current.saving)explainBlocked();return; }
    setNotice(value=>value===RECOVERY_NOTICE?'':value);
    entryGate.current.invalidate();
    if (snapshot.stacks[snapshot.area].length > 1) current.navigation.back(); else current.navigation.replace({page:null,pageContext:{},detail:null});
  }
  const push = useCallback((target,values) => { remember(); entryGate.current.invalidate(); navigation.push(target,{ lifecycleContext:live.current.lifecycleDestination,...values,trigger:document.activeElement },{ returnToOrigin:true }); },[navigation,remember]);
  function navigate(next) { if(!live.current.lifecycleDestination&&next===navigation.getSnapshot().area)return;if(entryIntent.current)cancelOpening(false);return startView({type:'area',area:next,label:areas.find(([id])=>id===next)?.[1]||'view'}); }
  const open = useCallback((destination,context = {}) => { if(live.current.namespace!==namespace)return;return startView({type:'page',page:destination,context,label:pageTitles[destination]||'view'}); },[namespace]);
  const personal = useCallback(kind => { if(live.current.namespace!==namespace)return;const boundary=({borrowed:'holder',responsible:'owner',holder:'holder',owner:'owner'})[kind];if(!boundary){setError('This personal inventory boundary is unavailable. No shared list has been substituted.');return;}return startView({type:'personal',boundary,label:boundary==='holder'?'Checked out to me':'Under my responsibility'}); },[namespace]);
  const openDetail = useCallback((id,context,source = null) => {
    const current = live.current;
    const currentRoute = current.navigation.getSnapshot().current;
    const taskReview = source?.taskReview === true && source.sourceRoute === currentRoute.key && ['task-plans','messages'].includes(currentRoute.page);
    if (source?.taskReview && !taskReview) return;
    if (current.detailBlocked || current.boundaryLocked && !taskReview) { setNotice(current.saving?'Device work is being saved. Try opening this record again when the save finishes.':'Finish or resolve protected work before opening another record.'); return; }
    try {
      if (taskReview && discoverMobileRecovery(businessStorage(),current.user.id)) { setNotice('Resolve the original saved request before opening another record.'); return; }
      const captured = captureDetailBoundary(current.data,current.user.id,id,context); current.navigation.rememberScroll(currentRoute.key,main.current?.scrollTop || 0); entryGate.current.invalidate(); current.navigation.push(current.navigation.getSnapshot().area,{ detail:captured,readOnly:taskReview,lifecycleContext:current.lifecycleDestination,trigger:document.activeElement });
    }
    catch (failure) { setError(failure.message); }
  },[]);

  useEffect(() => () => { entryGate.current.invalidate(); entryIntent.current = null; syncTracker.current.active = false; destinationMotion.current?.cancel(); if (live.current) { live.current.locked = true; live.current.ready = false; } },[]);
  useEffect(() => { const leave = () => { entryGate.current.invalidate(); cancelOpening(false); }, hidden = () => { if (document.visibilityState === 'hidden') leave(); }; document.addEventListener('visibilitychange',hidden); window.addEventListener('pagehide',leave); return () => { document.removeEventListener('visibilitychange',hidden); window.removeEventListener('pagehide',leave); }; },[cancelOpening]);

  useLayoutEffect(() => { if (!main.current) return; phoneScrollIntent.settle(main.current); main.current.scrollTop = route.scroll; restorePhoneFocus(restoreFocus.current); restoreFocus.current = null; },[namespace,route.key]);
  useEffect(() => {
    document.body.classList.add('phone-session');
    const stopTracking = trackPhoneScroll(document), stopModality = trackPhoneInputModality(document);
    return () => { document.body.classList.remove('phone-session'); document.body.removeAttribute('data-phone-reduced-motion'); stopTracking(); stopModality(); };
  },[]);
  useEffect(() => { document.body.dataset.phoneReducedMotion = String(reducedMotion); document.body.dataset.phoneLayout = layout; document.body.dataset.phoneKeyboard = String(keyboardOpen); },[reducedMotion,layout,keyboardOpen]);
  useEffect(() => { if (ready && !recovering && !recoveryError) { markPhoneMilestone('inventory-ready'); markPhoneMilestone('first-interactive'); } },[ready,recovering,recoveryError]);
  useEffect(() => {
    const readDialogs = () => { const dialogs = visiblePhoneOverlays(document); setPortalLocked(!!dialogs.length); setExternalPortalLocked(dialogs.some(node => !phoneWorkflowOwnsOverlay(node,workflow?.nonce))); setDatasetOtherPortalLocked(dialogs.some(node => !phoneWorkflowOwnsOverlay(node,datasetPickerOwner))); };
    const observer = new MutationObserver(readDialogs); observer.observe(document.body,{ childList:true,subtree:true,attributes:true,attributeFilter:['data-state','hidden','style','open','inert','role','data-phone-workflow-owner','id','aria-controls','aria-expanded','disabled'] }); readDialogs(); return () => observer.disconnect();
  },[workflow?.nonce,datasetPickerOwner]);
  useEffect(() => {
    const boundary = event => setBoundaryLocked(!!event.detail), updated = () => { void load(dataset).catch(failure => setReadError(failure.message)); };
    window.addEventListener('battery-mobile-workflow-active',boundary); window.addEventListener('battery-mobile-inventory-refresh',updated);
    return () => { window.removeEventListener('battery-mobile-workflow-active',boundary); window.removeEventListener('battery-mobile-inventory-refresh',updated); };
  },[dataset,load,setReadError]);
  useEffect(() => {
    const back = event => {
      const consume = () => { event.preventDefault(); event.stopImmediatePropagation(); };
      if (keyboardOpen && phoneEditable(document.activeElement)) { document.activeElement.blur(); consume(); return; }
      const overlay = topPhoneOverlay(document,node => window.getComputedStyle(node));
      if (overlay) { dismissPhoneOverlay(overlay); consume(); return; }
      if (backRegistry.handle(event)) { consume(); return; }
      if (cancelOpening()) { consume(); return; }
      if (workflow && ['lookup','checkout','return','intake','retire'].includes(workflow.kind)) return;
      if (saving || storageError || recovering || recoveryError || sessionBusy) { setNotice('Resolve device recovery before leaving this view.'); consume(); return; }
      if (workflow) { const exit = [...document.querySelectorAll('.phone-main button')].find(button => button.hasAttribute('data-workflow-exit') || /^Exit (registration|manual registration)/i.test(button.getAttribute('aria-label') || button.textContent.trim())); if (exit && !exit.disabled) exit.click(); else setNotice('Use Exit after finishing the protected operation.'); consume(); return; }
      if (panelLocked || boundaryLocked || overlayOpen) { setNotice('Finish or resolve the current protected work before leaving.'); consume(); return; }
      if (navigation.getSnapshot().current.detail || navigation.getSnapshot().current.page || navigation.getSnapshot().area !== 'scan' || navigation.getSnapshot().stacks.scan.length > 1) { goBack(); consume(); return; }
      if (native) { if (accountHasDeviceWork(businessStorage(),user.id)) setNotice('Saved work is retained. Back cannot leave while this account has device work.'); else void nativeUI.backgroundApp().catch(failure => setError(failure.message)); consume(); }
    };
    window.addEventListener('battery-mobile-back',back,{ capture:true }); return () => window.removeEventListener('battery-mobile-back',back,{ capture:true });
  },[keyboardOpen,backRegistry,workflow,saving,storageError,recovering,recoveryError,sessionBusy,panelLocked,boundaryLocked,overlayOpen,navigation,user.id]);

  const changed = useCallback(async () => { await load(dataset); },[load,dataset]);
  const closeWorkflow = useCallback(() => {
    const previous = workflow; setWorkflow(null); lockHandler('workflow:' + previous?.nonce)(false);
    setClosingWorkflow(true);try{setSavedWork(discoverMobileDrafts(businessStorage(),user.id));}catch(failure){setRecoveryError(failure.message);}
    setNotice(value=>value===RECOVERY_NOTICE?'':value);
    requestAnimationFrame(() => { if (previous?.returnRoute === live.current.navigation.getSnapshot().current.key) { main.current?.scrollTo({ top:previous.returnScroll || 0,behavior:'instant' }); restorePhoneFocus(previous.returnFocus); } });
    void refresh();
  },[refresh,workflow]);
  const closeTeaching = useCallback(snapshot => { acceptReviewedInventory(snapshot); setTeaching(null); lockHandler('teaching-overlay')(false); },[acceptReviewedInventory]);
  function resume(pending) { if (!pending) return; entryGate.current.invalidate(); if (dataset !== pending.dataset) changeDataset(pending.dataset); setRecovering(pending); setNotice(RECOVERY_NOTICE); }
  useEffect(() => { if (recoveryStarted.current) return; recoveryStarted.current = true; try { const mandatory=discoverMobileRecovery(businessStorage(),user.id,{protectedOnly:true});if(mandatory)resume(mandatory);else setSavedWork(discoverMobileDrafts(businessStorage(),user.id)); } catch (failure) { setRecoveryError(failure.message); } finally { setRecoveryChecked(true); } },[user.id]);
  useEffect(() => {
    if (!recovering || !data || data.dataset !== recovering.dataset) return;
    const pending = recovering; setRecovering(null);
    const root = (target,pageValue = null,context = {}) => { navigation.resetArea(target); navigation.replace({ page:pageValue,pageContext:context }); };
    if (pending.type === 'teaching') { root('workspace','teaching-groups'); setTeaching(pending.draft); }
    else if (pending.type === 'location') { root('inventory'); setLocations(true); }
    else if (pending.type === 'movement') setMovement({ kind:pending.kind,ids:[],nonce:crypto.randomUUID() });
    else if (pending.type === 'workspace') root(pending.view === 'messages' ? 'me' : 'workspace',pending.view,{ initialTools:pending.initialTools,taskId:pending.initialTaskId });
    else if (pending.type === 'inspection') { root('inventory'); if (data.batteries.some(item => item.id === pending.batteryId)) { navigation.replace({ detail:{ id:pending.batteryId } }); setFullRecord(true); } else navigation.replace({ page:'inspection-recovery',pageContext:{ batteryId:pending.batteryId } }); }
    else if (pending.type === 'retired') root('workspace','removal-history');
    else if (pending.type === 'group') { root('workspace','teaching-groups'); setGroupMaintenance({ ids:[] }); }
    else { const kind = ({ scan:pending.kind,registration:'registration',manual_registration:'manual_registration',intake:'intake',removal:'retire' })[pending.type]; if (kind) setWorkflow({ kind,nonce:crypto.randomUUID(),ids:[],scope:pending.scope }); }
  },[recovering,data,navigation]);
  async function interceptRecovery(token = null,pending = null) {
    try {
      if (!pending?.cleaned) {
        // Only this exact cleanup may explain its own temporary saving lock.
        if (pending) pending.ownsCleanup = true;
        await clearEmptyDeviceWork(businessStorage(),user.id);
        if (pending) pending.cleaned = true;
      }
      if (token && !token.current(pending?intentContext():entryContext(true))) return true;
      const recovery = discoverMobileRecovery(businessStorage(),user.id,{protectedOnly:true});
      if (recovery) { resume(recovery); return true; }
    } catch (failure) { if (!token || token.current(pending?intentContext():entryContext(true))) setRecoveryError(failure.message); return true; }
    return false;
  }
  const entryContext = (internal = false,ownedCleanup = false) => ({ namespace:live.current.namespace,routeKey:live.current.navigation.getSnapshot().current.key,locked:document.visibilityState === 'hidden' || (internal ? ownedCleanup ? live.current.entryLockedWithoutSaving : live.current.entryLocked : live.current.locked) });
  const intentContext=()=>({namespace:live.current.namespace,routeKey:live.current.navigation.getSnapshot().current.key,locked:document.visibilityState==='hidden'});
  function admissionFor(pending){return phoneAdmission(live.current.admissionState,{viewOnly:!!pending?.destination});}
  function performView(destination,trigger){
    const current=live.current;
    let mandatory;try{mandatory=discoverMobileRecovery(businessStorage(),current.user.id,{protectedOnly:true});}catch(failure){setRecoveryError(failure.message);return;}if(mandatory){resume(mandatory);return;}
    if(destination.type==='area'){
      if(!areas.some(([id])=>id===destination.area))throw new Error('This phone area is unavailable.');
      if(current.lifecycleDestination){exitLifecycle(destination.area);return;}
      remember();entryGate.current.invalidate();setNotice(clearLifecycleNotice);current.navigation.activate(destination.area);return;
    }
    if(current.lifecycleDestination) {setNotice(LIFECYCLE_EXIT_NOTICE);return;}
    if(destination.type==='search'){
      const currentRoute=current.navigation.getSnapshot().current;
      remember();entryGate.current.invalidate();
      if(currentRoute.area==='inventory'&&!currentRoute.page&&!currentRoute.detail)current.navigation.replace({pageContext:{...currentRoute.pageContext,searchRequest:destination.request}});
      else current.navigation.push('inventory',{scope:destination.scope,pageContext:{searchRequest:destination.request,sharedSearch:!destination.scope},trigger},{returnToOrigin:true});
      return;
    }
    const target=destination.type==='personal'?'inventory':['messages','my-activity','account','service','diagnostics'].includes(destination.page)?'me':'workspace';
    const values=destination.type==='personal'?{scope:{kind:destination.boundary,id:current.user.id,label:destination.label}}:{page:destination.page,pageContext:destination.context};
    remember();entryGate.current.invalidate();current.navigation.push(target,{...values,trigger},{returnToOrigin:true});
  }
  function startView(destination){
    if(entryIntent.current||document.visibilityState==='hidden')return;
    if(live.current.lifecycleDestination&&destination.type!=='area'){setNotice(LIFECYCLE_EXIT_NOTICE);return;}
    if(live.current.navigation.getSnapshot().current.page==='inspection-recovery'){setNotice('Resolve inspection recovery before leaving this view.');return;}
    const admission=phoneAdmission(live.current.admissionState,{viewOnly:true});
    if(admission.category==='protected'){setNotice(admission.reason);return;}
    if(admission.category==='invalidated')return;
    const token=entryGate.current.begin(intentContext()),pending=capturePhoneEntryIntent({kind:'view',ids:[],context:null,separateCheckout:false,token,routeKey:live.current.navigation.getSnapshot().current.key,trigger:document.activeElement,readEpoch:syncTracker.current.epoch});
    pending.destination=structuredClone(destination);pending.waitReason=admission.reason;
    if(admission.category==='waiting'){entryIntent.current=pending;setEntryPending({...pending});return;}
    try{performView(pending.destination,pending.trigger);}catch(failure){if(token.current(intentContext()))setRecoveryError(failure.message);}
  }
  async function selectDataset(next,{ lifecycle = false } = {}) {
    const internal = lifecycle && live.current.lifecycleDestination;
    if(next===dataset)return;if ((internal ? live.current.entryLocked : live.current.locked)) { explainBlocked();return; }
    const token = entryGate.current.begin(entryContext(internal)); if (await interceptRecovery() || !token.current(entryContext(internal))) return;
    remember(); entryGate.current.invalidate(); live.current.ready = false; live.current.namespace = user.id + ':' + next;
    if (internal) { if (!sessions.current.has(live.current.namespace)) sessions.current.set(live.current.namespace,createPhoneNavigation(live.current.namespace)); const target=sessions.current.get(live.current.namespace); target.push('workspace',{page:'assets'}); }
    changeDataset(next);
  }
  async function startOperation(kind,ids = [],context = null,separateCheckout = false,saved = null) {
    if(entryIntent.current||document.visibilityState==='hidden')return;
    const admission=live.current.admission;
    if(admission.category==='invalidated')return;
    if(admission.category==='protected'){setNotice(admission.reason);return;}
    const token = entryGate.current.begin(intentContext());
    if (admission.category==='waiting' || syncTracker.current.reads > 0) {
      const pending = capturePhoneEntryIntent({kind,ids,context,separateCheckout,token,routeKey:live.current.navigation.getSnapshot().current.key,trigger:document.activeElement,readEpoch:syncTracker.current.epoch,requiresRead:true});
      pending.requiresRead=!live.current.ready||syncTracker.current.reads>0;pending.saved=saved;pending.waitReason=admission.reason;
      if (!live.current.loading && live.current.error) pending.phase = 'failed';
      entryIntent.current = pending; setEntryPending({...pending}); setNotice(clearReadinessNotice); return;
    }
    const pending = capturePhoneEntryIntent({kind,ids,context,separateCheckout,token,routeKey:live.current.navigation.getSnapshot().current.key,trigger:document.activeElement,readEpoch:syncTracker.current.epoch});
    pending.saved=saved;
    pending.phase='opening'; entryIntent.current=pending; setEntryPending({...pending}); setNotice(clearReadinessNotice);
    try {
      const result = await executeOperation(kind,ids,context,separateCheckout,token,pending);
      if(entryIntent.current!==pending)return;
      if(['waiting','failed'].includes(result)&&token.current(intentContext())) { pending.phase=result;setEntryPending({...pending}); }
      else { entryIntent.current=null;setEntryPending(null); }
    } catch(failure) {
      if(entryIntent.current===pending&&token.current(intentContext())) { pending.phase='failed';setEntryPending({...pending});setError(failure.message); }
    }
  }
  async function executeOperation(kind,ids,context,separateCheckout,token,pending = null) {
    if (!token.current(intentContext())) return;
    const admission=admissionFor(pending);
    if(admission.category==='protected'){setNotice(admission.reason);return;}
    if (admission.category==='waiting') return 'waiting';
    if(pending?.destination){performView(pending.destination,pending.trigger);return;}
    if (await interceptRecovery(token,pending) || !token.current(intentContext())) return;
    if (!live.current.ready || live.current.entryLocked || syncTracker.current.reads > 0) return 'waiting';
    const latestRead = syncTracker.current.latest;
    if ((pending?.requiresRead || latestRead?.epoch > pending?.readEpoch) && (!latestRead || latestRead.epoch < pending.readEpoch || latestRead.outcome !== 'accepted')) return 'failed';
    if (pending) pending.ownsCleanup = false;
    if(pending?.saved){
      const saved=discoverMobileDrafts(businessStorage(),user.id).find(item=>item.type===pending.saved.type&&item.dataset===pending.saved.dataset&&item.kind===pending.saved.kind);
      if(!saved||JSON.stringify(saved.draft)!==JSON.stringify(pending.saved.draft)||JSON.stringify(saved.scope)!==JSON.stringify(pending.saved.scope)){setError('This saved work changed. Review its current saved-work entry before continuing.');setSavedWork(discoverMobileDrafts(businessStorage(),user.id));return;}
      resume(saved);return;
    }
    const current = live.current, currentData = current.data, actor = current.user;
    if (kind === 'removal') kind = 'retire';
    if (['checkout','return','retire'].includes(kind) && ids.length) {
      try {
        const boundary = inventoryBoundaryIds(currentData,actor.id,context?.kind ? context : null);
        if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !boundary.has(id)) || !selectedOperationState(currentData.batteries,ids)[kind]) { setError('The selected batteries or recorded loan state changed. Review your retained selection before preparing this task.'); return; }
      } catch (failure) { setError(failure.message); return; }
    }
    const requestedGroup = context?.kind === 'group' ? currentData.teachingGroups.find(item => item.id === context.id && item.ownerAccountId === actor.id && item.state === 'active') : null;
    const reference = requestedGroup ? { id:requestedGroup.id,version:requestedGroup.version } : context?.version ? context : null;
    if (context?.kind === 'group' && requestedGroup && context.version != null && context.version !== requestedGroup.version) { setError('The reviewed group changed. Refresh and review its current members.'); return; }
    if (context?.kind === 'group' && !requestedGroup) { setError('This saved group is unavailable. Refresh and review its current membership.'); return; }
    if (reference && kind === 'checkout') { const group = currentData.teachingGroups.find(item => item.id === reference.id && item.version === reference.version); if (!group) { setError('The reviewed group changed. Refresh and review its current members.'); return; } current.locked = true; current.entryLocked = true; entryGate.current.invalidate(); setTeaching({ kind:'checkout',group,ids:[...ids],personalScope:personalBoundary(context),separateCheckout }); return; }
    if (kind === 'intake' && current.dataset !== 'demo') { push(current.navigation.getSnapshot().area,{ page:'intake-choice' }); return; }
    remember(); current.locked = true; current.entryLocked = true; entryGate.current.invalidate(); setWorkflow({ kind,ids:[...ids],scope:context?.kind ? context : undefined,teachingGroup:reference || undefined,returnRoute:current.navigation.getSnapshot().current.key,returnScroll:main.current?.scrollTop || 0,returnFocus:pending?.trigger || document.activeElement,nonce:crypto.randomUUID() });
  }
  const retryOpening = useCallback(async () => {
    const pending = entryIntent.current;
    if (!pending || pending.phase !== 'failed' || !pending.token.current(intentContext())) return;
    pending.phase = 'waiting'; pending.retrying = true; pending.readEpoch = syncTracker.current.epoch + 1; pending.requiresRead = true; setEntryPending({...pending});
    try { await live.current.refresh(); }
    catch { /* Inventory owns its read error; this intent never submits work. */ }
    finally { if (entryIntent.current === pending) { pending.retrying = false; setEntryPending({...pending}); } }
  },[]);
  useEffect(() => {
    const pending = entryIntent.current;
    if (!pending) return;
    if (!pending.token.current(intentContext())) { entryIntent.current = null; setEntryPending(null); return; }
    const admission=admissionFor(pending);
    if(admission.category==='protected'){setNotice(admission.reason);entryIntent.current=null;setEntryPending(null);return;}
    const waitReason=admission.category==='waiting'?admission.reason:'';
    if(pending.waitReason!==waitReason){pending.waitReason=waitReason;setEntryPending({...pending});}
    if (pending.cleaned && !saving) pending.ownsCleanup = false;
    if (pending.phase !== 'waiting' || pending.retrying) return;
    if (!pending.destination&&!inventoryReading && error) { pending.phase = 'failed'; setEntryPending({...pending}); return; }
    if (admission.category==='waiting') return;
    const latestRead = syncTracker.current.latest;
    // A later read replaces the proof, even if an earlier read was accepted.
    if (pending.requiresRead && (!latestRead || latestRead.epoch < pending.readEpoch || latestRead.outcome !== 'accepted')) { pending.phase = 'failed'; setEntryPending({...pending}); return; }
    pending.phase = 'opening'; setEntryPending({...pending});
    void executeOperation(pending.kind,pending.ids,pending.context,pending.separateCheckout,pending.token,pending).then(result => {
      if (entryIntent.current !== pending) return;
      if (result === 'waiting' && pending.token.current(intentContext())) { pending.phase = 'waiting'; setEntryPending({...pending}); }
      else if (result === 'failed' && pending.token.current(intentContext())) { pending.phase = 'failed'; setEntryPending({...pending}); }
      else { entryIntent.current = null; setEntryPending(null); }
    }).catch(failure => { if (entryIntent.current === pending&&pending.token.current(intentContext())) { pending.phase = 'failed'; setEntryPending({...pending}); setError(failure.message); } });
  },[namespace,route.key,ready,inventoryReading,error,user,protectedLocked,saving,entryPending]);
  async function defineGroup(ids,scope = null) {
    if (live.current.locked || !live.current.ready) { explainBlocked();return; }
    const token = entryGate.current.begin(entryContext());
    if (await interceptRecovery() || !token.current(entryContext()) || !live.current.ready) return;
    const current = live.current, currentRoute = current.navigation.getSnapshot().current;
    const selected = Array.isArray(ids) ? [...new Set(ids)] : [];
    let boundary;
    try { boundary = inventoryBoundaryIds(current.data,current.user.id,scope || currentRoute.scope); }
    catch (failure) { setError(failure.message); return; }
    if (!selected.length || selected.length > 100 || selected.length !== ids.length || selected.some(id => !boundary.has(id))) { setError('Review one to 100 distinct registered batteries in this view before saving a teaching group.'); return; }
    current.locked = true; current.entryLocked = true; entryGate.current.invalidate();
    setGroupDefinition({ ids:selected,namespace:current.namespace,routeKey:currentRoute.key,nonce:crypto.randomUUID() });
  }
  const rootOperation = useMemo(() => ({ current:startOperation }),[namespace]);
  rootOperation.current = startOperation;
  rootOperation.defineGroup = defineGroup;
  const rootStartOperation = useCallback((...args) => { if (live.current.namespace !== namespace) return; return rootOperation.current(...args); },[namespace,rootOperation]);
  const rootGroup = useCallback((ids,scope) => { if (live.current.namespace !== namespace) return; return rootOperation.defineGroup(ids,scope); },[namespace,rootOperation]);
  const openGroupView = useCallback((group,select = false,sourceRoute) => {
    const current = live.current;
    if (current.namespace !== namespace || sourceRoute !== current.navigation.getSnapshot().current.key) return;if(!current.ready||current.groupViewBlocked){explainBlocked();return;}
    try {
      if (discoverMobileRecovery(businessStorage(),current.user.id)) { setNotice('Resolve the original saved request before opening another view.'); return; }
      const groupScope = prepareTeachingGroupView(current.data,current.user.id,current.dataset,group,{ select });
      if (!groupScope) { setError('This saved group changed or is unavailable. Refresh and review its current members.'); return; }
      setGroupDefinition(null); push('inventory',{ scope:groupScope });
    } catch (failure) { setError(failure.message); }
  },[namespace,push]);
  const rootLookup = useCallback(() => rootStartOperation('lookup'),[rootStartOperation]);
  const rootRegister = useCallback(() => open('assets'),[open]);
  const openAppSettings = useCallback(() => open('service'),[open]);
  const lookupExport = useCallback(id => { const current = live.current; if (current.workflow?.kind !== 'lookup' || typeof id !== 'string' || !id) return; setExportDraft({ batteryId:id,filter:{ ...defaultInventoryFilter(),lifecycle:'all' },page:0,pageSize:'25',matching:1,pageCount:1 }); },[]);
  const write = async (action,payload,extra) => {
    const intakeAttempt = action === 'intake' ? captureIntakeAttempt(user.id,dataset,payload) : null, lifecycleAttempt = action === 'lifecycle' ? captureLifecycleAttempt(user.id,dataset,payload) : null;
    const body = await inventoryResponse(await fetch('/api/inventory',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ dataset,action,payload,...extra }) }));
    if (action === 'scan_lookup') return body.result;
    if (intakeAttempt) { verifyIntakeReceipt(body.result,intakeAttempt); return body.result; }
    if (lifecycleAttempt) { verifyLifecycleReceipt(body.result,lifecycleAttempt); return body.result; }
    if (action === 'movement') verifyMovementReceipt(body.result,payload,user.id);
    if (['inspection','inspection_void','retired_asset'].includes(action)) return body.result;
    try { await changed(); } catch (failure) { setNotice('The server confirmed the change. Refresh before another operation.'); setReadError(failure.message); } return body.result;
  };
  const groupWrite = reference => (action,payload,extra) => write(action,reference && ['battery','charge','observation','correction'].includes(action) ? { ...payload,teachingGroup:reference } : payload,extra);
  function detailExport() { if (!detail) return; let group; try { group = verifyDetailBoundary(detail,data,user.id); } catch (failure) { setError(failure.message); return; } const filter = { ...defaultInventoryFilter(),personalScope:personalBoundary(detail.scope),mappingRoom:detail.scope?.kind === 'room' ? detail.scope.id : null,groupId:group?.id || null }; setExportDraft({ ...(!group ? { batteryId:detail.id } : { selectedIds:[detail.id],selectedOnly:true,teachingGroup:group }),filter,page:0,pageSize:'25',matching:1,pageCount:1 }); }
  const edit = useCallback((draft,group) => { const normalized = draft.kind ? draft : { kind:'battery',record:draft }; if (normalized.kind === 'battery' && !normalized.record) { remember(); setWorkflow({ kind:'manual_registration',nonce:crypto.randomUUID(),returnRoute:route.key,returnScroll:main.current?.scrollTop || 0,returnFocus:document.activeElement }); return; } setEditor({ draft:normalized,group }); },[navigation,route.key]);
  const signout = useCallback(async () => { const current = live.current; if (current.locked || accountHasDeviceWork(businessStorage(),current.user.id)) { setNotice('Finish or resume retained device work before signing out.'); return; } entryGate.current.invalidate(); current.locked = true; setSessionBusy(true); try { await clearEmptyDeviceWork(businessStorage(),current.user.id); await inventoryResponse(await fetch('/api/session',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ action:'signout' }) })); onSignedOut(); } catch (failure) { setError(failure.message); } finally { setSessionBusy(false); } },[onSignedOut]);
  async function preference(name,value) { const next = { ...preferences,[name]:value }; try { businessStorage().setItem('preference:mobile-feedback',JSON.stringify(next)); await businessStorage().flush(); setPreferences(next); } catch (failure) { setError(failure.message); } }
  async function changeMotion(value) { try { businessStorage().setItem('preference:mobile-motion',value ? 'reduce' : 'system'); await businessStorage().flush(); setMotionPreference(value ? 'reduce' : 'system'); } catch (failure) { setError(failure.message); } }
  const detailBattery = data?.batteries.find(item => item.id === detail?.id);
  useEffect(() => { if (data && fullRecord && detail && !detailBattery) { setFullRecord(false); navigation.replace({ page:'inspection-recovery',pageContext:{batteryId:detail.id},detail:null }); } },[data,fullRecord,detail,detailBattery,navigation]);
  let resolvedDetailGroup = null, detailBoundaryError = '';
  try { if (data) resolvedDetailGroup = verifyDetailBoundary(detail,data,user.id); } catch (failure) { detailBoundaryError = failure.message; }
  const floating = !!workflow && ['lookup','checkout','return','intake','retire'].includes(workflow.kind), title = detail ? 'Battery record' : page === 'messages' && pageContext.taskContext === 'open' ? 'My tasks' : pageTitles[page] || scope?.label || areas.find(([id]) => id === area)?.[1];
  useLayoutEffect(() => {
    destinationMotion.current?.cancel(); destinationMotion.current = null;
    const previous = destinationView.current; destinationView.current = view;
    if (!data || workflow || reducedMotion || iosPresentation && document.visibilityState === 'hidden') return;
    const node = main.current?.querySelector?.('.phone-route:not([hidden])');
    if (!node?.animate) return;
    const transition = iosPresentation ? iosRouteTransition(previous, view) : { frames:[{ opacity:.75,transform:'translateX(4px)' },{ opacity:1,transform:'none' }], options:{ duration:190,easing:'cubic-bezier(.2,0,0,1)' } };
    if (!transition) return;
    destinationMotion.current = node.animate(transition.frames, transition.options);
    const cancelHidden = () => { if (document.visibilityState === 'hidden') { destinationMotion.current?.cancel(); destinationMotion.current = null; } };
    if (iosPresentation) document.addEventListener('visibilitychange',cancelHidden);
    return () => { if (iosPresentation) document.removeEventListener('visibilitychange',cancelHidden); destinationMotion.current?.cancel(); destinationMotion.current = null; };
  },[namespace,route.key,!!data,!!workflow,reducedMotion,iosPresentation]);
  const refreshing = loading || backgroundRefreshing;
  useEffect(() => backRegistry.register(() => { const node = readFeedback.current; if (!node?.open) return false; node.open = false; return true; },600),[backRegistry]);
  const refreshControl = error && data ? <details ref={readFeedback} className="phone-refresh-feedback"><summary aria-label="Review refresh failure"><RefreshCw size={19}/><i aria-hidden="true">!</i></summary><div className="phone-refresh-feedback-panel"><PhoneReadError error={error} stale compact busy={refreshing} onRetry={refresh}/></div></details> : <Pressable className={'phone-icon-button' + (refreshing ? ' is-updating' : '')} disabled={refreshing || protectedLocked} onClick={refresh} aria-label="Refresh inventory" aria-busy={refreshing}><RefreshCw size={19}/></Pressable>;
  const backAvailable = view.stacks[area].length > 1 || !!page || !!detail || !!scope;
  const shell = { data,user,dataset,navigation,revision,ready,workflow,overlayOpen,operationLocked,protectedLocked,unreadCount,origin,preferences,motionPreference,systemReduced,notice,changed,write,open,goBack,push,personal,openDetail,startOperation,rootStartOperation,rootGroup,openGroupView,selectDataset,exitInspectionRecovery,edit,setExportDraft,setImportKind,setGroupMaintenance,setTeaching,setLocations,setFullRecord,acceptUnreadCount,lockHandler,signout,preference,changeMotion,onFieldTest,onExportRecovery,closeWorkflow,detailExport,rootLookup,rootRegister,openAppSettings,entryPending,cancelOpening,retryOpening,iosPresentation };
  return <PhoneUIProvider namespace={namespace} scrollRef={main} reducedMotion={reducedMotion} backRegistry={backRegistry}>
    <PhoneArrivalsProvider namespace={namespace} data={data} load={load}>
    <div className={'phone-shell' + (iosPresentation ? ' ios-shell' : '') + (floating ? ' phone-workflow-open' : '') + (keyboardOpen ? ' phone-keyboard-open' : '')} style={{'--phone-focus-enter':`${PHONE_FOCUS_ENTRY_MS}ms`,'--phone-focus-exit':`${PHONE_FOCUS_EXIT_MS}ms`}} inert={floating ? true : undefined} aria-hidden={floating ? true : undefined} data-reduced-motion={reducedMotion} data-phone-layout={layout} data-phone-keyboard={String(keyboardOpen)}>
      <header className="phone-topbar" data-ink-gaze-scope>{iosPresentation && <IosSearch routeKey={route.key} disabled={live.current.admission.category === 'protected' || lifecycleDestination || page === 'inspection-recovery' || !!entryPending} onSearch={text => startView(iosSearchDestination(route,text,crypto.randomUUID()))}/>} {backAvailable && <Pressable className="phone-icon-button" aria-label="Back to previous view" onClick={() => { if (!backRegistry.handle({})) goBack(); }} disabled={protectedLocked}><ArrowLeft size={22}/></Pressable>}<div className="phone-title-block"><h1>{title}</h1><span className="phone-sync-status" role="status" aria-live="polite" data-sync-state={data ? error ? 'stale' : refreshing ? 'refreshing' : 'ready' : 'initial'}>{data && (refreshing ? 'Refreshing records…' : error ? 'Showing last loaded records' : '')}</span></div><div className="phone-topbar-actions">{lifecycleDestination && <Pressable className="phone-header-exit" aria-label="Exit Intake & removal" onClick={exitLifecycle} disabled={protectedLocked}>Exit</Pressable>}<PhoneUIBoundary workflowOwner={datasetPickerOwner}><PhoneChoice label="Shared inventory" aria-label="Shared inventory" variant="compact" value={dataset} options={[{value:'live',label:'Working'},{value:'demo',label:'Demo'}]} disabled={datasetPickerLocked} onChange={next => void selectDataset(next)}/></PhoneUIBoundary>{refreshControl}</div></header>
      <main ref={main} className="phone-main" data-phone-scroll id="phone-content" tabIndex={-1} data-phone-content-state={!data ? error ? 'failed' : 'loading' : inventoryReading ? 'refreshing' : error ? 'stale' : 'ready'} onScroll={event => navigation.rememberScroll(navigation.getSnapshot().current.key,event.currentTarget.scrollTop)}>
        {(notice||actionError||recoveryError||entryPending&&!(area==='scan'&&!page&&!detail))&&<div className="phone-shell-status" data-scroll-status={area==='scan'&&!page&&!detail?'home':'view'}>
        {entryPending && !(area === 'scan' && !page && !detail) && <div className="scan-entry-progress" role="status" aria-live="polite"><span>{phoneEntryMessage(entryPending)}</span>{entryPending.phase === 'failed' && <Pressable className="phone-secondary" onClick={retryOpening}>Retry</Pressable>}<Pressable className="phone-secondary" onClick={cancelOpening} aria-label="Cancel opening">Cancel</Pressable></div>}
        {notice && <div className="phone-notice" role="status"><span>{notice}</span><Pressable aria-label="Dismiss status" onClick={() => setNotice('')}>×</Pressable></div>}
        {actionError && <div className="phone-alert" role="alert"><span>{actionError}</span><Pressable className="phone-icon-button" aria-label="Dismiss action message" onClick={() => setError('')}>×</Pressable></div>}
        {recoveryError && <section className="phone-recovery" role="alert"><strong>Device recovery needs attention</strong><p>{recoveryError}</p><Pressable className="phone-secondary" onClick={onExportRecovery}>Export preserved recovery</Pressable></section>}
        </div>}
        {!workflow&&area==='scan'&&!page&&savedWork.length>0&&<details className="phone-saved-work" aria-label="Saved device work" inert={entryPending?true:undefined}><summary>Saved work · {savedWork.length}</summary><p>Nothing was submitted automatically. Choose what to continue.</p><div>{savedWork.map((saved,index)=><Pressable key={index} className="phone-secondary" disabled={!!entryPending} onClick={()=>saved.dataset!==dataset?void selectDataset(saved.dataset):void startOperation(saved.type==='scan'?saved.kind:saved.type==='removal'?'removal':saved.type,[],null,false,saved)}>{saved.dataset!==dataset?`View ${saved.dataset==='demo'?'Demonstration':'Working'} saved work`:`Continue ${saved.label}`}</Pressable>)}</div></details>}
        {!data ? <InitialContentSurface title={recovering ? 'Restoring saved work' : title} error={error} loading={inventoryReading} onRetry={refresh}/> : view.routes.map(saved => { const current = saved.key === route.key, visible = current && (!workflow || floating); return <PhoneUIBoundary key={saved.key} active={current && !workflow}><div className="phone-route" data-route={saved.key} hidden={!visible} inert={!current || workflow ? true : undefined}><RouteView route={saved} active={current && !workflow} backdropVisible={current && floating} shell={shell}/></div></PhoneUIBoundary>; })}
        {data && workflow?.kind === 'registration' && <Registration user={user} initialData={data} onExit={closeWorkflow}/>}
        {data && workflow?.kind === 'manual_registration' && <PhoneUIBoundary workflowOwner={workflow.nonce} active={!externalPortalLocked}><ManualRegistration data={data} user={user} dataset={dataset} onExit={closeWorkflow} onChanged={changed} onLockedChange={workflowLock}/></PhoneUIBoundary>}
      </main>
      <>{iosPresentation ? <IosDock area={area} hidden={keyboardOpen} disabled={live.current.admission.category === 'protected' || page === 'inspection-recovery'} unreadCount={unreadCount} onNavigate={navigate} inventoryIndicator={<ArrivalNavigationIndicator active={!workflow && !keyboardOpen}/>}/> : <nav className="phone-bottom-bar" style={{ '--nav-index':areas.findIndex(([id]) => id === area) }} aria-label="Primary mobile navigation" hidden={keyboardOpen}>{areas.map(([id,label,Icon]) => <Pressable key={id} aria-current={area === id ? 'page' : undefined} disabled={live.current.admission.category==='protected'||page==='inspection-recovery'} onClick={() => navigate(id)}><span className="phone-nav-icon"><Icon size={22}/>{id === 'me' && unreadCount > 0 && <i aria-label={unreadCount + ' unread messages'}/>} {id === 'inventory' && <ArrivalNavigationIndicator active={!workflow && !keyboardOpen}/>}</span><span>{label}</span></Pressable>)}</nav>}</>
    </div>
    {data && movement && <PhoneBusinessSurface task="movement-review"><MovementDialog key={movement.nonce} draft={movement} data={data} write={write} onClose={snapshot => { acceptReviewedInventory(snapshot); setMovement(null); }}/></PhoneBusinessSurface>}
    {data && teaching && <PhoneBusinessSurface task="teaching-review"><TeachingCheckoutDialog data={data} draft={teaching} onChanged={changed} onClose={closeTeaching} onLockedChange={lockHandler('teaching-overlay')}/></PhoneBusinessSurface>}
    {data && groupMaintenance && <PhoneBusinessSurface task="group-maintenance"><GroupMaintenanceDialog data={data} {...groupMaintenance} write={write} onChanged={changed} onClose={() => setGroupMaintenance(null)}/></PhoneBusinessSurface>}
    {data && groupDefinition && <PhoneBusinessSurface task="group-definition"><TeachingGroupsPanel key={groupDefinition.nonce} data={data} initialIds={groupDefinition.ids} onChanged={changed} onClose={() => setGroupDefinition(null)} onSaved={() => setGroupDefinition(null)} onFilter={group => openGroupView(group,false,groupDefinition.routeKey)} onSelect={group => openGroupView(group,true,groupDefinition.routeKey)}/></PhoneBusinessSurface>}
    {data && editor && <PhoneBusinessSurface task="edit-record"><RecordEditor draft={editor.draft} data={data} write={groupWrite(editor.group)} onClose={() => setEditor(null)}/></PhoneBusinessSurface>}
    {data && fullRecord && detailBattery && !detailBoundaryError && <PhoneBusinessSurface task="battery-record"><BatteryDetails battery={detailBattery} data={data} revision={revision} onInspectionChanged={changed} onClose={() => setFullRecord(false)} onEdit={record => { setFullRecord(false); edit({ kind:'battery',record },resolvedDetailGroup || undefined); }} onExport={detailExport} write={groupWrite(resolvedDetailGroup || undefined)}/></PhoneBusinessSurface>}
    {data && locations && <PhoneBusinessSurface task="location-tools"><LocationToolsPanel data={data} ready={ready} onChanged={changed} onClose={() => setLocations(false)}/></PhoneBusinessSurface>}
    {exportDraft && <PhoneBusinessSurface task="export"><ExportDialog draft={exportDraft} dataset={dataset} onClose={() => setExportDraft(null)}/></PhoneBusinessSurface>}
    {importKind && <MobileImportDialog kind={importKind} write={write} onClose={() => setImportKind(null)}/ >}
    <FloatingWorkflow iosPresentation={iosPresentation} open={floating} owner={workflow?.nonce} label={workflow?.kind + ' · ' + (dataset === 'demo' ? 'Demonstration' : 'Working')} inactive={externalPortalLocked} reducedMotion={reducedMotion}>{data && floating && (workflow.kind === 'lookup' ? <LookupWorkflow key={workflow.nonce} data={data} user={user} dataset={dataset} onExit={closeWorkflow} onLockedChange={workflowLock} onExport={lookupExport}/> : ['checkout','return'].includes(workflow.kind) ? <ScanWorkflow key={workflow.nonce} {...workflow} data={data} user={user} dataset={dataset} initialIds={workflow.ids} onExit={closeWorkflow} onChanged={changed} onLockedChange={workflowLock}/> : workflow.kind === 'intake' ? <MobileIntake key={workflow.nonce} data={data} user={user} dataset={dataset} write={write} onChanged={changed} onExit={closeWorkflow} onLockedChange={workflowLock}/> : <MobileRemoval key={workflow.nonce} data={data} user={user} dataset={dataset} write={write} initialIds={workflow.ids} teachingGroup={workflow.teachingGroup} scope={workflow.scope} onExit={closeWorkflow} onChanged={changed} onLockedChange={workflowLock}/>)}</FloatingWorkflow>
    </PhoneArrivalsProvider>
  </PhoneUIProvider>;
}

function ArrivalNavigationIndicator({ active }) {
  const { arrivals } = usePhoneArrivals(active);
  return arrivals?.unreadCount > 0 ? <i aria-label={arrivals.unreadCount + ' unread new arrivals'}/> : null;
}

function ArrivalInventoryView({ active, ...props }) {
  const { arrivals, acknowledge, pending, error } = usePhoneArrivals(active);
  return <InventoryScreen {...props} active={active} arrivals={arrivals} onViewNewArrivals={acknowledge} arrivalsPending={pending} arrivalsError={error}/>;
}

function RouteView({ route,active,backdropVisible,shell }) {
  const { area,page,pageContext,scope,detail } = route;
  const { data,user,dataset,revision,workflow,ready,overlayOpen,operationLocked,unreadCount,open,goBack,push,personal,openDetail,startOperation,rootStartOperation,rootGroup,selectDataset,edit,setExportDraft,setImportKind,setGroupMaintenance,setTeaching,setLocations,setFullRecord,changed,write,acceptUnreadCount,lockHandler,onFieldTest,onExportRecovery,preferences,motionPreference,systemReduced,origin,preference,changeMotion,signout,rootLookup,rootRegister,openAppSettings } = shell;
  if (detail) {
    const battery = data.batteries.find(item => item.id === detail.id); let boundaryError = '';
    try { verifyDetailBoundary(detail,data,user.id); } catch (failure) { boundaryError = failure.message; }
    return battery ? <BatteryPage battery={battery} data={data} active={active} iosPresentation={shell.iosPresentation} readOnly={route.readOnly === true} revision={revision} boundaryError={boundaryError} onBack={goBack} onFullRecord={() => { if (!boundaryError && !route.readOnly) setFullRecord(true); }} onExport={shell.detailExport} onOperation={(kind,ids) => { if (!boundaryError && !route.readOnly) startOperation(kind,ids,detail.group || detail.scope); }}/> : <div className="phone-alert">This asset is no longer in the current register.<Pressable className="phone-secondary" onClick={goBack}>Return</Pressable></div>;
  }
  if (!page) {
    if (area === 'scan') return <MemoScanHome iosPresentation={shell.iosPresentation} data={data} user={user} dataset={dataset} active={active} onOperation={rootStartOperation} onLookup={rootLookup} entryPending={active ? shell.entryPending : null} onCancelOpening={shell.cancelOpening} onRetryOpening={shell.retryOpening}/>;
    if (area === 'inventory') return <div className="phone-inventory-host"><MemoArrivalInventoryView searchRequest={pageContext.searchRequest} areaMemoryKey={pageContext.sharedSearch ? route.key : undefined} data={data} user={user} dataset={dataset} scope={scope} active={active} onDetail={openDetail} onOperation={rootStartOperation} onExport={setExportDraft} onEdit={edit} onGroup={rootGroup} onRegister={rootRegister}/></div>;
    if (area === 'workspace') return <MemoWorkspaceScreen data={data} user={user} dataset={dataset} active={active} onOpen={open}/>;
    return <MemoMeScreen data={data} user={user} dataset={dataset} unreadCount={unreadCount} active={active} onOpen={open} onPersonal={personal} onDetail={openDetail} onAppSettings={openAppSettings} onSignOut={signout}/>;
  }
  if (page === 'assets') return <section className="phone-lifecycle"><div className="phone-destination-list">{[['intake','New battery intake','Prepare common details, then acquire and review'],['retire','Retire or remove','Review eligible batteries in store']].map(([kind,title,text]) => <Pressable className="phone-destination" key={kind} onClick={() => startOperation(kind)}><span><strong>{title}</strong><small>{text}</small></span><ChevronRight size={20}/></Pressable>)}<Pressable className="phone-destination" onClick={() => push(area,{ page:'removal-history' })}><span><strong>Removal history</strong><small>Records, restoration and authorized deletion</small></span><ChevronRight size={20}/></Pressable></div></section>;
  if (page === 'intake-choice') return <section className="phone-lifecycle"><p className="phone-muted">Working inventory uses reviewed manual registration. Demonstration intake supports batch acquisition; native business acceptance remains pending.</p><Pressable className="phone-destination" onClick={() => startOperation('manual_registration')}><span><strong>Register working battery</strong><small>Responsibility, storage and known specifications</small></span><ChevronRight size={20}/></Pressable><Pressable className="phone-secondary" onClick={() => selectDataset('demo',{lifecycle:true})}>Use Demonstration intake</Pressable></section>;
  if (page === 'removal-history') return <section className="phone-compat-page"><RemovalHistory data={data} write={write} onChanged={changed} onBusyChange={lockHandler(route.key)} paused={!active || overlayOpen} onDetail={openDetail} onDownload={ids => setExportDraft({ filter:{ ...defaultInventoryFilter(),lifecycle:'all' },page:0,pageSize:'25',matching:ids.length,pageCount:1,selectedIds:ids,selectedOnly:true })}/></section>;
  if (page === 'service') return <section className="phone-settings"><section className="phone-settings-group"><h2>Motion & feedback</h2><label className="phone-setting"><span>Reduce motion<small>{systemReduced ? 'System setting is already on' : 'Stop decorative motion and page travel'}</small></span><input type="checkbox" checked={motionPreference === 'reduce'} onChange={event => changeMotion(event.target.checked)}/></label><label className="phone-setting"><span>Short scan haptics</span><input type="checkbox" checked={preferences.haptics} onChange={event => preference('haptics',event.target.checked)}/></label><label className="phone-setting"><span>Scan sounds</span><input type="checkbox" checked={preferences.sounds} onChange={event => preference('sounds',event.target.checked)}/></label></section><section className="phone-settings-group"><h2>Device tools</h2><Pressable className="phone-destination" onClick={onExportRecovery}><span><strong>Export device recovery</strong></span><ChevronRight size={20}/></Pressable><Pressable className="phone-destination" disabled={accountHasDeviceWork(businessStorage(),user.id)} onClick={onFieldTest}><Radio size={20}/><span><strong>NFC field test</strong></span><ChevronRight size={20}/></Pressable><Pressable className="phone-destination" onClick={() => push(area,{ page:'diagnostics' })}><span><strong>NFC evidence</strong></span><ChevronRight size={20}/></Pressable><Pressable className="phone-destination" onClick={() => setLocations(true)}><span><strong>Location tools</strong><small>Demonstration evidence only</small></span><ChevronRight size={20}/></Pressable></section><details className="phone-connection-details"><summary>Build & connection</summary><p>Mobile test {MOBILE_BUILD}</p><p>{native ? origin : 'Same-origin isolated preview service'}</p><p>{user.displayName} · {user.username} · {user.role}</p></details></section>;
  if (page === 'diagnostics') return <section className="phone-compat-page"><div className="phone-destination-list"><Pressable className="phone-destination" onClick={onExportRecovery}><span><strong>Export device recovery</strong><small>Keep captured requests and device evidence</small></span><ChevronRight size={20}/></Pressable><Pressable className="phone-destination" disabled={accountHasDeviceWork(businessStorage(),user.id)} onClick={onFieldTest}><Radio size={20}/><span><strong>NFC field test</strong><small>Device evidence only</small></span><ChevronRight size={20}/></Pressable></div><NfcDiagnostics/></section>;
  if (page === 'inspection-recovery') return <MissingInspectionRecovery active={active} data={data} batteryId={pageContext.batteryId} write={write} onExportRecovery={onExportRecovery} onLockedChange={lockHandler(route.key)} onExit={shell.exitInspectionRecovery}/ >;
  const taskDetail = ['task-plans','messages'].includes(page) ? (id,context) => openDetail(id,context,{ taskReview:true,sourceRoute:route.key }) : openDetail;
  return <WorkspacePage view={page} active={active} backdropVisible={backdropVisible} data={data} user={user} dataset={dataset} onBack={goBack} returnBlocked={operationLocked} onChanged={changed} onDetail={taskDetail} onOperation={startOperation} onLockedChange={lockHandler(route.key)} onEdit={edit} onImport={setImportKind} onExport={setExportDraft} write={write} ready={ready && active && !overlayOpen && !workflow} revision={revision} onUnreadCount={acceptUnreadCount} onOpen={open} onGroupView={(group,select) => shell.openGroupView(group,select,route.key)} overlayOpen={overlayOpen || !!workflow} initialGroupId={pageContext.activeGroupId} initialMessageId={pageContext.messageId} initialTaskId={pageContext.taskId} initialTaskContext={pageContext.taskContext} initialTools={pageContext.initialTools} activityGroupId={pageContext.groupId} onTeachingReturn={run => setTeaching({ kind:'return',run,personalScope:'all' })} onTeachingContinue={(run,group,ids) => setTeaching({ kind:'continue',run,group,ids,personalScope:'all' })} onTeachingExchange={(run,item) => setTeaching({ kind:'exchange',run,item,personalScope:'all' })} onGroupMaintenance={(ids,group) => setGroupMaintenance({ ids,group })} onGroupRemoval={(ids,reference) => startOperation('retire',ids,reference)} onGroupActivity={reference => push('workspace',{ page:'activity',pageContext:{ groupId:reference.id } })}/>;
}
