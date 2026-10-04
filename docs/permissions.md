# Permission baseline

Reviewed 4 October 2026 against application 0.6.1, source `14e18151e52184b24d4b941f1057c78c34a88b09`.

This document consolidates the implemented account, record-scope and operation rules. It is the current reference for permission descriptions in the project. The subsequent local interface update uses these same rules to distinguish Staff and Administrator navigation and controls. It does not grant or remove business privileges, alter hosted data, publish source or update the hosted application. The remaining alignment issues below are explicitly outside this interface update.

The later local custom-task and readable-report work keeps these authority boundaries. Start from scratch is an administrator task-configuration entry; an optional template is not a permission requirement. Excel presentation and hidden evidence worksheets change how authorized downloads are read, not which records an account can obtain. Local migration 0016 expands the stored task category without altering task ownership or completion rules.

## Roles and identity

There are two login roles: **Administrator** (`admin`) and **Staff** (`staff`). Both require an active native account and a valid session. Administrators have the ordinary operational capabilities plus administrative capabilities. An unauthenticated visitor or disabled account has no business-data access.

Responsible owner, current holder, task assignee and teaching-group owner describe relationships to records. They are not additional login roles. Being an asset's owner or creator does not grant permission to edit its saved metadata. The `people.role` directory field is not the account's authorization role: administrators also have a staff directory projection. Authorization uses the native account identity and role, never a display name.

The application does not currently implement student, read-only viewer, technician, inspector or super-administrator roles.

## Record visibility

| Record or view | Staff | Administrator | Boundary |
| --- | --- | --- | --- |
| Working and Demonstration inventories | View both shared inventories | Same | Separate datasets; neither is private to an account |
| Battery details, movement summaries and complete history | View and export shared records | Same | Includes retained retired assets |
| Activity history | View and export shared operations | Same | Includes the message-action metadata described below |
| My batteries, My batteries in use and My activity | Own identity determines the filter | Same | Shortcuts over shared records, not access restrictions on the complete inventory |
| Staff directory | View and export | Same | Native account projections; snapshot directory includes identity, name, username and active state, not credentials |
| Recurring plans and cycles | View and download shared Current and Removed records in Excel/JSON | Same | Task assignment limits completion, not visibility; custom and prepared plans have the same boundary |
| Messages | Read, mark read, remove, restore and export own messages in Excel/JSON | Own messages only | Other inboxes are inaccessible; related operation metadata is currently shared |
| Teaching-group definitions | Own account and dataset only | Own account and dataset only | Definition history is retained privately with no history browser or export endpoint; actual group inventory operations expose their historic group name and affected assets in shared Activity |
| Account list, account downloads and account-management audit | No | Yes | Download Excel report or the retained CSV endpoint exports permitted account rows only; the separate account audit displays the latest 200 events |

A preferred starting inventory changes navigation only. Both roles retain access to both datasets. Export scope follows the selected inventory and view. Personal and group exports resolve the current account on the server; they do not accept a substitute viewer identity.

Readable Excel reports start with Report guide and business worksheets; the original technical records remain in initially hidden Evidence sheets, accessible through Excel's Unhide action. Hiding those sheets is a reading aid, not an access control. Workbook and JSON evidence retain the same authenticated scope, including selected sections and complete matching histories. Shared directory reports retain Owner ID for imports and Room ID for imports; these references do not grant account authority. Credentials and sessions remain excluded from downloads.

Account Excel and CSV downloads remain administrator-only and retain the account view's search boundary. Both export the permitted profile, role, active state, preference and record dates; authorization versions, passwords/hashes and sessions are excluded. The workbook's Evidence Accounts sheet uses the same permitted fields, so Unhide cannot reveal additional account secrets or private inbox content.

## Inventory operations

These permissions apply to both datasets unless a row explicitly says otherwise. A role permission does not bypass required state, identity or concurrency guards.

| Operation | Staff | Administrator | Conditions |
| --- | --- | --- | --- |
| Register a battery or import new batteries by reviewed CSV | Yes | Yes | May select any eligible active staff owner; registration does not grant later edit rights |
| Edit saved battery specifications, owner, storage, tag or dates | No | Yes | Active asset and reviewed version required |
| Check out available batteries individually or in batches | Yes | Yes | Current holder must be the signed-in account, including when the operator is an administrator |
| Return a borrowed battery | Yes | Yes | May receive another holder's battery; must match the reviewed battery and current loan |
| Confirm optional placement during a scan-return session | Yes | Yes | Dated source evidence; does not change registered storage; working inventory rejects placeholder rooms |
| First-time batch scan intake | Demonstration only | Demonstration only | Account-bound session, explicit reviewed registrations and original-request recovery |
| Scrap or permanently remove assets | Yes | Yes | May include another owner's assets; active assets must have no current loan and match reviewed versions and tags |
| Add historical charging records | No | Yes | Active asset; duration and completion time required |
| Add a standalone location observation | No | Demonstration only | Real RFID ingestion remains unavailable |
| Correct eligible checkout or return history | No | Yes | Latest eligible loan, exact reviewed state and a recorded reason; original evidence retained |
| Create reusable battery-model templates | Yes | Yes | Shared templates; model evidence does not identify a physical asset |
| Edit saved battery-model templates | No | Yes | Also applies to templates created by the current staff member; edits do not update existing batteries |
| Add, edit or import buildings and rooms | No | Yes | Version, hierarchy and current J18 selection restrictions still apply |
| Initialize example inventory | Demonstration only | Demonstration only | One-time initialization, not a reset or deletion operation |

