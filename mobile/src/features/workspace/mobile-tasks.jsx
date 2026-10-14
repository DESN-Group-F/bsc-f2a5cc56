import { Pressable } from '../../app/phone-ui.jsx';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronRight, Download, Plus, Pencil, Trash2, RotateCcw } from 'lucide-react';
import { useTaskEndpoint } from '../../shared/hooks/use-task-endpoint.js';
import { formatDateOnly, formatTime } from '../../shared/lib/client-utils.js';
import { createCustomTaskPlan, taskPlanMatchesQuery, taskTemplates } from '../../shared/lib/task-schedule.js';
import { getRolePermissions } from '../../shared/lib/permissions.js';
import { readTaskRecordAction, saveTaskRecordAction, verifyTaskRecordActionReceipt, acknowledgeTaskRecordAction, taskRecordActionFinallyRejected } from '../../shared/lib/client/task-record-action.js';
import { MobileTaskCycleDialog, taskCompletionRecovery } from './mobile-task-cycle.jsx';
import { TaskPlanDetails } from '../../shared/components/inventory/tasks/task-plan-details.js';
import { TaskDownloadDialog } from '../../shared/components/inventory/tasks/task-download-dialog.js';
import { TaskDeliveryNotice, TaskGenerationWarnings } from '../../shared/components/inventory/tasks/task-notices.js';
import { assignmentNames, cycleState, targetSummary, taskCategoryLabels } from '../../shared/components/inventory/tasks/task-presentation.js';
import { useWorkflowLock } from '../../business/workflow-boundary.jsx';
import { PhonePagination, PhoneResourceState, PhoneSearch, PhoneTabs, PhoneTools, usePhoneViewState } from './phone-controls.jsx';
import { workspaceStateKey } from './phone-view-state.mjs';
import { recoverTaskCreate, taskCreateStorageKey } from '../../shared/lib/task-create-session.js';
import { taskRequest } from '../../shared/lib/client/task-api.js';
import { businessStorage } from '../../platform/runtime.mjs';
import { TaskPlanEditor } from '../../shared/components/inventory/tasks/task-plan-editor.js';
import { TaskPlanRemovalDialog } from '../../shared/components/inventory/tasks/task-plan-removal-dialog.js';
import { PhoneBusinessSurface } from './phone-business-surface.jsx';
import { PhoneTaskDialog } from './phone-task-dialog.jsx';

