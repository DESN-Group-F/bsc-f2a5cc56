# Architecture and design decisions

## System boundary

The browser presents the staff review workflow. The authenticated API validates inputs, resolves identity server-side and performs prepared SQL against Cloudflare D1. Drizzle defines a versioned schema; runtime domain operations use the D1 API directly so their transactional boundary is explicit.

```mermaid
flowchart LR
    Staff --> UI[English web interface]
    UI --> API[Authenticated inventory API]
    API --> Store[Inventory domain]
    Store --> D1[(D1 database)]
    Reader[RFID reader: unvalidated] -. future adapter .-> API
    D1 --> Views[Inventory and history views]
    Views --> UI
```

## Data model

| Table | Responsibility |
| --- | --- |
| people | Explicit native staff-account directory projections |
| buildings | Reference campus building codes and names; current write support is J18 |
| rooms | Number/name, parent building, placeholder and selectable flags |
| batteries | Asset identity, tag, specifications, owner and storage building with optional room |
| loans | Checkout, original holder snapshot/account ID, return and correction state |
| observations | Room, observation time, receipt time and source |
| charges | Historical completion time, duration in minutes and recorder; legacy percentage retained |
| audit_events | Who did what, when, and relevant before/after details |
| operations | Idempotency result and transaction guard |
| workspaces | One-time demo initialization marker |
| shared_inventories | Canonical scope for each shared working/demo dataset |
| staff_accounts | Login identity, role, access, profile, password hash and versions |
| staff_sessions | Hashed session tokens, account authorization version and expiry |
| staff_account_events | Immutable account-management and profile/password audit |
| sign_in_attempts | Failed sign-in window counters |
| task_plans | Shared versioned periodic configuration, basis, scope, recurrence and reminder preferences |
| task_plan_assignees | Explicit native account assignments for each plan |
| task_plan_batteries | Explicit registered-battery membership for selected/group targets |
| task_cycles | Recorded requirements/target snapshot and due date, versioned reminder state and completion evidence |
| task_messages | Recipient-specific persistent reminder content and creation/read evidence |

All business queries are scoped to the canonical inventory scope selected by dataset. Every active account resolves to the same working register and the same separate demonstration register. The server attaches the individual authenticated actor to writes. Staff directory rows project native accounts using explicit account IDs, unique per inventory; names never match identities. Missing reference buildings, placeholder rooms and account projections are inserted idempotently. Once complete, snapshot reads do not issue provisioning write batches. Current account names are joined for display without rewriting stored people versions or transaction snapshots.

Staff choices display the saved name with the account username, or the full stable identity ID if the username is unavailable. Owner selections retain directory IDs and holder/task selections retain native account IDs. Directory downloads, including the related People table in detailed battery exports, use the same current native-name projection as the visible directory; historical borrower and actor snapshots retain their original names.

Personal shortcuts narrow this shared register: My batteries compares ownerAccountId with the authenticated account; My loans compares the active borrower's account ID. They are presentation/query scopes, not private data stores or permissions. Everyone can return to the complete inventory.

My activity uses the same inventory audit log and filters its stored actor_id against the authenticated account. The complete-history endpoint accepts activityScope=all or mine; the server resolves the personal ID from the session. Activity exports apply the same scope before search and retain full event details. Neither personal view uses the snapshot's 200-event cap as its history source. Actor names remain historical display evidence rather than identity keys. Account-management and sign-in logs remain separate.

Migration 0004 adds accounts and shared scope mapping without rebuilding existing business tables. On first use, a dataset with exactly one legacy inventory adopts its existing scope; keys, actor history and references stay intact. A fresh dataset receives a shared scope. Multiple legacy scopes return `legacy_inventory_review` and preserve all records until an explicit collision review and migration. This release does not claim to merge arbitrary private registers.

## Periodic tasks and Messages

`lib/task-schedule.ts` defines the three categories, prepared templates, active validation, original-anchor calendar arithmetic and explicit Sydney reminder conversion. `lib/task-plans.ts` resolves shared dataset scope and authenticated identity, validates actual model/room/asset targets and uses D1 transaction guards. `/api/task-plans` supplies shared records and administrator configuration/assigned completion; `/api/messages` supplies only the authenticated recipient's inbox/read state. Neither client-provided actor IDs nor display names determine identity.