Teaching-group membership supplies a selection boundary, not additional authority. Both roles may perform their permitted movements and retirement operations in their own groups. Only administrators may apply a common owner, registered storage, charging record or standalone demonstration observation to group members.

## Tasks and personal work

| Operation | Staff | Administrator | Conditions |
| --- | --- | --- | --- |
| Create, configure, assign, activate or pause custom or prepared task plans | No | Yes | All five custom target kinds and one-off/recurring schedules retain target, applicable basis, date, reminder and active-assignee validation |
| Remove or restore a recurring plan | No | Yes | Shared recoverable change with reviewed version and retained history |
| Complete an open cycle | Currently assigned staff | Any eligible open cycle | Current assignment applies; removed plans block completion for everyone |
| Read or remove a reminder | Own message only | Own message only | Does not complete or cancel its task or affect another recipient |
| Create, edit or remove teaching-group shortcuts | Own groups only | Own groups only | Group definitions are private; removing a group does not remove its batteries |

Pausing a plan stops new cycle generation and reminders but does not prevent completion of an existing eligible open cycle. Removing the plan also blocks completion and editing until restoration. Restoring it retains the original configuration state, existing cycle and deadline. Completion records the actual actor and time; it is not a per-battery safety-test result.

Create task offers Start from scratch for a Custom task and three optional templates. Both paths use the same administrator-only save and activation checks. One explicit date creates a one-off task schedule; it does not grant additional completion authority. Editing the plan category preserves existing cycle instructions and historical evidence. Staff may view the resulting plan and complete an eligible assigned cycle but do not see configuration controls.

## Account administration

| Operation | Staff | Administrator |
| --- | --- | --- |
| Change own display name, email and starting inventory | Yes | Yes |
| Change own password using the current password | Yes | Yes |
| Create accounts or change another account's profile, role or active state | No | Yes |
| Reset an account password administratively | No | Yes |
| View stored plaintext passwords or session tokens | No | No; hashes are stored |
| Change an existing username, account ID or creation time | No | No |
| Delete an account or its account-management history | No | No; disable access while retaining evidence |
| Disable the signed-in account through account administration | No | Must ask another administrator |
| Disable or demote the last active administrator | No | Blocked |

Role changes, disabling and password changes/reset invalidate the affected account's sessions. Disabled accounts and their historic actor references remain recorded. Access revocation takes effect on subsequent server requests; it cannot retract already displayed or downloaded data. Self-profile updates cannot change role or active state. Initial installation requires a configured setup key and an empty account store; there is no public self-registration or default production password.

## Removal and recovery meanings

| Record | Meaning of removal | Current recovery |
| --- | --- | --- |
| Personal message | Moves the recipient's copy to Removed | Recipient may restore it |
| Recurring plan | Stops generation and blocks editing/completion while retaining all evidence | Administrator may restore it |
| Teaching group | Archives the private shortcut; assets and business history remain | No restore operation in the current API or interface |
| Battery | Records a terminal scrapped or permanently removed lifecycle state | No restore operation; identity, tags and full history remain retained |
| Staff account | Disables future access while preserving identity and evidence | Administrator may re-enable it |

None of these supported operations authorizes deleting recorded business history. Administrators can make the supported reasoned loan corrections; they cannot arbitrarily rewrite or erase historic transactions through the application.

## Role-specific interface

The interface uses [the role capability catalog](../lib/permissions.ts) for navigation and administrative controls. A role does not replace record eligibility, current task assignment, dataset restrictions or server authorization.