export function MobileTasks({ active = true, data, initialTaskId, onChanged, onDetail, onTools }) {
  const viewKey = workspaceStateKey(data.user.id, data.dataset, 'tasks');
  const [visibility, setVisibility] = usePhoneViewState(viewKey, 'visibility', 'current');
  const [search, setSearch] = usePhoneViewState(viewKey, 'search', '');
  const [page, setPage] = usePhoneViewState(viewKey, 'page', 0);
  const [plan, setPlan] = useState(null);
  const [completionRecovery] = useState(() => taskCompletionRecovery(data));
  const [cycle, setCycle] = useState(completionRecovery.attempt?.reviewedCycle ?? null);
  const [expanded, setExpanded] = usePhoneViewState(viewKey, 'expanded', []);
  const [download, setDownload] = useState(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [recovery, setRecovery] = useState(() => readTaskRecordAction('plans', data.user.id, data.dataset));
  const [creationRecovery] = useState(() => {
    try { const raw = businessStorage().getItem(taskCreateStorageKey(data.user.id, data.dataset)), attempt = recoverTaskCreate(raw, data.user.id, data.dataset); return { attempt, error: raw !== null && !attempt ? 'Saved task creation could not be recovered. Preserve it before creating another plan.' : '' }; }
    catch { return { attempt: null, error: 'Device storage is unavailable. New task creation is blocked.' }; }
  });
  const [draft, setDraft] = useState(creationRecovery.attempt?.input.payload ?? null);
  const [choosingTemplate, setChoosingTemplate] = useState(false), [removal, setRemoval] = useState(null), [recoveringAction, setRecoveringAction] = useState(false);
  const initialHandled = useRef('');
  const actionRunning = useRef(false);
  const resource = useTaskEndpoint(`/api/task-plans?${new URLSearchParams({ dataset: data.dataset, visibility })}`, data.user.id, data.events.map(event => event.id).join('|'), !active || !!plan || !!cycle || !!download || downloadBusy || !!draft || !!removal || choosingTemplate || recoveringAction);
  const plans = (resource.payload?.plans ?? []).filter(item => taskPlanMatchesQuery(item, search));
  const cycles = resource.payload?.cycles ?? [];
  const recoveryBlocked = !!recovery.input || !!recovery.error || !!completionRecovery.error || !!creationRecovery.error || recoveringAction;
  const blocked = recoveryBlocked || resource.loading || !!resource.error;
  useWorkflowLock(active && (!!plan || !!cycle || !!download || !!draft || !!removal || choosingTemplate || recoveringAction));
  const administrator = getRolePermissions(data.user.role).manageTaskPlans;
  useEffect(() => {
    if (!active || initialHandled.current === initialTaskId || !initialTaskId || resource.loading || resource.error || completionRecovery.attempt) return;
    initialHandled.current = initialTaskId;
    const item = cycles.find(entry => entry.id === initialTaskId);
    const savedPlan = (resource.payload?.plans ?? []).find(entry => entry.id === initialTaskId);
    if (item) setCycle(item);
    else if (savedPlan) setPlan(savedPlan);
    else setNotice('This task is unavailable in the current records. Review Removed or refresh the task records.');
  }, [active, initialTaskId, resource.loading, resource.error, resource.payload]);
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(plans.length / 25) - 1));
  async function changed() { resource.refresh(); try { await onChanged?.(); } catch { setNotice('The task change was saved. Refresh the inventory if its status has not updated.'); } }
  async function retrySavedPlanAction() {
    const input = recovery.input; if (!input || recovery.error || recoveringAction || actionRunning.current) return;
    actionRunning.current = true;
    setRecoveringAction(true); setNotice('');
    try {
      saveTaskRecordAction('plans', data.user.id, input);
      await businessStorage().flush?.();
      const response = await taskRequest('/api/task-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      verifyTaskRecordActionReceipt(response.result, input, data.user.id);
      await acknowledgeTaskRecordAction('plans', data.user.id, input);
      setRecovery({ input: null, error: '' }); setNotice('The original plan change was confirmed.'); await changed();
    } catch (error) {
      setNotice(error.message);
      if (taskRecordActionFinallyRejected(error)) {
        try { await acknowledgeTaskRecordAction('plans', data.user.id, input); setRecovery({ input: null, error: '' }); resource.refresh(); }
        catch (failure) { setRecovery({ input, error: failure.message }); }
      }
    } finally { actionRunning.current = false; setRecoveringAction(false); }
  }
  function create(template) {
    if (!administrator || blocked || draft) return;
    const source = template ? template.plan : createCustomTaskPlan();
    setChoosingTemplate(false); setDraft({ ...source, batteryIds: [...source.batteryIds], assigneeIds: source.category === 'storage_maintenance' ? [] : [data.user.id], channels: [...source.channels], scheduledDates: [...source.scheduledDates] });
  }
  return <div className="mobile-phone-records">
    <p className="mobile-phone-purpose">Shared plans, deadlines and recorded completions. {administrator ? 'Create or edit a plan; assigned work is completed separately.' : 'Open a current task to review work assigned to you.'}</p>
    {administrator && <div className="mobile-phone-actions mobile-main-actions"><Pressable type="button" className="primary" disabled={blocked || !!draft || !!removal} onClick={() => setChoosingTemplate(true)}><Plus size={18} aria-hidden="true" />Create task plan</Pressable></div>}
    <PhoneTools onTools={onTools} onRefresh={resource.refresh} label="Task tools" disabled={!!plan || !!cycle || !!download} actions={[{ label: 'Download task report', icon: Download, disabled: resource.loading || !!resource.error || !plans.length, onClick: () => setDownload({ url: `/api/task-plans?${new URLSearchParams({ dataset: data.dataset, visibility, search })}`, filename: `periodic-task-report-${data.dataset}`, title: 'Download task report', scope: 'Every matching plan and all recorded cycles, across all pages.' }) }]}><span className="mobile-phone-caption">{plans.length} plans</span></PhoneTools>
    <TaskGenerationWarnings issues={resource.payload?.generationIssues ?? []} />
    {notice && <p className="mobile-phone-notice" role="status">{notice}</p>}
    {recoveryBlocked && <div className="mobile-work-load-error" role="alert"><p>{completionRecovery.error || recovery.error || creationRecovery.error || 'A saved plan removal or restoration needs its original result resolved.'}</p>{recovery.input && <Pressable type="button" disabled={recoveringAction || !!recovery.error} onClick={retrySavedPlanAction}>{recoveringAction ? 'Checking original request…' : 'Check original plan request'}</Pressable>}{recovery.error && <Pressable type="button" onClick={() => setRecovery(readTaskRecordAction('plans', data.user.id, data.dataset))}>Retry saved request recovery</Pressable>}</div>}
    <PhoneTabs value={visibility} onChange={value => { setVisibility(value); setPage(0); }} items={[[ 'current', 'Current' ], [ 'removed', 'Removed' ]]} label="Plan location" disabled={!!plan || !!cycle || !!download} />
    <PhoneSearch value={search} onChange={value => { setSearch(value); setPage(0); }} label="Search task, category or status" onClear={() => { setSearch(''); setPage(0); }} />
    <PhoneResourceState loading={resource.loading} error={resource.error} retained={!!resource.payload} onRetry={resource.refresh} empty={!plans.length} emptyText="No matching recurring task plans." />
    {resource.payload && <div className="mobile-task-list" data-phone-results tabIndex={-1}>{plans.slice(pageIndex * 25, (pageIndex + 1) * 25).map(item => {
      const recorded = cycles.filter(entry => entry.planId === item.id);
      const open = recorded.find(entry => entry.status === 'open');
      const due = open?.dueOn ?? item.preview.nextDueOn;
      const state = item.removedAt ? 'Removed' : item.state === 'active' ? 'Active' : item.state === 'paused' ? 'Paused' : 'Draft';
      return <article key={item.id} className="mobile-task-card"><Pressable type="button" className="mobile-task-main" onClick={() => setPlan(item)}><span className="mobile-task-date"><CalendarDays size={19} aria-hidden="true" />{due ? formatDateOnly(due) : 'Due not configured'}</span><span><strong>{item.title}</strong><small>{taskCategoryLabels[item.category]} · {targetSummary(item, data)}</small><em>{state}{open ? ` · ${cycleState(open)}` : ''}</em></span><ChevronRight size={18} aria-hidden="true" /></Pressable><p className="mobile-phone-caption">Assigned: {assignmentNames(item.assigneeIds, data)}</p><div className="mobile-phone-actions">{open && <Pressable type="button" className={open.canComplete && !open.planRemoved ? 'primary' : ''} disabled={blocked} onClick={() => setCycle(open)}>{open.canComplete && !open.planRemoved ? 'Review completion' : 'View current task'}</Pressable>}{administrator && <><Pressable type="button" disabled={blocked || !!item.removedAt} onClick={() => { if (!item.removedAt) setDraft(item); }}><Pencil size={17} aria-hidden="true" />Edit plan</Pressable><Pressable type="button" disabled={blocked} onClick={() => setRemoval(item)}>{item.removedAt ? <RotateCcw size={17} aria-hidden="true" /> : <Trash2 size={17} aria-hidden="true" />}{item.removedAt ? 'Restore plan' : 'Remove plan'}</Pressable></>}<Pressable type="button" onClick={() => setExpanded(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])}>{expanded.includes(item.id) ? 'Hide cycles' : `Recorded cycles (${recorded.length})`}</Pressable></div>{expanded.includes(item.id) && <div className="mobile-task-cycles">{recorded.length ? recorded.map(entry => <Pressable type="button" key={entry.id} disabled={blocked} onClick={() => setCycle(entry)}><span><strong>{formatDateOnly(entry.dueOn)}</strong><small>{entry.status === 'completed' ? `Completed ${formatTime(entry.completedAt)} · ${entry.completedByName}` : entry.planRemoved ? 'Plan removed' : cycleState(entry)}</small></span><ChevronRight size={17} aria-hidden="true" /></Pressable>) : <p className="mobile-phone-caption">No recorded cycles.</p>}</div>}</article>;
    })}</div>}
    <PhonePagination page={page} count={plans.length} onPage={setPage} />
    <details className="mobile-phone-context"><summary>Scheduling information</summary><TaskDeliveryNotice /></details>
    {plan && <PhoneBusinessSurface task="plan-details" active={active}><TaskPlanDetails active={active} plan={plan} data={data} onClose={() => setPlan(null)} onDetail={onDetail} /></PhoneBusinessSurface>}
    {cycle && <MobileTaskCycleDialog active={active} cycle={cycle} data={data} onDetail={onDetail} onClose={() => setCycle(null)} onSaved={async () => { setCycle(null); await changed(); }} />}
    {active && download && <PhoneBusinessSurface task="export"><TaskDownloadDialog request={download} onClose={() => setDownload(null)} onBusyChange={setDownloadBusy} /></PhoneBusinessSurface>}
    {active && choosingTemplate && <PhoneTaskDialog title="Create a task plan" description="Choose a starting point. Review instructions, assignments and dates before saving." onClose={() => setChoosingTemplate(false)}><div className="mobile-template-list"><Pressable type="button" className="mobile-template-choice" onClick={() => create(null)}><Plus size={22} aria-hidden="true" /><span><strong>Start from scratch</strong><small>Define any supported work and target</small></span><ChevronRight size={19} aria-hidden="true" /></Pressable>{taskTemplates.map(template => <Pressable key={template.id} type="button" className="mobile-template-choice" onClick={() => create(template)}><CalendarDays size={22} aria-hidden="true" /><span><strong>{template.label}</strong><small>{template.description}</small><small>{template.basis}</small></span><ChevronRight size={19} aria-hidden="true" /></Pressable>)}</div></PhoneTaskDialog>}
    {active && draft && <PhoneBusinessSurface task="plan-editor"><TaskPlanEditor phonePresentation key={draft.id || `new-${draft.category}`} original={draft} data={data} cycles={cycles} onClose={() => setDraft(null)} onSaved={async () => { setDraft(null); await changed(); }} /></PhoneBusinessSurface>}
    {active && removal && <PhoneBusinessSurface task="plan-removal"><TaskPlanRemovalDialog original={removal} data={data} onClose={() => setRemoval(null)} onSaved={async () => { setRemoval(null); await changed(); }} /></PhoneBusinessSurface>}
  </div>;
}
