import { Pressable, usePhoneContext } from '../../app/phone-ui.jsx';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, ChevronRight, ClipboardList, History, Inbox, PackagePlus, Settings2, ShieldCheck, UserRound, Battery, LogOut } from 'lucide-react';
import { useTaskEndpoint } from '../../shared/hooks/use-task-endpoint.js';
import { currentSydneyDate } from '../../shared/lib/battery-age.js';
import { formatDateOnly } from '../../shared/lib/client-utils.js';
import { downloadTeachingCheckoutReport } from '../../shared/lib/client/teaching-checkout-download.js';
import { TeachingGroupsPanel } from '../../shared/components/inventory/teaching-groups-panel.js';
import { InkOrb } from '../scan/ink-orb.jsx';
import { MobileMessages } from './mobile-messages.jsx';
import { MobileTasks } from './mobile-tasks.jsx';
import { MobileActivity } from './mobile-activity.jsx';
import { MobileDirectories, MobileTeachingGroups } from './mobile-directories.jsx';
import { MobileTeachingGroupDetail } from './mobile-teaching-group.jsx';
import { MobileAccounts, MobileMyAccount } from './mobile-account.jsx';
import { PhoneResourceState, usePhoneBack, usePhoneViewState } from './phone-controls.jsx';
import { workspaceStateKey } from './phone-view-state.mjs';
import { InventoryScreen } from '../inventory/inventory.jsx';
import { PhoneBusinessSurface } from './phone-business-surface.jsx';
import { actionableMessages, canOpenWorkspaceView, ownMessagesUrl, ownTeachingGroups, personalBatterySummary, teachingGroupSummary, workspaceEntries, workspaceView } from './workspace-model.mjs';
import './workspace.css';

const icons = { groups: BookOpen, tasks: CalendarDays, assets: PackagePlus, activity: History, records: ClipboardList, accounts: ShieldCheck };
const pageTitles = { 'teaching-groups': 'Teaching groups', 'task-plans': 'Recurring tasks', activity: 'Activity history', 'my-activity': 'My activity', messages: 'Messages', account: 'Profile', 'battery-records': 'Battery records', directories: 'Directories', accounts: 'Staff accounts' };

function WorkEntry({ icon: Icon, title, description, trailing, accent = 'blue', onClick }) {
  return <Pressable type="button" className="mobile-work-entry" onClick={onClick}>
    <span className={`mobile-work-icon mobile-work-icon-${accent}`}><Icon size={21} aria-hidden="true" /></span>
    <span className="mobile-work-entry-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
    {trailing !== undefined && <span className="mobile-work-count" aria-label={`${trailing} unread messages`}>{trailing}</span>}
    <ChevronRight size={18} aria-hidden="true" />
  </Pressable>;
}

function TodoPreview({ data, user, dataset, onOpen, active = true }) {
  const source = (data?.events ?? []).map(event => event.id).join('|');
  const resource = useTaskEndpoint(ownMessagesUrl(dataset), user.id, source, !active);
  const retained = Array.isArray(resource.payload?.messages);
  const items = actionableMessages(resource.payload?.messages);
  const today = currentSydneyDate();
  return <section className="mobile-me-todo" aria-labelledby="mobile-todo-heading">
    <div className="mobile-work-section-heading"><h2 id="mobile-todo-heading">My tasks</h2><Pressable type="button" onClick={() => onOpen('messages', { taskContext: 'open' })}>View all tasks <ArrowRight size={16} aria-hidden="true" /></Pressable></div>
    <PhoneResourceState loading={resource.loading} retained={retained} error={resource.error} onRetry={resource.refresh} empty={retained&&!items.length} emptyText="No tasks to complete." />{items.length ? <div className="mobile-todo-list">{items.map(message => <Pressable type="button" key={message.id} className="mobile-todo-item" onClick={() => onOpen('messages', { taskContext: 'open', messageId: message.id, taskId: message.cycle.id })} aria-label={`${message.title}. Due ${formatDateOnly(message.dueOn)}. Open this message and its task.`}>
      <span className={`mobile-todo-date${message.dueOn && message.dueOn < today ? ' overdue' : ''}`}><CalendarDays size={17} aria-hidden="true" />{message.dueOn ? formatDateOnly(message.dueOn) : 'Due date not recorded'}</span>
      <strong>{message.title}</strong><span className="mobile-todo-state">{message.dueOn && message.dueOn < today ? 'Open · overdue' : 'Open'}<ChevronRight size={17} aria-hidden="true" /></span>
    </Pressable>)}</div> : null}
  </section>;
}

