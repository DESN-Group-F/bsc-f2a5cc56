import { PhoneChoice } from '../../app/phone-choice.jsx';
import { Pressable } from '../../app/phone-ui.jsx';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Inbox, MailOpen, RotateCcw, Trash2 } from 'lucide-react';
import { useTaskEndpoint } from '../../shared/hooks/use-task-endpoint.js';
import { taskRequest } from '../../shared/lib/client/task-api.js';
import { captureTaskRecordAction, readTaskRecordAction, saveTaskRecordAction, taskRecordActionFinallyRejected, taskRecordActionStorageKey } from '../../shared/lib/client/task-record-action.js';
import { formatDateOnly, formatTime } from '../../shared/lib/client-utils.js';
import { currentSydneyDate } from '../../shared/lib/battery-age.js';
import { MobileTaskCycleDialog, taskCompletionRecovery } from './mobile-task-cycle.jsx';
import { TaskDownloadDialog } from '../../shared/components/inventory/tasks/task-download-dialog.js';
import { PhoneBusinessSurface } from './phone-business-surface.jsx';
import { TaskDeliveryNotice, TaskGenerationWarnings } from '../../shared/components/inventory/tasks/task-notices.js';
import { useWorkflowLock } from '../../business/workflow-boundary.jsx';
import { acknowledgeMessageAction, verifyMessageRead } from './workspace-requests.mjs';
import { PhonePagination, PhoneResourceState, PhoneSearch, PhoneTabs, PhoneTools, usePhoneBack, usePhoneViewState } from './phone-controls.jsx';
import { workspaceStateKey } from './phone-view-state.mjs';
import { messageEntryScope } from './workspace-model.mjs';

