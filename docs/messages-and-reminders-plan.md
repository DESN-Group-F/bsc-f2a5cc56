# Messages and periodic reminders

Application release 0.5.0 · 3 October 2026 · Shared periodic tasks and personal Messages; email and unattended delivery unavailable

The application supplies prepared task templates, shared recorded cycles, account-based assignment, a persistent personal inbox and explicit completion. It builds on My activity and the shared staff inventory. These workflows are included in frozen source release 0.5.0; the earlier 0.3.0 tag is unchanged. Source publication does not deploy the application. Actual test and browser outcomes belong in [validation](validation.md), separately from proposed operational experiments.

The aim is to reduce remembering, repeated searches and handover work without adding frequent battery checks. The project supplies the workflow and provisional defaults; staff can customize them. No efficiency measurement, verified safety procedure, real hardware connection or external delivery is implied.

## Implemented task scope

Only three categories are available. Template intervals are provisional planning configuration requiring actual site/model confirmation.

| Task | Available targets and provisional timing | Initial routing | Required confirmation |
| --- | --- | --- | --- |
| Storage-area review | One selected storage area; weekly calendar interval | Administrator using the template | Actual area, applicable local basis, first due date, reminder time and active staff assignments |
| Inventory reconciliation | Defined inventory, registered model, explicit group or selected batteries; confirmed teaching-period dates | Administrator using the template | Actual inventory coverage and teaching-period due dates; no calendar dates are inferred |
| Storage maintenance review | Registered model, explicit group or selected batteries; provisionally six calendar months | One-click responsible-owner assignment from actual selected assets; explicit overrides available | Model applicability, manufacturer/local instructions, timing origin, required action and assignments |

Routine daily observations, standalone condition concerns, record corrections and a general custom category do not generate reminders under this scope. No universal seven-day first review, thirty-day repeat inspection or Monday delivery default is adopted. Storage-area reviews are area tasks, rather than individual battery tasks.

Storage maintenance means reviewing the applicable instruction. It does not direct staff to charge every battery, infer its charge level or apply six months to every model. The [inspection evidence review](battery-inspection-evidence-review.md) records unresolved operating requirements. This implemented scope supersedes earlier unadopted inspection candidates, which are outside this application release.

## Configuration and shared work

All staff can view/search/download Recurring tasks and their recorded cycles. Administrators alone create/edit configuration. Templates supply title, required work and provisional basis; reminder time and actual dates remain blank until selected. The administrator confirms basis, applicability, required work, target, dates, reminder time and active assignees before activation. Drafts preserve incomplete information; active and paused are explicit states.

Staff assignments use immutable native account IDs and multiple existing accounts can share one cycle. The responsible-owner shortcut resolves active owner account IDs from the selected batteries/model/group. It does not infer identity from a name or require staff to re-enter existing owner names. Explicit assignments remain until deliberately changed. One actual completion closes the shared cycle for all assignees.

Working storage-area plans require a confirmed selectable room; placeholders cannot activate them. Demonstration placeholders remain explicitly provisional. Model targets come from registered saved models. Groups require a name and explicit registered battery membership; selected/group targets support up to 100 batteries. A defined inventory needs a scope description. Real battery data, actual storage areas and applicability still await stakeholder confirmation.

A plan has at most one open cycle. Each cycle records its requirements, applicable basis, target membership/labels and due date when created. Later model/group additions do not silently expand that cycle. Editing a plan retains its recorded content, targets and deadline and all completion history, while reminder preferences and current routing can change independently. Reassignment stops future reminders to former assignees without deleting their old Messages.

Plan edits submit the loaded version. Completion submits the reviewed cycle ID/version and optional notes; the server records the actual completion time and authenticated actor. Notes have no minimum length and a maximum of 2,000 characters. Assigned staff may complete their current tasks; administrators may complete any reviewed cycle. Reads, lending, returning or opening a page never imply completion. The interface asks the operator to confirm the task was completed; its record is not a battery safety certification.

Conflicts preserve edited fields or notes and require loading/reviewing the latest state before explicitly accepting a replacement. Create/update/complete use a stable request ID for an unchanged retry after an interrupted response. Authorization, assignment, target and version guards apply again at the atomic D1 commit.