export function MeScreen({ data, user, dataset, unreadCount, onOpen, onPersonal, onDetail, onAppSettings, onSignOut, active = true }) {
  const summary = personalBatterySummary(data, user.id);
  const loans = (data?.batteries || []).filter(battery => battery.loanId && battery.borrowerAccountId === user.id);
  const role = user.role === 'admin' ? 'Administrator' : 'Staff';
  return <section className="mobile-work-home mobile-me-home" aria-label="My work">
    <header className="mobile-me-header" data-ink-gaze-scope>
      <div className="mobile-me-avatar" aria-hidden="true"><InkOrb compact color="blue" active={active} /></div>
      <div><h1>{user.displayName || user.username}</h1><p>{role} · {user.username}</p></div>
      <Pressable type="button" className="mobile-work-icon-button" onClick={() => onOpen('account')} aria-label="Edit my profile"><Settings2 size={22} aria-hidden="true" /></Pressable>
    </header>
    <div className="mobile-me-summaries" aria-label="Personal battery views">
      <Pressable type="button" className="mobile-me-summary mobile-me-summary-use" onClick={() => onPersonal('holder')}><LogOut size={20} aria-hidden="true" /><span className="mobile-me-summary-number">{data ? summary.borrowed : '—'}</span><strong>Checked out to me</strong><small>Active loans to your account</small><ChevronRight size={18} aria-hidden="true" /></Pressable>
      <Pressable type="button" className="mobile-me-summary" onClick={() => onPersonal('owner')}><Battery size={20} aria-hidden="true" /><span className="mobile-me-summary-number">{data ? summary.responsible : '—'}</span><strong>Under my responsibility</strong><small>Active records assigned to you</small><ChevronRight size={18} aria-hidden="true" /></Pressable>
    </div>
    <TodoPreview data={data} user={user} dataset={dataset} onOpen={onOpen} active={active} />
    {!!loans.length && <details className="mobile-me-loans"><summary>Current loans · {summary.borrowed}</summary><div className="mobile-me-loan-list">{loans.slice(0,3).map(battery => <Pressable type="button" key={battery.id} onClick={() => onDetail ? onDetail(battery.id, { kind: 'holder', id: user.id, label: 'Checked out to me' }) : onPersonal('holder')}><span className="mobile-loan-symbol" aria-hidden="true"><Battery size={21}/></span><span><strong>{battery.name}</strong><small>{battery.id}</small></span><ChevronRight size={18}/></Pressable>)}</div>{summary.borrowed > 3 && <Pressable type="button" className="mobile-phone-text-button" onClick={() => onPersonal('holder')}>View all {summary.borrowed} loans<ArrowRight size={16}/></Pressable>}</details>}
    <section className="mobile-work-entry-list" aria-label="Personal records and account">
      <WorkEntry icon={Inbox} title="Messages" description="Your inbox; reading does not complete a task" trailing={Number.isInteger(unreadCount) ? unreadCount : undefined} onClick={() => onOpen('messages')} accent="violet" />
      <WorkEntry icon={History} title="My activity" description="Your recorded operations and evidence" onClick={() => onOpen('my-activity')} accent="green" />
      <WorkEntry icon={UserRound} title="Profile" description="Account identity, password and default inventory" onClick={() => onOpen('account')} />
      <WorkEntry icon={Settings2} title="App settings" description="Motion, scan feedback and device tools" onClick={onAppSettings || (() => onOpen('service'))} />
    </section>
    {onSignOut && <Pressable type="button" className="mobile-phone-signout" onClick={onSignOut}><LogOut size={19} aria-hidden="true" />Sign out</Pressable>}
  </section>;
}