export function MobileMessages({ active = true, data, initialTaskContext = null, initialMessageId, initialTaskId, onChanged, onDetail, onUnreadCount, onTools }) {
  const entry = messageEntryScope(initialTaskContext), taskView = initialTaskContext === 'open';
  const viewKey = workspaceStateKey(data.user.id, data.dataset, entry.key);
  const [visibility, setVisibility] = usePhoneViewState(viewKey, 'visibility', initialMessageId || initialTaskId ? 'all' : entry.visibility);
  const [taskStatus, setTaskStatus] = usePhoneViewState(viewKey, 'taskStatus', entry.taskStatus);
  const [readState, setReadState] = usePhoneViewState(viewKey, 'readState', entry.readState);
  const [search, setSearch] = usePhoneViewState(viewKey, 'search', '');
  const [page, setPage] = usePhoneViewState(viewKey, 'page', 0);
  const [opened, setOpened] = usePhoneViewState(viewKey, 'opened', null);
  const [requestSearch, setRequestSearch] = useState(search);
  const [cycle, setCycle] = useState(() => taskCompletionRecovery(data).attempt?.reviewedCycle ?? null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [recovery, setRecovery] = useState(() => readTaskRecordAction('messages', data.user.id, data.dataset));
  const [download, setDownload] = useState(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const initialHandled = useRef('');
  const initialPrepared = useRef('');
  const taskEntryPrepared = useRef(false);
  const readInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const timer = setTimeout(() => setRequestSearch(search), 180); return () => clearTimeout(timer); }, [search]);
  const pendingSearch = search !== requestSearch;
  const parameters = new URLSearchParams({ dataset: data.dataset, visibility, taskStatus, readState, search: requestSearch });
  const url = `/api/messages?${parameters}`;
  const resource = useTaskEndpoint(url, data.user.id, data.events.map(event => event.id).join('|'), !active || !!cycle || busy || !!recovery.input || !!download || downloadBusy);
  const messages = resource.payload?.messages ?? [];
  const blocked = busy || !!recovery.input || !!recovery.error || downloadBusy || !!cycle || pendingSearch;
  useWorkflowLock(active && (busy || !!recovery.input || !!cycle || !!download));
  useEffect(() => { if (Number.isInteger(resource.payload?.unreadCount)) onUnreadCount?.(resource.payload.unreadCount); }, [resource.payload?.unreadCount, onUnreadCount]);
  const selected = messages.find(message => message.id === opened?.id) ?? opened;
  function closeMessage() { setOpened(null); if (visibility === 'all') setVisibility('current'); }
  usePhoneBack(active && !!selected && !blocked && !download, closeMessage);
  async function changed() {
    resource.refresh();
    try { await onChanged?.(); } catch { if (mounted.current) setNotice('The change was saved. Refresh shared inventory if its status has not updated.'); }
  }
  async function markRead(message) {
    if (message.readAt || readInFlight.current || blocked || resource.loading || resource.error) return;
    readInFlight.current = true; setBusy(true); setNotice('');
    try {
      const body = await taskRequest('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset: data.dataset, action: 'read', payload: { id: message.id } }) });
      const readAt = verifyMessageRead(body.result, message.id);
      if (mounted.current) setOpened(previous => previous?.id === message.id ? { ...previous, readAt } : previous);
      await changed();
    } catch (error) { if (mounted.current) setNotice(error.message); }
    finally { readInFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function openMessage(message) {
    if (!active || blocked) return;
    // Retained content can be inspected while refreshing. Marking or changing it
    // still requires the current resource through the guards in those actions.
    setOpened(message); void markRead(message);
  }
  useEffect(() => {
    if (!active || !taskView || taskEntryPrepared.current || initialMessageId || initialTaskId) return;
    taskEntryPrepared.current = true;
    setVisibility('current'); setTaskStatus('open'); setReadState('all'); setSearch(''); setRequestSearch(''); setPage(0); setOpened(null);
  }, [active, taskView, initialMessageId, initialTaskId]);
  useEffect(() => {
    const identity = `${initialMessageId ?? ''}|${initialTaskId ?? ''}`;
    if (!active || !initialMessageId && !initialTaskId || initialPrepared.current === identity) return;
    initialPrepared.current = identity; setVisibility('all'); setTaskStatus('all'); setReadState('all'); setSearch(''); setRequestSearch(''); setPage(0); setOpened(null);
  }, [active, initialMessageId, initialTaskId]);
  useEffect(() => {
    const identity = `${initialMessageId ?? ''}|${initialTaskId ?? ''}`;
    if (!active || initialHandled.current === identity || resource.loading || resource.error || visibility !== 'all' || taskStatus !== 'all' || readState !== 'all' || requestSearch || search || (!initialMessageId && !initialTaskId)) return;
    initialHandled.current = identity;
    const message = messages.find(item => initialMessageId ? item.id === initialMessageId : item.cycle?.id === initialTaskId);
    if (message) openMessage(message);
    else setNotice('This message is no longer available in the current inbox. Review Removed or the full task records.');
  }, [active, resource.loading, resource.error, initialMessageId, initialTaskId, messages, visibility, taskStatus, readState, requestSearch, search]);
  async function changeVisibility(input) {
    if (busy || recovery.error || input.dataset !== data.dataset || (!recovery.input && (resource.loading || resource.error))) return;
    setBusy(true); setNotice('');
    try {
      saveTaskRecordAction('messages', data.user.id, input);
      setRecovery({ input, error: '' });
      await window.__batteryWorkflowStorage.flush?.();
      const body = await taskRequest('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      await acknowledgeMessageAction(window.__batteryWorkflowStorage, data.user.id, input, body.result);
      if (mounted.current) { setRecovery({ input: null, error: '' }); setOpened(null); setNotice(input.action === 'remove' ? 'Message moved to Removed. Its task is unchanged.' : 'Message restored to your inbox.'); }
      await changed();
    } catch (error) {
      if (mounted.current) setNotice(error.message);
      if (taskRecordActionFinallyRejected(error)) {
        try {
          const storage = window.__batteryWorkflowStorage;
          if (storage.transact) await storage.transact(entries => { delete entries[taskRecordActionStorageKey('messages', data.user.id, input.dataset)]; });
          else { storage.removeItem(taskRecordActionStorageKey('messages', data.user.id, input.dataset)); await storage.flush?.(); }
          if (mounted.current) setRecovery({ input: null, error: '' });
          resource.refresh();
        } catch (failure) { if (mounted.current) setRecovery({ input, error: failure.message }); }
      }
    } finally { if (mounted.current) setBusy(false); }
  }
  function clearFilters() { setSearch(''); setTaskStatus('all'); setReadState('all'); setPage(0); }
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(messages.length / 25) - 1));
  return <div className="mobile-phone-records">
    <p className="mobile-phone-purpose">{taskView ? 'Your assigned work. Open a task to review its requirements and record completion.' : 'Your inbox. Reading or removing a message does not complete its task.'}</p>
    <PhoneTools onTools={onTools} onRefresh={resource.refresh} disabled={blocked || !!cycle || !!download} actions={[{ label: 'Download messages', icon: Download, disabled: pendingSearch || resource.loading || !!resource.error || !messages.length, onClick: () => setDownload({ url, filename: `my-messages-report-${data.dataset}`, title: 'Download Messages report', scope: 'Your own matching messages across all pages, with related task evidence.' }) }]}>{!selected && <span className="mobile-phone-caption">{messages.length} messages</span>}</PhoneTools>
    <TaskGenerationWarnings issues={resource.payload?.generationIssues ?? []} />
    {notice && <p className="mobile-phone-notice" role="status">{notice}</p>}
    {selected && <PhoneResourceState loading={resource.loading} retained={!!resource.payload} error={resource.error} onRetry={resource.refresh} />}
    {recovery.error && <div className="mobile-work-load-error" role="alert"><p>{recovery.error}</p><Pressable type="button" onClick={() => setRecovery(readTaskRecordAction('messages', data.user.id, data.dataset))}>Retry recovery</Pressable></div>}
    {recovery.input && <div className="mobile-work-load-error" role="alert"><p>A message {recovery.input.action} request is retained. Resolve its original result before another change.</p><Pressable type="button" disabled={busy || !!recovery.error} onClick={() => changeVisibility(recovery.input)}>Retry original request</Pressable></div>}
    {selected ? <article className="mobile-message-detail"><Pressable type="button" className="mobile-phone-text-button" onClick={closeMessage} disabled={blocked}><ChevronLeft size={18} aria-hidden="true" />Back to messages</Pressable><span className="mobile-phone-kicker">{selected.readAt ? 'Read' : 'Unread'} · {selected.taskStatus === 'completed' ? 'Completed' : selected.cycle.planRemoved ? 'Plan removed' : 'To do'}</span><h2>{selected.title}</h2><p className="mobile-phone-body">{selected.body}</p><p className="mobile-phone-caption">Due {formatDateOnly(selected.dueOn)}</p><details className="mobile-phone-context"><summary>Message dates</summary><dl className="mobile-phone-details"><dt>Created</dt><dd>{formatTime(selected.createdAt)}</dd><dt>Read</dt><dd>{formatTime(selected.readAt)}</dd>{selected.removedAt && <><dt>Removed</dt><dd>{formatTime(selected.removedAt)}</dd></>}</dl></details><p className="mobile-phone-caption">Reading this message does not complete its task.</p><div className="mobile-phone-actions"><Pressable type="button" className="primary" disabled={blocked || resource.loading || !!resource.error} onClick={() => { setCycle(selected.cycle); void markRead(selected); }}>{selected.taskStatus === 'completed' ? 'View completion' : !selected.cycle.planRemoved && selected.cycle.canComplete ? 'Review task completion' : 'View task'}</Pressable>{!selected.readAt && <Pressable type="button" disabled={blocked || resource.loading || !!resource.error} onClick={() => markRead(selected)}><MailOpen size={17} aria-hidden="true" />Mark read</Pressable>}<Pressable type="button" disabled={blocked || resource.loading || !!resource.error} onClick={() => changeVisibility(captureTaskRecordAction(data.dataset, selected.removedAt ? 'restore' : 'remove', selected))}>{selected.removedAt ? <RotateCcw size={17} aria-hidden="true" /> : <Trash2 size={17} aria-hidden="true" />}{selected.removedAt ? 'Restore message' : 'Remove message'}</Pressable></div></article> : <>
      <PhoneTabs value={visibility} onChange={value => { setVisibility(value); setPage(0); }} items={[[ 'current', taskView ? 'Current tasks' : 'Inbox' ], [ 'removed', taskView ? 'Removed messages' : 'Removed' ]]} label="Message location" disabled={blocked} />
      {taskView && <PhoneTabs value={taskStatus} onChange={value => { setTaskStatus(value); setPage(0); }} items={[[ 'open', 'To do' ], [ 'completed', 'Completed' ], [ 'all', 'All tasks' ]]} label="Task state" disabled={blocked} />}
      <PhoneSearch value={search} onChange={value => { setSearch(value); setPage(0); }} label="Search messages" disabled={busy || !!recovery.input || !!recovery.error || !!cycle} onClear={clearFilters} clearDisabled={!search && taskStatus === 'all' && readState === 'all'} />
      <details className="mobile-phone-filters"><summary>{taskView ? 'Message filters' : 'Filter'}{taskStatus !== 'all' || readState !== 'all' ? ' · Applied' : ''}</summary>{!taskView && <PhoneTabs value={taskStatus} onChange={value => { setTaskStatus(value); setPage(0); }} items={[[ 'all', 'All' ], [ 'open', 'To do' ], [ 'completed', 'Completed' ]]} label="Task state" disabled={blocked} />}<div className="mobile-phone-filter-row"><PhoneChoice label="Read state" value={readState} disabled={blocked} onChange={value => { setReadState(value); setPage(0); }} options={[{value:"all",label:"All read states"},{value:"unread",label:"Unread"},{value:"read",label:"Read"}]}/></div>{(taskStatus !== 'all' || readState !== 'all') && <Pressable type="button" className="mobile-phone-text-button" disabled={blocked} onClick={clearFilters}>Clear filters</Pressable>}</details>
      {(taskStatus !== 'all' || readState !== 'all') && <p className="mobile-phone-applied" aria-label="Applied filters">{taskStatus !== 'all' && <Pressable type="button" onClick={() => { setTaskStatus('all'); setPage(0); }} disabled={blocked}>{taskStatus === 'open' ? 'To do' : 'Completed'} ×</Pressable>}{readState !== 'all' && <Pressable type="button" onClick={() => { setReadState('all'); setPage(0); }} disabled={blocked}>{readState === 'unread' ? 'Unread' : 'Read'} ×</Pressable>}</p>}
      <PhoneResourceState loading={resource.loading || pendingSearch} retained={!!resource.payload} error={resource.error} onRetry={resource.refresh} empty={!messages.length} emptyText={visibility === 'removed' ? 'No matching removed messages.' : 'No matching messages.'} />
      {resource.payload && <div className="mobile-phone-list" data-phone-results tabIndex={-1}>{messages.slice(pageIndex * 25, (pageIndex + 1) * 25).map(message => <Pressable type="button" key={message.id} className={`mobile-message-row${message.readAt ? '' : ' unread'}`} onClick={() => openMessage(message)} disabled={blocked}><Inbox size={20} aria-hidden="true" /><span><strong>{message.title}</strong><small>Due {formatDateOnly(message.dueOn)}{message.taskStatus !== 'completed' && message.dueOn < currentSydneyDate() ? ' · Overdue' : ''}</small><em>{message.taskStatus === 'completed' ? 'Completed' : message.cycle.planRemoved ? 'Plan removed' : 'To do'} · {message.readAt ? 'Read' : 'Unread'}</em></span><ChevronRight size={18} aria-hidden="true" /></Pressable>)}</div>}
      <PhonePagination page={page} count={messages.length} onPage={setPage} />
    </>}
    <details className="mobile-phone-context"><summary>Scheduling information</summary><TaskDeliveryNotice /></details>
    {cycle && <MobileTaskCycleDialog active={active} cycle={cycle} data={data} onDetail={onDetail} onClose={() => setCycle(null)} onSaved={async () => { setCycle(null); await changed(); }} />}
    {active && download && <PhoneBusinessSurface task="export"><TaskDownloadDialog request={download} onClose={() => setDownload(null)} onBusyChange={setDownloadBusy} /></PhoneBusinessSurface>}
  </div>;
}