| Area | Staff interface | Administrator interface |
| --- | --- | --- |
| Shared workspace | Inventory, teaching groups, intake/removal, checkout, return, Activity and recurring tasks | Same daily workflows |
| Reference records | `Directories`, with read-only saved records and downloads; battery registration/import remains available | `Manage records` in `ADMINISTRATION`, with permitted saved-record editors |
| Accounts | `My account` in `MY WORK` | Own account plus `Staff accounts` in `ADMINISTRATION` |
| Battery details | Shared information, movement summary and full history | Same information plus eligible metadata, charging, correction and demo-observation controls |
| Reusable models | Create or apply a model | Create, apply or edit a saved model |
| Teaching-group operations | Own groups, permitted checkouts/returns and retirement | Same scope plus administrative member maintenance |
| Recurring tasks | Shared plans/cycles, recommended Excel or technical JSON downloads, read-only plan details, completion when currently assigned | Same shared records plus Create task, Start from scratch, optional templates, plan configuration, removal/restoration and eligible cycle completion |
| Personal work | My batteries, My batteries in use, My activity, Messages and My account | Same identity boundaries; no access to another inbox or private group |

Controls outside the current role are hidden. Permitted controls may remain disabled while data loads or a workflow/record is ineligible, with the existing state explanation. A preserved uncertain request remains recoverable; a role change must not silently erase it. Its original account and server guards still apply. Page-level scan shortcuts appear on inventory, teaching-group and My activity pages. My activity also offers reviewed single-battery checkout/return beside current battery status; the recorded historical action remains unchanged. Shared Activity history stays read-only. Mobile navigation follows the same role boundaries and closes after a destination is chosen.

## Remaining alignment issues and recommended follow-up

1. **Message privacy has a visible limit.** Inbox queries and mutations are restricted to the recipient, but message read/remove/restore events are stored in shared `audit_events`. Other staff can see actor, time, action and identifiers through Activity or its export. The message body is not exposed by those events; related task content is already shared. Recommended follow-up: decide whether personal inbox operation metadata should also be private, then consistently adjust activity queries and exports while preserving stored evidence. No such filtering change is implemented by this review.
2. **The staff-directory contract retains old administrator write paths.** The interface presents an account-derived read-only directory, but `/api/inventory` still accepts administrator-only `person` saves and `import` with `kind: people`. These paths can create unlinked directory rows; they do not create login accounts and cannot make an unlinked person an eligible native owner or holder. Recommended follow-up: retire these old entry points and keep native account administration as the supported source of staff identity, preserving historical rows. Staff cannot use these administrator paths.
3. **Lost administrator access can delay recovery.** Group maintenance and saved-model updates check Administrator authority before replaying an earlier receipt. If that same account is downgraded after an uncertain response, its original pending payload is retained and exact retry remains available, but resolving it may require restoration of the original administrative access. The interface update does not bypass this server check or discard the request.

The current broad staff retirement permission is intentional and covered by the project requirements. Restricting retirement to owners or administrators would be a new business-policy decision. Likewise, adding inspector or viewer roles, an approval hierarchy, per-battery safety-test records or a lending hold requires separate requirements; none is implied by this consolidation.

## Enforcement and evidence

Request authentication resolves the native account before feature services perform role and record-scope checks. Relevant writes retain account/version, exact-request and battery/loan guards at their transaction boundaries. Hiding a control is a usability measure, not authorization. The interface capability catalog preserves these server and transaction checks; it does not replace them.

The baseline review inspected current source and existing test assertions. Validation of the subsequent local interface update is recorded separately in [validation](validation.md); no penetration test or hosted mutation is implied. The principal implementation references are:

| Area | Implementation and existing tests |
| --- | --- |
| Native identities, profiles and account authority | [Accounts](../lib/accounts.ts), [account API](../app/api/accounts/route.ts), [staff tests](../tests/staff.test.mjs) |
| Shared inventory and personal export scopes | [Inventory queries](../lib/server/inventory/queries.ts), [exports](../lib/exports.ts), [personal inventory tests](../tests/personal-inventory.test.mjs) |
| Registration, movement and retirement | [Registration](../lib/server/inventory/registration.ts), [movements](../lib/server/inventory/movements.ts), [lifecycle](../lib/server/inventory/lifecycle.ts), [lifecycle tests](../tests/lifecycle-store.test.mjs) |
| Saved maintenance and directories | [Maintenance](../lib/server/inventory/maintenance.ts), [directories](../lib/server/inventory/directories.ts), [imports](../lib/server/inventory/imports.ts) |
| Models and intake | [Model store](../lib/battery-model-store.ts), [intake store](../lib/intake-store.ts), [model tests](../tests/battery-model-store.test.mjs), [intake tests](../tests/intake-store.test.mjs) |
| Plans, completion and personal Messages | [Task store](../lib/task-plans.ts), [Messages API](../app/api/messages/route.ts), [task tests](../tests/task-plans.test.mjs) |
| Private teaching groups and shared group operations | [Group store](../lib/teaching-group-store.ts), [group tests](../tests/sorting-teaching-groups.test.mjs), [group operations tests](../tests/group-workspace.test.mjs) |
| Visible navigation and operation controls | [Application shell](../components/application/application-shell.tsx), [record management](../components/inventory/record-management.tsx), [HTTP checks](../tests/api/smoke.mjs) |
