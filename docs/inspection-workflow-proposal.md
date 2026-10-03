# Battery inspection workflow proposal

Draft for review · Revised 2 October 2026 · Proposed extension beyond release 0.3.0

**Decision status: Provisional outline for discussion and later refinement.** The four-part outline below is the current recommendation. It is not an approved safety procedure or implemented feature. The earlier seven-day initial deadline and universal thirty-day repeat interval remain unadopted. See the [battery inspection evidence review](battery-inspection-evidence-review.md) for source details and limitations.

## Current provisional outline

Provide a prepared plan with four distinct activities. Staff can customize it, but should not have to design its basic workflow. The purpose is to fit useful checks into existing work, maintain a shared record of exceptions and avoid duplicate per-battery tasks.

| Activity | Provisional timing | Content | Recording and responsibility |
| --- | --- | --- | --- |
| **Routine observation** | On receipt and before actual use or charging | Look for visible condition concerns and problems with the associated charger or connections; use applicable handling guidance | The staff member performing the activity can report a concern directly. No additional normal-result form by default; do not infer a completed check from checkout or return. A later applicable procedure may require explicit records. |
| **Storage area review** | Once each week | Review the actual storage area for unsuitable surroundings, nearby combustibles, obvious damage, exposed connections or other visible concerns | One shared task and one confirmation per area, not one task for every battery. Initially assigned to the administrator enabling the workflow; reassignment is available. |
| **Inventory reconciliation** | Once before each teaching period begins | Reconcile battery identity, responsible owner, registered storage, outstanding loans and unresolved discrepancies | A batch review led by the inventory administrator, using existing owners to follow up discrepancies. Only reconcile actual evidence; an inaccessible battery is not confirmed present. |
| **Long-term storage maintenance review** | Provisionally every six months for applicable stored batteries | Review the relevant manufacturer storage-maintenance instructions and arrange only the actions those instructions require | Route to the responsible owner account. This is a planning reminder, not an instruction to charge every battery or a claim that all batteries can wait six months. Model applicability and the correct timing origin require verification before activation. |