Migration `0008_periodic_tasks_messages.sql` adds the five task tables, foreign keys, same-scope/identity/evidence guards and unique indexes without rebuilding earlier account or business tables. A partial unique index permits one open cycle per plan. Message occurrence uniqueness deduplicates a cycle/recipient reminder. Existing inventory guards, actor keys, account authorization versions and operations/audit tables remain in use; source release 0.3.0 is unchanged.

Additive migration `0009_optional_task_completion_notes.sql` replaces only the cycle update trigger to permit absent completion notes and enforce their maximum length. Completion time and operator remain required, recorded cycles remain immutable and all existing identity/version/history guards remain in place. Earlier migration files are unchanged.

All staff may view/search/download shared plans and recorded cycles. Only administrators configure them. Completion carries the loaded cycle ID/version and optional notes; omitted, empty or whitespace-only notes are stored as null. Nonempty notes are trimmed and limited to 2,000 characters. Completion time and actor are always retained. The server checks active authorization and current assignment, allowing administrators all cycles. Create/update/complete requests use stable request IDs for unchanged retries. Atomic guards reject concurrent plan, cycle, assignment, target or authorization changes; a conflicting form retains its input and requires explicit review before replacing its loaded version. Mark read changes only the authenticated recipient's read timestamp.

New-plan submission captures the validated configuration and request ID in account/inventory-specific session storage before sending. An uncertain result locks editing and dismissal; returning to Recurring tasks in the same intact tab recovers the exact submission. A verified actor/inventory/request receipt clears the capture. An explicit review may replace a definitively rejected request, but ordinary HTTP errors cannot clear prior uncertainty. The server rechecks matching receipts after conflicts and reserves the same operation key with `task_plan_create_rejected` when rejecting finally. A paused original request cannot later create another plan after that final outcome. Closed tabs, cleared storage and other devices are outside this recovery guarantee.

Templates cover weekly storage-area review, teaching-period reconciliation at confirmed explicit dates and applicable storage maintenance provisionally every six calendar months. The form confirms basis, required work, scope, actual targets, dates, explicit reminder time and assignments before activation. Live area tasks reject placeholders. Model/group asset membership and room labels are saved in the cycle target snapshot; later changes do not silently expand or rewrite that open cycle. Plan edits preserve cycle content and due date while updating its reminder preferences and current routing. Historical completions and Messages are retained.

Calendar recurrence derives each occurrence from the original date anchor, preserving month-end behavior. Completion-based recurrence uses actual completion; explicit dates remain configured dates. After completion, calendar/explicit rules advance beyond the previous due date and actual completion. Skipped planning periods are recorded separately and do not create completion evidence. Reminder advance uses calendar days independently of due date. A Sydney wall time resolves to UTC only when exactly one instant exists; ambiguous/nonexistent times remain visibly unavailable.

Authenticated inventory/task/Message requests evaluate active plans and due reminders. This may create the next outstanding cycle and one message per current active recipient when its valid reminder instant has been reached. Generation rechecks state, assignment and version atomically. Invalid later targets or disabled assignments produce visible generation issues. Former assignees keep old inbox history but receive no future routing; completed or paused tasks generate no new reminders. There is no scheduled worker, continuous background guarantee or email transport. Saved email preferences do not send an email.

The shared plans view/download use `taskPlanMatchesQuery` before selecting associated complete cycle history. Personal Messages task-state/read-state/search and JSON downloads use the same authenticated server scope, without the inventory snapshot's 200-event cap. Unread counts remain global to the recipient's selected inventory; filtered views do not hide the sidebar red dot when other unread messages exist. Downloads include scope/count/filter metadata, omit private credentials and remain separate from battery-detail sections. Task/Message views refresh every fifteen seconds while visible and idle, pause around review dialogs and reject late responses from another account/dataset/context.

## Loan state