export function WorkspaceScreen({ data, user, dataset, onOpen }) {
  const phoneContext = usePhoneContext();
  const entries = workspaceEntries(user.role);
  const groups = ownTeachingGroups(data, user.id);
  const sections = [...new Set(entries.map(entry => entry.group))];
  return <section className="mobile-work-home" aria-label="Workspace">
    {!phoneContext && <header className="mobile-work-home-heading"><h1>Workspace</h1></header>}
    {sections.map(section => <section className={`mobile-work-section ${section === 'Daily work' ? 'mobile-work-daily' : section === 'Battery lifecycle' ? 'mobile-work-lifecycle' : ''}`} key={section} aria-label={section}><h2>{section}</h2><div className="mobile-work-entry-list">{entries.filter(entry => entry.group === section).map(entry => <WorkEntry key={entry.view} icon={icons[entry.icon]} title={entry.title} description={entry.description} accent={entry.accent} onClick={() => onOpen(entry.view)} />)}</div>{section === 'Daily work' && groups.length > 0 && <div className="mobile-work-group-preview" aria-label="Your teaching group summaries">{groups.slice(0, 3).map(group => {
      const summary = teachingGroupSummary(group, data?.batteries);
      return <Pressable type="button" key={group.id} onClick={() => onOpen('teaching-groups', { activeGroupId: group.id })}><BookOpen size={17} aria-hidden="true" /><span><strong>{group.name}</strong><small>{summary.members} saved members · {summary.inStore} in store · {summary.inUse} in use{summary.retired ? ` · ${summary.retired} retired` : ''}</small></span><ChevronRight size={17} aria-hidden="true" /></Pressable>;
    })}</div>}</section>)}
  </section>;
}