The weekly area review is adapted from [University of Washington guidance](https://ehs.washington.edu/system/files/resources/lithium-battery-safety.pdf), whose current downloaded revision is January 2026. Its six-month provision concerns stored-battery charge maintenance; this proposal retains a maintenance-review placeholder until model-specific instructions are checked. Neither frequency is presented as a UNSW requirement. The teaching-period reconciliation is our administrative design choice, not a published battery safety interval. Pre-use observation is supported by [Iowa State EHS guidance](https://www.ehs.iastate.edu/battery-safety); charging checks also appear in the university checklists reviewed in the evidence note.

Storage review is not an instruction to handle a visibly failing battery, and a lack of reported concerns does not certify internal health. Manufacturer or applicable local procedures take precedence wherever they require different actions or intervals.

## Messages inbox

Add **Messages** to the application sidebar as the receiving window for system reminders. This requirement complements the preferred email channel; it does not replace it or expand the confirmed reminder scope.

- Show a personal inbox for the authenticated staff account, with an unread count and **All** / **Unread** filters. Each message shows its subject, task category, creation time, relevant due date and current task state, with a link to the shared task or affected record.
- Persist messages and read state across sessions. Reading or marking a message as read does not complete the underlying task; actual task completion updates the linked state while preserving message history.
- Link inbox and email notifications to the same task cycle. Refreshes and delivery retries must not create duplicate messages. Ordinary inventory activity, daily observation and standalone condition or correction reports do not acquire automatic notifications under the agreed three-task scope.
- If email is unavailable or fails, retain the in-app message and show the delivery limitation clearly. Do not label a message as emailed unless its actual delivery state supports that label.
- Local inbox use can be developed and reviewed separately from external email. A promise of timed delivery while nobody has the application open still requires a running scheduler; an inbox alone does not supply unattended scheduling.

## Periodic task editing

Use a simple **Edit periodic task** window, with details refined after the actual battery rules are known. Start from the three supplied templates rather than an empty workflow builder. Apply templates in bulk to a model or defined group where appropriate, reserving individual overrides for exceptions. Routine timing and notification timing are independent; there is no global Monday delivery rule.

| Setting | Purpose |
| --- | --- |
| Applies to | A defined battery selection, model/group or actual storage area, appropriate to the task |
| Task and basis | What must be done and the relevant manufacturer instruction, local procedure or clearly identified management decision |
| Due rule | First due date and a fixed-calendar or completion-based recurrence, with an explicit starting point |
| Assignment | Existing responsible owner routing or an explicit staff assignment |
| Reminder rule | Advance notice, notification time and any repeat rule, independently of the due date |
| Channels | Messages and preferred email delivery, showing unavailable delivery conditions honestly |

Show **Next due** and **Next reminder** before saving. Use Australia/Sydney for displayed local schedules and calendar months where a rule specifies months; six months must not silently become 180 days. Changing a notification preference must not change a task's due date. Explain the effect of a due-rule change on the current open task and preserve previous completion and delivery history. Advanced scheduling options can remain collapsed.

The exact reminder defaults for each template remain to be refined; do not substitute a new arbitrary fixed delivery day. Group messages for the same recipient when their configured delivery windows coincide, rather than delaying every reminder to a universal weekly digest.

## Provisional reminder and exception workflow

- The confirmed reminder scope is limited to three periodic task types: weekly storage area review, inventory reconciliation before each teaching period, and applicable long-term storage maintenance review. Routine observation and day-to-day walk-throughs do not generate system reminders.
- Email is the user's preferred delivery channel. Before claiming automatic delivery, verify an authorized sending service or connector, usable recipient addresses, a continuously available scheduler, and an actual delivery test. If any condition is missing or cannot be satisfied, report it directly to the user; a preview, queued item or in-app list must not be described as a sent email.
- Create reminders according to each periodic task's configured notification rule, separately from its due rule. There is no fixed Monday delivery schedule. Combine items for the same recipient when appropriate and send nothing when there is no relevant work. Exact timing defaults will be refined by template; actual email delivery remains future work. A condition issue or record correction remains visible in the application but does not independently trigger an automated reminder under this scope.
- Reuse native staff owner identities for battery-specific follow-up. Provide the administrator as the initial area and reconciliation coordinator, with optional reassignment. Do not ask staff to build flows or configure every battery individually.
- Allow a condition concern to be reported whenever it is noticed. Record it in shared follow-up and apply the disclosed lending hold immediately on save; staff can open the shared case directly. Handling an active incident follows the local response procedure rather than waiting for software recording.
- Keep record corrections separate from condition concerns. A location or owner-record discrepancy alone does not impose a condition-related lending hold.
- Normal lending and returns do not gain a new approval step. Completed tasks leave future reminders automatically; completion requires the actual relevant review, not opening an email or recording a movement.
- Do not add a universal monthly battery inspection. High-use equipment or other special groups can receive additional requirements later when their actual use and applicable sources justify them.

Before implementation, the project team will resolve the actual storage areas, teaching-period dates and model-specific storage requirements. These are facts needed to refine a supplied plan, not a request for the teacher to design the system. Prototype examples must be labelled as demonstrations rather than approved operating instructions.

## Detailed options for later refinement

The remaining sections preserve earlier design candidates for future discussion. They do not add requirements to the four-part outline above. In particular, the old assumption of one recurring routine plan per battery is not adopted: area reviews, inventory reconciliation, event observations and storage maintenance have different targets. Any conflicting candidate below must be revised before implementation.

This proposal adds shared inspection lists, periodic reminder emails and recorded follow-up to the battery inventory. Its purpose is to remove the work of remembering dates, finding relevant records, coordinating colleagues and closing reminders. Staff still perform the physical inspection and decide what they observed.

The product supplies a complete starting plan, checklist, assignment rule and reminder schedule. Staff can use those defaults immediately in the prototype and customize them when needed. Designing the workflow, researching suitable templates and choosing an implementation are responsibilities of the project team, not setup tasks delegated to the teacher.

This is a design proposal, not implemented functionality or an approved inspection procedure. It does not change the current requirements baseline. The user has reported that the stakeholder values periodic reminders about items requiring inspection in the chemical-management system. That is the basis for prioritizing this workflow; no efficiency improvement has yet been measured.

## Current baseline

The current local application builds on release 0.3.0 and already provides individual staff accounts, a shared inventory, batch checkout and return, dated histories, administrator maintenance and protected concurrent writes. Responsible owners are native staff accounts linked through explicit directory projections. A checkout uses the signed-in staff member as its holder. Normal staff currently cannot edit saved metadata or perform administrator maintenance.

The proposed work adds inspection-specific staff actions without opening general metadata editing. Real RFID ingestion, school identity integration and automatic email are not implemented in the current release. A local preview cannot provide reliable unattended reminders while its computer or server is off.

## Recommended first release

The first complete inspection release should include five capabilities:

1. A built-in routine review plan automatically covers existing and newly registered batteries; an administrator can adjust it without creating a plan from scratch.
2. All staff can view due inspections and record inspections they actually performed.
3. Findings remain visible as shared follow-up, with an identifiable handler and a lending hold when review is required.
4. Each designated staff recipient receives one periodic email summarizing their unresolved work.
5. Completion updates shared history and removes resolved items from future reminders automatically.

Normal checkout and return gain no additional fields or approval steps. An explicitly held battery is the exception: checkout is blocked and explains the outstanding issue. A due inspection alone does not mean the battery is damaged and does not automatically place a hold.

## Candidate defaults pending evidence review

The project team will supply researched defaults rather than ask the teacher to design the system. The following candidates are not an approved operating plan; fixed per-battery inspection dates are deliberately unresolved.

| Setting | Supplied default | Reason |
| --- | --- | --- |
| Plan | **Routine battery review** | One understandable starting plan rather than an empty plan builder |
| Coverage | All existing and newly registered batteries | No repeated plan selection during registration |
| First review | No universal deadline adopted | Receipt and before-use checks must be distinguished from an arbitrary deadline after database registration |
| Repeat interval | No universal interval adopted | Each periodic requirement needs an applicable source, target and trigger; a storage-area inspection is not an inspection of every battery |
| Assigned staff | The battery's existing responsible owner account | Reuse a known responsibility instead of asking for a second coordinator |
| Reminder | A combined digest remains a candidate; delivery cadence is pending | Email frequency must not create unnecessary inspection tasks |
| Routine completion | One reviewed batch submission for batteries actually checked | Avoid repeating operator, time and result entry |
| Condition concern | Shared issue, lending hold and explicit resolution | Make a reported condition concern visible in subsequent lending |

The earlier seven-day starting window and thirty-day interval lacked an applicable inspection requirement and have been set aside. The project team must identify the relevant manufacturer instructions and existing local procedures, distinguish per-use observation from periodic maintenance and location-level review, and prepare a configuration supported by those sources. Staff should not have to author that configuration. Absence of an adopted calendar interval is not evidence that inspections are unnecessary.

The previous three-prompt checklist below remains a discussion candidate. Inventory identity and custody checks are administrative tasks, not proof of battery safety, and should not automatically be repeated whenever a condition check is required:

1. **Match the battery to its record.** Confirm its visible identifier and that the battery is actually available for this review. An inaccessible or unidentifiable item is recorded as **Unable to inspect**, rather than given a normal result.
2. **Review visible external condition.** Look for apparent casing damage, deformation or leakage and record any condition concern. This is an external observation, not disassembly, electrical testing, capacity measurement or a safety certification.
3. **Compare custody and location information.** Review the displayed holder and storage home against what is actually known. A record discrepancy can be flagged for administrator correction without changing the loan or claiming a new RFID observation. Unknown room information remains unknown.

The checklist is shown once for a compatible batch, with one final confirmation for the batteries actually reviewed; staff do not tick three repeated boxes for every battery. A record-only discrepancy uses **Record correction needed**, appears in an administrator follow-up filter and does not itself impose a lending hold or pause the routine schedule. It remains flagged until an administrator records the correction or a reasoned dismissal. A condition concern uses **Report condition issue** and follows the hold rules below. Both can be recorded when both apply.

The administrator who enables the workflow is automatically the default assignee for record corrections. Administrators can change this default or take and transfer individual corrections without changing battery ownership. Unresolved corrections remain in that administrator's work list even after the physical review is complete; they do not independently create automated reminders under the confirmed scope. If the assignee becomes unavailable, the correction stays visible in **Needs assignment**. Ordinary staff can flag a discrepancy without gaining permission to edit saved asset metadata.

UNSW's [battery handling guidance, published 17 August 2026](https://www.inside.unsw.edu.au/campus-culture/make-sure-you-handle-batteries-safely), calls for regular checks for damage and swelling, avoiding use of abnormal batteries, and following appropriate handling arrangements. It supports including an external-condition prompt; it does not establish a thirty-day or seven-day interval. This starter checklist does not replace product-specific instructions, pre-use checks or applicable local procedures.

## Staff workflow

### Routine inspection

The recipient opens **Review inspections** from an email or the application. The filtered list shows the battery ID and name, registered building and optional room, current loan status, due date and last completed inspection. The registered location is labelled as the storage home; dated observations remain separate evidence.

Staff inspect the physical batteries using the configured checklist. They select only the batteries actually checked and choose **Record inspection**. The form defaults the inspector from the signed-in account and the inspection time to now. A single reviewed submission can record **No condition concern observed** for the selected batteries. A note is optional; staff do not type the same result for each battery. Record-correction flags remain visible alongside this condition result.

Bulk completion is restricted to batteries using the same checklist revision. The interface groups different plans so that one confirmation cannot accidentally claim that incompatible checks were performed. It shows the selected IDs and count before the final save.

After a successful save, the shared list and history update, the current inspection cycle closes and the next due date is calculated. Reading the email, opening the page or returning a battery never completes an inspection.

### A problem is found

The inspector removes that battery from any normal-result selection and chooses **Report condition issue**. A short description of the finding is required. The form clearly states that this action records a condition issue requiring review and pauses further lending of this battery. Record-only discrepancies use the separate correction flag and do not trigger this hold.

The issue becomes shared follow-up. It initially routes to the battery's responsible owner account, unless an administrator has chosen an explicit assignment override. A colleague can choose **Take ownership** or transfer the issue to another active staff account. Ordinary inspections do not require a separate claiming step.

The completed inspection closes its due cycle, but the issue stays open and the lending hold remains active. Routine scheduling pauses while that issue is open, so the same work does not appear as both a repetitive routine task and an unresolved finding. Follow-up reminders refer to the existing issue. Each battery has at most one open issue case; further findings append their own evidence to that case.

An administrator releases the hold only through an explicit resolution action, with a resolution note and a recorded follow-up inspection confirming that the case has no outstanding findings. The follow-up inspection must occur after the latest related finding. Release checks the current issue version; if another finding has arrived in the meantime, the older review cannot release the updated hold. The next routine due date then uses the accepted follow-up inspection time. Correcting an erroneous report requires a reason and preserved history; a later ordinary bulk result cannot silently clear an existing hold.

Reporting an actual condition finding remains possible outside a due cycle. If a colleague has already completed the cycle, a condition finding submitted from an older screen still records its evidence and imposes the hold; it does not complete the cycle a second time. Record-only corrections do not use this hold path.

This is a proposed conservative lending rule for review. The labels describe the recorded workflow; **No condition concern observed** is not a certification that a battery is safe.

### The battery cannot be inspected

If a due battery is on loan, the list shows the current holder and loan time alongside the inspection task. Staff do not need to look up a separate loan table. The item remains due. If staff cannot access it, **Unable to inspect** records the reason without inventing a completed inspection or advancing its due date.

When the battery returns, the same pending inspection remains and its loan indicator updates. Staff can also record a real inspection performed while a loan is still open; inspection and lending are separate facts. Missing RFID detection does not create a loss finding or inspection result.

## Screens and navigation

Add one primary navigation entry, **Inspections**, and a compact due-work indicator on the existing overview. Do not replace the inventory table or introduce a separate general task-management application.

| View | What staff see | Main actions |
| --- | --- | --- |
| **Inspections** | **Due inspections**, **Open issues**, **History**; **Assigned to me** and **All staff** filters; administrator filter for record corrections | Record selected inspections, report a condition issue, open battery details |
| **Record inspection** | Selected IDs, one checklist revision, inspector, time and result | Save inspected batteries, exclude an item that needs separate attention |
| **Issue details** | Finding, affected battery, hold state, assigned handler, follow-up notes and history | Take ownership, transfer, add a note; administrator resolution |
| **Battery details** | Last result, next due date, active issue or hold, and inspection history | Open the related inspection or issue |
| **Inspection plans** | The supplied plan, covered batteries, default owner routing, interval, first due rule and checklist | Optional administrator customization and bulk overrides |

The due-list columns should be **Battery**, **Storage home**, **Loan status**, **Last inspected**, **Due**, and **Assigned staff**. Use existing search and location filters. Never use colour as the only indication of a due item or a hold.

Loan state, inspection state and lending restrictions stay distinct. A battery can simultaneously be **On loan**, **Inspection due**, and under a separately recorded lending hold. The existing definition of **In store** remains “no active loan recorded,” not proof of physical presence.

## Inspection plans and dates

The candidate template includes a name, checklist and routing to the responsible owner account. Its initial and repeat timing remain unapproved. If a periodic plan is later adopted, its applicability, source, trigger and calculation must be explicit; enabling a template alone must not invent calendar deadlines. The earlier one-plan-per-battery design also needs review because battery, charger and storage-area requirements have different targets. Administrators may customize a prepared plan after the project team has established suitable defaults.

The default automatically covers new registrations without a new required field. The software does not guess chemistry-specific checks from a battery name. If an administrator deliberately disables automatic coverage or removes a plan, affected batteries appear in **Not scheduled**; that is an exceptional configuration state, not the starting experience.

Historical batteries with no review evidence display **No previous review recorded**. They receive no invented inspection date or automatic seven-day grace period. An initial deadline needs a later-adopted rule with a documented basis. Where an actual prior review is available, preserve its accepted completion date; do not restart an established deadline to hide overdue work.

For a later-approved periodic plan, the next due date follows that plan's source-based rule, using Australia/Sydney calendar dates. A rolling interval after completion is only one possible rule; fixed-calendar schedules must not silently become rolling intervals. Recording an inability to inspect leaves any existing due date unchanged. Checklist and interval revisions preserve past evidence and explain their effect on current work. Changes to owner routing and coordinator overrides take effect on current unfinished routine work immediately; taking or transferring an issue or correction updates its assignee immediately. Explicit issue assignments stay in force until transferred.

Routine completed inspections retain both the actual inspection time and the submission time. Delayed or stale submissions cannot replace a more recent accepted cycle. Corrections append a reasoned record rather than rewriting the original evidence.

## Reminder behaviour

The configured notification rule for each of the three eligible periodic task types determines when a reminder is generated. The work list remains current independently of email. The earlier global weekly delivery proposal is withdrawn; the current task-editing section governs timing.

Deduplicate notifications for each recipient, task cycle and configured reminder occurrence. A combined email may show a compact preview with links to the current tasks. Only storage-area review, teaching-period inventory reconciliation and applicable long-term storage maintenance are eligible; condition issues and record corrections do not independently generate reminders. Routine inventory changes, successful checks and normal returns do not each generate an email.

An eligible unresolved task may be repeated only as permitted by its configured reminder rule. Merely being assigned or being worked on does not mark it complete. The application rechecks current completion and assignment immediately before constructing the message, so already resolved or reassigned items are omitted. Links always open the latest authenticated list; an old email is a historical summary, not an editable second register.

Routine review reminders route to the battery's responsible owner account unless a plan has an explicit coordinator override. Open issues route to their currently assigned handler. A change in responsible ownership updates owner-routed routine work; an explicitly accepted issue assignment remains with its handler until transferred. The same item is not emailed to the entire team. Assignment does not change the battery's responsible owner or current holder.

The destination is the confirmed email address of the assigned staff account, resolved through its immutable account ID and explicit directory link. The application must not match by display name or invent an address. Missing or invalid contact information, disabled owners or handlers, and unavailable overrides appear in an administrator-visible **Needs assignment** or **Delivery problem** queue. The in-app work remains visible to all authorized staff; no extra coordinator must be configured for a valid default owner assignment.

The sender records queued, accepted, failed and uncertain delivery attempts with a stable delivery identifier. Scheduler reruns and supported provider retries reuse that identifier. Provider acceptance is labelled as acceptance, not proof that a person read the message. If a provider cannot determine whether an interrupted send was accepted, the application flags the uncertainty rather than repeatedly sending blind retries. Exact retry behaviour depends on the selected delivery service.

Demonstration data must not send scheduled messages to working recipients. A review demonstration uses a clearly labelled email preview; an actual delivery test uses explicitly designated test recipients.

## Roles and responsibility

| Action | Staff | Administrator |
| --- | --- | --- |
| View all inspection lists, results and follow-up | Yes | Yes |
| Record an inspection actually performed | Yes | Yes |
| Report an issue and impose the displayed lending hold | Yes | Yes |
| Take ownership, transfer follow-up and add notes | Yes | Yes |
| Configure plans, intervals, checklists, coordinators and delivery | No | Yes |
| Release a lending hold with resolution evidence | No | Yes |
| Correct previous inspection evidence with a recorded reason | No | Yes |
| Edit saved asset metadata or administer accounts | Existing permissions | Existing permissions |

The **responsible owner** is the native staff account accountable for the asset. The **current holder** is the staff account attached to its active loan. The **inspector** is the authenticated staff member who recorded the check. The **assigned staff member** defaults to the responsible owner for routine work and new issues, but an explicit override or transfer can assign follow-up elsewhere. Default routing reuses responsibility without merging these distinct roles or rewriting asset ownership.

This table proposes a specific extension to staff permissions. Existing administrator-only maintenance does not become staff-editable simply because inspection features are added.

## Implementation outline

The application should own schedules, assignments, results and completion state. An approved email service delivers its digests. Power Automate may serve as that delivery integration if school access permits; the workflow does not depend on maintaining a duplicate spreadsheet or teaching staff to build flows.

The proposed data additions are inspection plans and battery assignments, due-cycle tasks, append-only inspection results, record-correction flags and their resolution history, condition-issue follow-up with lending holds, and notification delivery records. Existing battery IDs, accounts, locations, audit history and request-id protection should be reused. Final table definitions belong to the implementation design after this proposal is reviewed.

Important invariants are:

- One active plan per battery and one accepted completion per due cycle. A stale second submission reports who completed the cycle and when, retains the second staff member's input, and does not advance the schedule again.
- A previously completed cycle never prevents an actual condition finding from being reported. Further condition findings append to the battery's open condition issue case and update its version; hold release requires a current review and a follow-up inspection after the latest related condition finding. Record-only correction flags remain separate and do not create a hold.
- Record the result, close the appropriate task, update its next due date and append audit evidence atomically. Reporting a condition issue and imposing its hold must also be atomic.
- Recheck active lending holds on the server when checkout commits. A batch containing a held battery is rejected with the affected IDs; it does not silently lend a partial batch. Returns remain available.
- A normal inspection result cannot remove a separate unresolved hold. Account disablement and authorization changes are rechecked when writes commit.
- Shared records belong to the shared inventory. Demonstration and working data remain separate. Inspection exports include result, time, inspector, checklist revision and related follow-up; account credentials are excluded.

## Delivery stages

| Stage | Deliverable | Completion condition |
| --- | --- | --- |
| **A Shared inspection workflow** | Supplied plan and checklist, automatic coverage and owner routing, due list, batch records, issue follow-up, holds, history and an email preview in the local application | A fresh inventory needs no plan authoring; two-account scenarios and persistence tests pass; the preview is labelled and no external email is claimed |
| **B Scheduled reminders** | Approved always-on runtime, scheduler, configured sender, staff contact routing and delivery monitoring | A scheduled message reaches a designated test recipient; completion, reassignment and retry cases are verified end to end |

Both stages are needed to claim that the complete periodic-reminder feature has been delivered. Stage A can be reviewed without school email access. Stage B requires a running service beyond the current local-only preview. There is no fixed delivery estimate until the host and email integration are known.

Excluded from this first release are student notifications, multi-level approval, automatic loss declarations, AI inspection judgements, live battery measurements, new RFID integration and a general workflow editor.

## Demonstration and acceptance

Use clearly fictional batteries and two test staff accounts. Configure an explicitly labelled demonstration plan with simulated due dates; its interval and checklist are not a recommended operating procedure.

The short demonstration opens a digest showing five batteries due, records three completed checks in a batch, reports one issue and leaves one battery awaiting access while on loan. A second account sees the three completed records, the held issue and the still-due item. Returning the loaned battery makes it available for checking without completing the inspection. Resolving the issue requires the explicit administrator action.

| Scenario | Expected result |
| --- | --- |
| A later-approved workflow is enabled with existing batteries | The prepared template and owner routing appear without manual plan authoring; any deadline has a documented applicable basis |
| A new battery is registered | It joins the supplied plan automatically; no extra mandatory setup field |
| Several checked batteries share one checklist | One reviewed save records each result and the individual inspector without repeating fields |
| A review identifies only a record discrepancy | The correction flag remains visible to administrators; no automatic lending hold or fabricated location evidence |
| A due battery is on loan or cannot be accessed | It remains due; no false inspection time or automatic damage finding |
| The battery returns | Loan state changes, but the inspection still requires a real recorded check |
| Two staff submit the same due cycle | One completion; the other sees the accepted completion and retains their unsaved input |
| A colleague reports a condition finding after the cycle was completed | The finding and hold are recorded without completing the cycle again |
| A condition problem is reported | Evidence and the disclosed lending hold appear together; other staff can see the handler |
| A new finding arrives while an administrator is resolving an issue | The stale release is rejected; an earlier review cannot clear the updated hold |
| A held battery is included in checkout | The server rejects the affected batch without partial lending; return remains permitted |
| A routine normal result is submitted for a held battery | The hold is not silently removed |
| A result or assignment changes before a digest is constructed | The digest reflects the current unresolved work and recipient |
| A routine review finishes with a record correction still pending | The correction remains in its administrator's work list; it does not independently generate an automated reminder |
| A scheduler run repeats or delivery fails | Stable delivery tracking prevents routine duplicates and exposes unresolved delivery failures |
| An assigned account is unavailable or its email is missing | Work remains visible and is flagged for administrator attention; it is not silently lost |
| Historical batteries have no inspection records | Unknown history remains explicit; neither past checks nor a grace period are fabricated |
| The system restarts | Tasks, results, holds and delivery state remain available |

## Evaluation of staff effort

Extend the existing evaluation protocol with three paired tasks: identify the batteries due for inspection, record a batch containing a finding, and hand unresolved work to a colleague. Compare with the stakeholder's observed current method using equivalent fictional data. Measure administrative time separately from physical inspection time, because the software does not remove the physical work.

Record time to a correct saved result, repeated data entry, manual lookups or questions, duplicate follow-up, missed items, notification noise and recovery effort. Include the initial plan setup and later maintenance effort in the assessment. Counterbalance task order and report the limits of a small participant sample.

The proposed acceptance criterion is reduced administrative effort without more missed work or misleading records. No percentage improvement is promised before measurement. If a feature adds more effort than it removes, simplify that part of the workflow before expanding scope.

## Inputs still needed for operation

The project team owns delivery of the default plan, researched checklist, schedule, assignment logic, screens and technical integration proposal. The teacher reviews a working starting point and can request changes; they are not asked to design the system or create its basic plan.

Before operational use, the project team must identify the actual battery models and relevant manufacturer or existing local procedures, check the supplied defaults against them and prepare any necessary changes. Staff only need to provide inaccessible local information or confirm site-specific facts. Real staff contact details and permission to use the school's email service remain deployment inputs; the project team proposes and configures the host and delivery mechanism rather than asking the teacher to choose an architecture. Until actual delivery is verified, the prototype provides the complete in-app workflow and a labelled email preview without claiming unattended email service.