The database has a partial unique index allowing only one active loan for each battery. Confirmed checkout creates a loan for the authenticated staff member. The API rejects borrower/account/name substitutes, including administrator proxy requests. A missing linked directory row is created inside the same guarded checkout transaction with a deterministic account-derived ID. The loan stores the account ID and current saved account name; its original responsibility and checkout evidence cannot be rewritten. Confirmed return closes the exact reviewed loan and attributes receipt to the signed-in operator. Return review may contain batteries from different holders and original legacy borrowers.

A batch starts with an operations row whose CHECK constraint succeeds only if all expected loan states and authenticated permissions still hold. A return carries exact battery/loan ID pairs, not just battery IDs. Bound JSON sets avoid D1's per-statement parameter ceiling for the supported 100-battery batch without splitting its transaction. D1 batch applies the guard and every movement atomically. A conflict rolls back the complete batch. Request identifiers include the reviewed scope/state and permit safe retries after an interrupted response; reusing an identifier for a different action is rejected.

Ordinary checkout and return review capture the exact payload and reviewed rows in account/inventory/kind-specific session storage before submitting. An uncertain result locks changes and dismissal until the original request is retried and resolved. Recovery in the same browser tab resumes the captured request, never a later loan. A definite rejection requires explicit latest-state review before replacing or discarding that request. Saved receipts must match the request ID, movement, complete battery set, count and timestamp; checkout also requires the authenticated holder account. Neither a network error nor refreshed current state establishes success. Browser tools cannot replace an open workflow or bypass an unfinished movement or scan session.

Concurrent executions resolve against the same immutable request key. After a movement validation or transaction conflict, the server checks again for a matching committed receipt. If the authorized request has no receipt, a final rejection reserves that same key with internal operation kind `movement_rejected`, without changing a loan, observation or business audit event. Success and rejection cannot both win; even reopening the same loan cannot allow a previously rejected in-flight request to commit later. Matching retries return the saved success or `movement_rejected_final`; a different actor or payload cannot adopt either outcome. After a lost response, clients retain uncertainty on ordinary HTTP errors until a matching receipt or this durable final-rejection code arrives. Storage or authorization failures that prevent reservation do not claim a final outcome. An explicitly reviewed replacement uses a new request ID.

The scan station reuses this movement boundary. `scan_lookup` resolves exact registered tag strings within the authenticated shared inventory and does not mutate loans or register unknown batteries. Manual entry and demonstration-only simulated input are explicit sources; no hardware transport is enabled. A scan movement includes its session ID and the reviewed battery/tag/version bindings, which must cover the entire batch exactly. The transaction rechecks bindings as well as loan state; a tag reassignment or metadata race cannot switch the intended battery silently.

Continuous mode deliberately entered by staff commits each eligible input; Batch mode requires one reviewed-list confirmation. The page stays open after either success. Scan lookup and passive room observations cannot commit a loan on their own. An interrupted attempt retains its original request ID, source, bindings, exact loans and optional placement until a definitive response. Sidebar navigation, dataset switching and sign-out are unavailable while the station is open; exit is explicit.

The demonstration picker offers only tagged in-store batteries for checkout and tagged on-loan batteries for return. A verified movement clears only its successful selections; lookup failures, batch reads awaiting confirmation and uncertain or rejected writes retain their inputs. The picker suppresses the consumed pre-commit snapshot if refresh fails, without inventing a loan or rewriting inventory. A fresh authoritative snapshot can offer a later borrowing round at the same metadata version. Manual tag input and server binding/state guards remain authoritative.

An unregistered tag can open a registration form with that exact identifier prefilled. Registration alone does not process a movement or resolve the earlier read; staff deliberately read the tag again. Only a successful lookup of the matching registered tag resolves its earlier unknown-tag issues. Other tag, loan-state and uncertain-write problems remain pending. Completed actions retain separate request receipts, allowing a later loan of the same battery to be returned in the same station while suppressing repeats of the reviewed loan action. A battery that has been returned may also be checked out again without restarting the checkout station.