## Recurrence and reminders

Three due rules are available: fixed calendar interval, interval after actual completion, or explicit due dates. Months and years retain the original calendar anchor and month-end behavior; six months is not converted to 180 days. Completion-based recurrence starts at the recorded actual completion date. Teaching-period reconciliation can retain explicit dates instead of an invented university interval.

After a late completion, calendar/explicit rules choose a configured date after the previous due date and actual completion. Skipped planning periods are recorded separately; they are never fabricated as completed inspections. Without an actual completion, the current open task remains outstanding. The editor separates its recorded deadline from a future-cycle preview; actual completion can change that preview.

Reminder advance days and local time are independent of the due rule. No fixed time is silently supplied. The preview shows the due/reminder date in Australia/Sydney. Ambiguous or nonexistent daylight-saving wall times have no guessed UTC instant and remain visibly unavailable until reviewed. Changing reminder preferences does not change the current recorded due date.

Authenticated inventory/task/Message requests evaluate active configuration. When a valid reminder instant has been reached, a message is generated for each current active assignee. One cycle/recipient reminder is deduplicated across repeated requests and retries. Completed and paused work generates no new reminders; old creation/read/completion evidence remains available. Later invalid targets, disabled assignments or a generation conflict produce a visible review warning.

The interface states: **Messages are generated while the system is in use.** Stopping the computer/server or receiving no authenticated request suspends evaluation; eligible work is evaluated on a later request. Fifteen-second visible idle refresh supports local task/inbox use. There is no cron handler, unattended worker or guaranteed timed background delivery.

## Personal Messages

The sidebar Messages entry shows the authenticated account's unread count and a red dot while that count is positive. Unread subjects also show a red dot. All / To do / Completed tabs filter task state; All read states / Unread / Read separately filter reading. Search applies to that recipient's complete stored inbox. Clear filters resets both states and the query. Each row displays subject/category, creation time, due date, a distinct task-state badge and read state/time. Reading and task completion remain independent: a completed task may still have an unread message. The sidebar unread total is not reduced by viewing a filtered list. Open task shows recorded requirements and permits authorized explicit completion. External email remains unavailable.

Messages and read state persist across sessions. Mark read changes only the recipient's read timestamp and never completes a task. An older message keeps its original subject/body/creation evidence while showing the current linked task state. Shared task records remain the source of truth; a personal inbox does not create a private battery register. Inbox APIs do not accept a client recipient identity, and administrators do not gain access to another account's personal inbox.

Shared task JSON uses the same search helper as the visible plans/cycles view and includes all matching plans and associated recorded cycles. Personal Message JSON uses the same task-state, read-state and search scope and includes every matching own message with linked task data. Scope/count/filter metadata describes the generated file. These exports have no inventory snapshot history cap and do not export credentials or sessions. They are separate from the nine battery-detail sections; battery downloads do not automatically include task cycles or Messages.

## Email and operational gates

Email remains the preferred external channel, with Messages retained for the same task cycles. The local UI can save an additional email preference; it sends nothing. There is no integrated authorized sender, recipient-address confirmation, delivery-attempt store or receipt evidence. An account email field and syntax validation do not prove that an address is usable.

Power Automate remains one possible future adapter, rather than a required product dependency or a workflow-building task for teachers. No school/remote mail permissions have been verified and no email has been sent. This gap does not establish that a particular provider cannot support the feature.

Before external delivery:

1. Confirm actual areas, teaching dates, model-specific procedures and operational assignments with the stakeholder.
2. Approve an email service/sending identity, verified test recipients and institutional data/hosting conditions.
3. Supply a continuously running scheduler with tested Australia/Sydney conversion, completion/reassignment races and empty-recipient suppression.
4. Persist intended delivery keys and distinct unconfigured, queued, attempted, service-accepted and failed states. Reconcile uncertain outcomes before blind retries.
5. Verify actual test-recipient receipt before claiming delivery. Preparing a digest, creating a Message or obtaining service acceptance alone does not establish inbox arrival.

Demonstration tasks must not email operational recipients. Missing recipients or failed delivery must remain visible without discarding the shared task or its Messages history. No provider purchase, deployment, external message or verified safety/efficiency result is authorized or claimed by this document.