export function WorkspacePage({ view, data, user, dataset, onBack, onChanged, onDetail, onOperation, onLockedChange, onEdit, onImport, onExport, onOpen, onGroupView, ready = true, revision = 0, overlayOpen = false, returnBlocked = false, active = true, backdropVisible = false, onUnreadCount, onTeachingReturn, onTeachingContinue, onTeachingExchange, onGroupMaintenance, onGroupRemoval, onGroupActivity, initialGroupId = null, initialMessageId = null, initialTaskId = null, initialTaskContext = null, initialTools = false, activityGroupId = null, onActivityGroupChange }) {
  const phoneContext = usePhoneContext();
  const target = workspaceView(view), memoryKey = workspaceStateKey(user.id, dataset, target);
  const [activeGroupId, setActiveGroupId] = usePhoneViewState(memoryKey, 'activeGroupId', initialGroupId);
  const [groupDefinition, setGroupDefinition] = useState(false), [groupMembers, setGroupMembers] = useState(null);
  useEffect(() => { if (initialGroupId) setActiveGroupId(initialGroupId); }, [initialGroupId, setActiveGroupId]);
  useEffect(() => { if (initialTools && target === 'teaching-groups') setGroupDefinition(true); }, [initialTools, target]);
  const permissionsAllowed = canOpenWorkspaceView(target, user.role), changed = onChanged ?? (() => Promise.resolve());
  const activeGroup = target === 'teaching-groups' ? ownTeachingGroups(data, user.id).find(group => group.id === activeGroupId) : null;
  const childBack = () => { if (groupDefinition) setGroupDefinition(false); else if (target === 'teaching-groups' && activeGroupId) setActiveGroupId(null); else onBack(); };
  usePhoneBack(active && !overlayOpen && !returnBlocked && target === 'teaching-groups' && !!activeGroupId && !groupDefinition, childBack, 200);
  let content;
  if (!permissionsAllowed) content = <div className="mobile-work-load-error" role="alert"><h2>Access unavailable</h2><p>This account cannot open this workspace. Return to an available destination.</p></div>;
  else if (!data) content = <p className="mobile-work-empty" role="status">Loading workspace records…</p>;
  else if (target === 'teaching-groups') content = <>
    {activeGroup ? <MobileTeachingGroupDetail key={activeGroup.id} data={data} user={user} dataset={dataset} group={activeGroup} ready={ready} revision={revision} overlayOpen={overlayOpen || groupDefinition} returnBlocked={returnBlocked} active={active && !groupDefinition} onBackGroups={() => setActiveGroupId(null)} onTools={() => setGroupDefinition(true)} onDetail={onDetail} onOperation={onOperation} onEdit={onEdit} onExport={onExport} onChanged={changed} onActivity={onGroupActivity} onMaintenance={onGroupMaintenance} onReturn={onTeachingReturn} onContinue={onTeachingContinue} onExchange={onTeachingExchange} /> : activeGroupId ? <div className="mobile-work-load-error" role="alert"><p>This group was removed or is unavailable. Its recorded operations remain in Activity history.</p><Pressable type="button" onClick={() => setActiveGroupId(null)}>All teaching groups</Pressable></div> : <MobileTeachingGroups data={data} ready={ready} onOpenGroup={setActiveGroupId} onTools={() => setGroupDefinition(true)} />}
    {active && groupDefinition && <PhoneBusinessSurface task="group-definition"><TeachingGroupsPanel data={data} initialGroup={activeGroup || undefined} initialCreate={!activeGroup} onClose={() => setGroupDefinition(false)} onChanged={changed} onSaved={() => setGroupDefinition(false)} onFilter={group => onGroupView?.(group, false)} onSelect={group => onGroupView?.(group, true)} /></PhoneBusinessSurface>}
  </>;
  else if (target === 'task-plans') content = <MobileTasks active={active} data={data} initialTaskId={initialTaskId} onChanged={changed} onDetail={onDetail} />;
  else if (target === 'messages') content = <MobileMessages active={active} data={data} initialTaskContext={initialTaskContext} initialMessageId={initialMessageId} initialTaskId={initialTaskId} onChanged={changed} onDetail={onDetail} onUnreadCount={onUnreadCount} />;
  else if (target === 'account') content = <MobileMyAccount user={user} dataset={dataset} onChanged={changed} />;
  else if (target === 'accounts') content = <MobileAccounts active={active} user={user} dataset={dataset} onChanged={changed} />;
  else if (target === 'activity' || target === 'my-activity') content = <MobileActivity active={active} data={data} ready={ready} personal={target === 'my-activity'} revision={revision} initialGroupId={activityGroupId} onDetail={onDetail} onOperation={onOperation} onGroupChange={onActivityGroupChange} />;
  else if (target === 'directories') content = <MobileDirectories data={data} ready={ready} onEdit={onEdit} onImport={onImport} />;
  else if (target === 'battery-records') content = <><p className="mobile-phone-purpose">The shared battery register. Open a record to inspect evidence or prepare a permitted change.</p><InventoryScreen data={data} user={user} dataset={dataset} active={active} onDetail={onDetail} onOperation={onOperation} onEdit={onEdit} onExport={onExport} onRegister={() => onOpen?.('assets')} management onImport={onImport} onGroup={setGroupMembers} />{active && groupMembers && <PhoneBusinessSurface task="group-definition"><TeachingGroupsPanel data={data} initialIds={groupMembers} onClose={() => setGroupMembers(null)} onChanged={changed} onSaved={() => setGroupMembers(null)} onFilter={group => onGroupView?.(group, false)} onSelect={group => onGroupView?.(group, true)} /></PhoneBusinessSurface>}</>;
  else content = <div className="mobile-work-load-error" role="alert"><h2>Workspace unavailable</h2><p>Return to Workspace and choose an available destination.</p></div>;
  return <section className={`mobile-work-page mobile-work-page-${target}`} aria-label={initialTaskContext === 'open' && target === 'messages' ? 'My tasks' : pageTitles[target] ?? 'Workspace'} hidden={!active && !backdropVisible} inert={!active ? true : undefined}>
    <header className="mobile-work-page-heading"><Pressable type="button" className="mobile-work-icon-button" onClick={event => { if (!phoneContext?.back.handle(event)) childBack(); }} disabled={overlayOpen || returnBlocked} aria-label="Back to previous page"><ArrowLeft size={22} aria-hidden="true" /></Pressable><h1>{activeGroup?.name || (initialTaskContext === 'open' && target === 'messages' ? 'My tasks' : pageTitles[target]) || 'Workspace'}</h1></header>
    <div className="mobile-work-page-content">{content}</div>
  </section>;
}