A scanned return can include an optional reviewed room/version. Its room and parent-building versions are guarded in the same atomic batch as the loan close, observation inserts and audit events. The evidence records server confirmation time, source and room/building label snapshots. Demonstration placement is labelled simulated; live placement requires a selectable non-placeholder J18 room. Unspecified placement appends no location observation. Registered storage remains unchanged. These changes use existing operations, observations and audit tables and require no migration.

Reviewing a rejected placement does not change its captured room or retry payload. After explicit discard, the station uses the reviewed room directory and requires a new deliberate room choice, including an explicit Room unspecified choice when no placement is intended. Earlier receipts retain their placement evidence. Same-tab recovery retains this confirmation requirement; if its reviewed directory is unavailable after remount, staff reload current return rooms before choosing again. Unavailable and live placeholder rooms remain excluded.

Only the most recent loan is eligible for correction. A mistaken active checkout is marked corrected; a mistaken return is reopened. The request freezes the intended correction action and reviewed return timestamp, and the commit guard checks both. A concurrent return cannot turn a void-checkout draft into a reopen-return action. The audit records the reason and pre-correction values. Existing transactions are not deleted.

Migration 0006 adds nullable people/loan account references and immutable association/evidence triggers without rebuilding tables or backfilling old borrowers. Old names, timestamps, actors, returns and corrected loans remain unchanged. Account disablement does not remove historical responsibility; other active staff can receive its return.

## Location and charging

Loan state is independent of observations. Latest location sorts by observation time, then receipt time and insertion order. Delayed older evidence cannot replace newer evidence. Observation time and source always travel with the room.

Storage uses a building plus an optional room. J18 Willis Annexe, E10 Hilmer Building and G17 Electrical Engineering Building are reference configuration, never evidence of physical presence. Only J18 is enabled for new battery and room registration/import. Demo room and Demo workspace are explicitly marked placeholders in both inventories; unknown assigned rooms can still be SQL NULL. Other building choices are disabled and room information is Not available. Rooms have stable IDs and numbers unique within their building. A selected room must be selectable and belong to the supported building and inventory. Renaming alone preserves its placeholder flag; verification is an explicit administrator action.

Migration 0007 adds constrained boolean room flags without rebuilding tables. It preserves existing identities, versions and evidence and accepts explicit placeholder labels in the existing observation-integrity guard. The local preview uses fresh disposable test business state; no compatibility-owner mapping field or legacy-borrower UI category was introduced.

New observations store the room number/name and building code/name when evidence is received. Both room and building versions, observation and audit event are checked and committed together. Later room or building edits do not change those stored labels. For a delayed observation, this snapshot does not reconstruct the room's name at an earlier observation time.

Older observations without saved labels retain their room ID and display that the original label is unavailable. The migration does not guess historical names. Location evidence is appended; existing observations cannot be rewritten.

New charge records pair a positive finite duration in minutes with completion time. Latest duration and time come from the same row, ordered by completion rather than receipt time. The software accepts durations up to 525,600 minutes as a data validation ceiling, not as a battery safety recommendation. Original percentages remain in legacy database/history records; they are no longer accepted in new charge submissions or displayed as charging information. Existing unknown durations remain NULL. Charge evidence is appended and cannot be rewritten. Sydney date entry is converted to UTC and rejects skipped/ambiguous daylight-saving times.

## Metadata and relationship integrity

Buildings, rooms and batteries have a version number. Their edits must submit the version loaded by the form. A stale edit returns HTTP 409 with `record_conflict`; it changes neither the record nor its audit history. A transaction guard verifies the version again when the write commits, so a change between validation and persistence is also rejected. Staff directory projections are read-only; staff identity and profile edits use the separate account-management workflow.

New CSV battery imports save one registration event per battery and an identified batch summary in the same guarded transaction as their records. Each registration links to its import request and retains the initial normalized values and native operator. Battery details and exports include only batch summaries linked through that battery's registration evidence. Unlinked older global import summaries remain in shared Activity; the system does not guess which batteries they registered.

The form keeps the staff member's input after a conflict. Loading the latest record retains other users' changes to untouched fields and keeps the staff member's edited fields. If both changed the same field, the form shows the saved value alongside the current proposal. The staff member reviews and explicitly saves the result.

Versioned database triggers enforce record identity, version increments and same-inventory relationships even for direct SQL writes. A responsible battery owner must be a staff record and cannot be demoted while responsible for a battery. Battery storage rooms, loan borrowers, observations and charging records must belong to the same inventory as the battery. Future table rebuilds must recreate these trigger constraints.

Existing metadata and history identifiers cannot be inserted again through SQLite replacement or upsert statements. This prevents bypassing update guards and prevents a duplicate RFID identifier from deleting another battery. Metadata changes use ordinary versioned updates; observation evidence uses new identifiers.

Migrations 0001 and 0002 add integrity guards without rebuilding business tables. Migration 0003 adds buildings, room hierarchy and charging duration, and rebuilds batteries to allow an unknown room. It runs in one D1 transaction with deferred foreign-key validation; existing child references use NO ACTION, identities/versions and rows are copied, and every affected trigger/index is recreated before validation resumes. It does not disable foreign keys or edit earlier migrations. Migration tests retain old loans, observations, charging percentages and audit events and check for foreign-key violations. See [Cloudflare D1's foreign-key guidance](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) and [SQLite's table-change procedure](https://www.sqlite.org/lang_altertable.html). Constraint failures use SQLite's [trigger error mechanism](https://www.sqlite.org/lang_createtrigger.html).

## Usability decisions

- The checkout holder is the signed-in staff member and needs no entry.
- Selected batteries appear first; optional search/manual tag lookup adds already registered batteries.
- The independent return shortcut starts with the current staff member's loans and can show all holders; explicit row selections are retained.
- Unknown or duplicate tag identifiers produce visible messages before confirmation.
- Searchable registered records reduce typing; CSV import supports initial setup.
- Invalid input remains in the form for correction.
- If a write succeeds but the following refresh fails, the message says the write succeeded and requests a refresh.
- Base UI combobox popups render inside the form's container to cooperate with Radix dialog focus/dismissal.
- Browser tools can read inventory or stage a review. They cannot commit a loan; a staff member confirms through the visible interface.

## Access and operational limits

Native application accounts are required for this release. Administrators create accounts; public sign-up and implicit first-visitor administration are absent. The initial administrator requires an installation setup secret and a newly chosen password. A local launcher generates an ignored development setup key; no production password or key is embedded in source.

Passwords use independently salted PBKDF2-SHA-256 with 600,000 iterations. The installed local Worker runtime was checked with this setting; any future deployment needs runtime and security review. The choice follows [OWASP password-storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Only hashed random session tokens are stored in D1. Cookies use HttpOnly, SameSite=Strict, an eight-hour lifetime and Secure on HTTPS. Native session checks reject expired, disabled or superseded authorization versions on every API request. Password changes/reset, disabling and role changes revoke previous sessions. Failed sign-ins are throttled per username after ten failures in a fifteen-minute window; this is not a claim of comprehensive attack protection.

Server role checks distinguish registration from editing. Staff may read/export all business records, create batteries and confirm checkout/return. Administrator maintenance includes saved metadata, buildings/rooms, charge/demo-observation evidence, reasoned history corrections and account management. The staff directory is read-only; editable standalone people registration/import is disabled. New battery owners must be active native staff accounts, rechecked at commit alongside the actor's active state, authorization version and role. Own-profile operations cannot change role/access or another person's account. Account lists/audit are administrator-only. Permission checks are independent of hidden buttons.

Account edits use an expected version and atomic audit guard. Direct database triggers prevent deletion/replacement of account identities, account-audit rewrites and removal of the last active administrator. Disabled identities remain for attribution. Inventory history uses stable actor IDs and the name recorded at the time; later profile edits do not rewrite events.

API writes validate origin, JSON content and request size. SQL parameters are bound. Downloads require native sessions and return no-store HTTP attachments; credentials and session rows are not exported. The old hosting contract remains isolated in `lib/platform/auth-contract.ts`, preserving external protocol identifiers. Its headers and old mock cookie no longer grant access, and mock authentication is disabled in local Vite configuration.

## Shared refresh and exports

Snapshots read their related view tables in one D1 batch. Each server-generated export similarly reads inventory, complete evidence tables and directories together. A single Filter panel and the three status tabs use one shared schema/query for counts, pages and exports, with explicit unknown handling. Applied filters exposes active conditions above results. Chemistry/model values come from saved records; current-holder filters use account IDs. Timestamp ranges compare Sydney calendar dates; manufacture age uses one captured calculation date shared by filtering and exported age fields. Summary and detail scopes cover captured selected IDs, all matching batteries or the requested page; details also cover one ID. Nine section checkboxes determine included fields and history tables. All relevant stored history columns are retained. Credentials and sessions are excluded.

For personal exports, the viewer account comes from authenticated server context. Client-supplied viewer IDs cannot alter it. Explicit selected IDs and single-battery requests ignore ordinary filters and pagination but must remain in the current fixed personal base. A return or owner reassignment that moves any selected battery outside that base produces HTTP 409 for the whole export; an unavailable single battery produces HTTP 404. The UI retains its draft and selection with a visible error. Directory-list exports include native staff projections; detailed related-directory evidence remains complete for the requested records. The staff directory displays its Owner ID (CSV), account username and active state; only an active owner's directory ID is suitable for new battery imports.

Detail screens show at most 200 recent entries per section for readability. Export reads have no such limit. Excel contains separate tables/worksheets and metadata; JSON preserves table structure. CSV supports flat reports and is rejected for detailed requests that would otherwise lose tables. CSV formula-like text is neutralized. Long Excel text is losslessly split into numbered parts in a Complete text worksheet. The published ExcelJS browser bundle encodes complete XML strings as UTF-8 bytes before ZIP chunking, preserving Unicode surrogate pairs across archive boundaries without global patches. Worksheet row-limit overflow produces an explicit error and a JSON alternative.

Downloads are generated on the server and delivered as HTTP attachments. The interface submits one POST with the requested format, validates the actual response and reads its complete file body before triggering browser saving. Failure preserves the dialog, chosen scope and sections with a visible error. The older GET attachment and POST JSON-document routes remain available. Screen counts can differ from the file if another staff member changes inventory meanwhile. Export metadata records the generated scope, counts, selected sections and UTC time; it does not claim a frozen snapshot of the earlier screen.

Periodic task and Message JSON downloads use the same attachment reader. They validate HTTP status, MIME type, attachment disposition, complete JSON, inventory/scope and exported counts before initiating a browser download. Errors remain visible without resetting the search or task/read filters. Successfully reading an attachment does not establish that the operating system finished saving it.

Battery details read the current battery and its bounded histories together in one D1 batch. Refresh details updates metadata, status, holder and evidence from that response; the asset editor receives the refreshed record and its version.

The visible idle interface polls every ten seconds and on focus. Polling pauses around inventory draft dialogs, and changed data cannot silently discard selection or advance a form's loaded version. Stale requests cannot replace a newer loaded dataset. Personal profile conflicts preserve edited fields for a reviewed reload. This is eventual interface refresh; server state and conflict checks apply when each request commits.

## Operational release limits

Institutional identity/hosting approval, UNSW SSO, backup/restore and retention policy, large-load capacity and administrative tamper protection are not delivered by this prototype. Audit history is application-preserved, not a cryptographically immutable compliance ledger. Two-account shared behavior and contested D1 transactions have been tested; no departmental-scale traffic study or stakeholder efficiency experiment has been performed. This release stays local; old hosted environments were not updated.

## Visual reference

The design uses the public [UNSW JAGGAER quick reference guides](https://www.unsw.edu.au/assurance-integrity/safety/systems/Jaggaer/qrg), especially [Container Operations](https://www.unsw.edu.au/content/dam/pdfs/planning-assurance/safety/jaggaer/7-Container-Operations.pdf). The reference supplies visual conventions; it does not establish an integration contract. The live protected JAGGAER application was not accessed.
