# Battery Inventory

A staff work platform for the DESN2000 battery-management design project. Its primary aim is to reduce routine staff work while keeping responsibility, lending and dated location evidence traceable.

The frozen **0.6.0** release reorganizes the existing staff workflows into explicit application, client, inventory-service and visual-system modules. The yellow-and-ink interface uses a shared theme across the inventory, workstations, tasks, dialogs and sign-in. Operational text and table cells use 14px text, supporting hints use 13px and compact labels use at least 12px; darker secondary text improves contrast while preserving the existing theme. See the [architecture map](docs/architecture.md), [design system](docs/design-system.md) and [release record](docs/releases/0.6.0.md).

Release **0.6.0** uses branch `battery-staff-platform-v0.6.0` and annotated tag `battery-inventory-v0.6.0-freeze-20261003`. It includes recoverable personal Messages and shared recurring-plan removal, clearer task completion, model-assisted registration, reviewed intake/removal, manual scan selection and the primary Teaching groups workspace with recorded group activity. The preceding [development snapshot](docs/releases/2026-10-03-teaching-groups.md) remains available on `battery-staff-platform-teaching-groups-20261003`.

The original **0.5.0** source remains at Git tag `battery-inventory-v0.5.0-freeze-20261003`, on branch `battery-staff-platform-v0.5.0`. See [that release record](docs/releases/0.5.0.md) for its frozen scope. Shared native staff accounts, role permissions, editable responsibility, battery age, personal inventory/activity views and complete exports continue in the current snapshot. Source publication does not deploy the application or include any local business database.

The frozen source also includes **Recurring tasks**, **Messages** and a persistent **Scan checkout / Scan return** station, with reviewed batches, exact-request recovery and cleanup of successfully processed selections. The [task and Messages plan](docs/messages-and-reminders-plan.md) describes the implemented workflow and remaining email/scheduler conditions. Reminders are evaluated during authenticated use; email and unattended delivery are unavailable.

Release 0.6.0 replaces the station's right-side simulator controls with **Manual selection**. Both inventories support selecting tagged or untagged batteries, searching the candidate list and clearing filters without losing selections. Saved movements identify this input as Manual selection. The frozen 0.5.0 tag remains unchanged.

The [staff workflow demonstration and guide](docs/staff-workflow-demo.md) provides a four-scene presentation script and a daily quick guide for batch borrowing and returns, shared tasks, selections across pages and periodic task templates.

## Use the local prototype

Open http://127.0.0.1:5173/ and sign in with an account provided by an administrator. The current local review has fictional **admin** and **staff-demo** accounts; their credentials are in ignored `work/local-access.txt`. These are local test accounts, not production defaults.

All active staff see the same **Working inventory** and the same separate **Demonstration inventory**. Accounts have individual profiles and a preferred starting inventory. Demonstration battery specifications and activity are fictional; its responsible owners and holders are explicitly linked local test accounts. J18 rooms are placeholders awaiting confirmation.

| Action | Staff | Administrator |
| --- | --- | --- |
| View, filter and download all business records | Yes | Yes |
| View/download shared periodic plans and cycles | Yes | Yes |
| Configure, remove and restore shared periodic plans | No | Yes |
| Complete a reviewed task cycle | Currently assigned tasks | All tasks |
| Read, remove, restore and download own Messages | Yes | Yes |
| Register new batteries, including reviewed CSV creation | Yes | Yes |
| Save reusable battery models | Yes | Yes |
| Save, edit and remove own teaching battery groups | Yes | Yes |
| Edit saved model templates | No | Yes |
| Confirm checkouts and returns | Yes | Yes |
| Scrap or permanently remove returned assets | Yes | Yes |
| Edit saved battery metadata; maintain buildings and rooms | No | Yes |
| Record historical charging and demo observations; correct eligible loan history | No | Yes |
| Create, disable or change staff accounts | No | Yes |
| Edit own profile/preferences and change own password | Yes | Yes |

**Register battery** now offers model search and reviewed specification filling. Choose an existing research reference, saved staff template or consistent registered-model suggestion. All staff can add reusable models; administrators can correct saved templates. Individual IDs, owners, tags, dates and locations are entered separately, and conflicting manual values are preserved unless explicitly replaced. Unknown or self-built batteries can still be registered manually. See the [model registration guide](docs/model-registration.md).

**Intake & removal** is one sidebar shortcut with **New battery intake**, **Retire or remove** and **Removal history**. In **Start demo intake**, set common details once and scan into an editable pending list; **Confirm all / Confirm selected** registers the reviewed entries individually with permanent automatic IDs. Device scan time and server registration time remain separate; service start defaults to confirmed registration, while unknown manufacture age remains unknown. Both staff and administrators may scrap or permanently remove returned assets in batches using **Confirm selected / Confirm all queued**; Reason is optional. Archived records and complete downloads remain available. See the [intake guide](docs/batch-intake.md) and [retirement/removal guide](docs/battery-removal.md).

1. Open **Scan checkout** or **Scan return** for a station that stays open until **Exit scanning**. Enter a registered tag on the left or choose batteries under **Manual selection** on the right; selection does not require a registered tag. In Continuous mode, **Check out selected / Return selected** processes the chosen batteries individually. In Batch mode, **Add selected to queue** prepares the review list and **Confirm batch** saves it together. Use one input method per batch. Success appears only after the server confirms a saved transaction, then completed choices are cleared. Repeated input does not duplicate the same loan action. Checkout belongs to your own signed-in staff account; returns may receive another holder's battery. Select a return room once for the session or leave it unspecified. This dated staff confirmation does not change registered storage or establish hardware evidence. Earlier simulated history retains its original source. Existing row-based **Check out selected / Return selected** actions retain their reviewed-list dialog.
2. Open a battery ID to inspect specifications, manufacture age/time in service, its responsible owner, current holder and recorded histories.
3. Keep **All batteries / In store / In use** as quick tabs. Open **Filter** for a visible search box and initially collapsed **Battery details**, **Location**, **People**, **Age & activity**, **Teaching groups** and **Sort order** categories. Choose ascending/descending Battery ID, name, dates, ages, capacity, voltage or charging duration; unknown values stay last and equal values use Battery ID order. Titles show applied condition counts, and collapsing a category preserves its criteria. **Applied filters** supports individual removal and **Clear filters**. Pagination offers 10, 25, 50 or 100 batteries per page; sorting precedes pagination and is retained in filtered and selected downloads.
4. Click the battery name, status, location or blank space in its row, or use its checkbox, to select or deselect it. Choose **Download selected** for summaries or complete selected details, including selections across filters/pages. Clicking the battery ID opens details without changing selection. The download dialog also offers all filtered results or the current page. **Download details** on one battery selects its information sections; **Select all information** includes all sections. A movement is limited to 100 batteries, while selected downloads do not inherit that limit.
5. **My batteries** shows assets for which your account is the responsible owner, with In store / In use counts. **My batteries in use** shows your active recorded checkouts. Filters and downloads work within either personal view. These shortcuts do not restrict shared access. Use **My account** for preferences; administrators maintain accounts and saved records. The staff directory is read-only and follows native accounts.
6. **My activity**, under **MY WORK**, shows inventory operations performed by your signed-in account; **Activity history** shows everyone's inventory operations. Both support search, historic-group filters, selection and complete downloads. Group operations appear as one expandable entry with original member evidence. Download group summaries as Excel/CSV/JSON, or include member actions and selectable full battery sections as Excel/JSON. Personal activity follows the recorded operator account ID, including operations on someone else's battery; it does not include account-management or sign-in records.
7. **Recurring tasks** shows shared periodic plans and recorded cycles under **Current / Removed**. The initially collapsed **Prepared periodic tasks** library offers weekly storage-area review, teaching-period inventory reconciliation and applicable six-calendar-month storage maintenance review. Administrators confirm dates, applicability, reminder time and assignments before activation; all staff can view/search/download matching plans and their full cycle history. Administrators can **Remove** a plan after review and **Restore** it from Removed. Removal preserves its original draft/active/paused state, open cycle, recorded due date, assignments and completion history. While removed, the plan cannot be edited, generate cycles/reminders or have an outstanding task completed. Restore returns the same plan and existing cycle; later generation follows its retained state and recurrence. Actual procedures and real battery data remain pending.
8. **Messages** is your persistent personal inbox with **Inbox / Removed** locations. Each card keeps its actions visible: **Complete task** for an eligible open task, **View completion** for a completed task, or **View task** with a visible reason when completion is unavailable. All / To do / Completed filters task state; All read states / Unread / Read independently filters reading. **Mark read** records only your read state. **Remove** moves only your copy into Removed; **Restore** returns that same message with its content, creation time, read history and linked task unchanged. Removal does not cancel or complete shared work or affect another recipient. The sidebar red dot counts unread messages still in your Inbox, independently of the visible filters or task completion. Task details show the deadline and assignments first, keep recorded requirements initially collapsed and retain the completion controls below the scrolling body. Assigned staff or administrators must explicitly confirm actual completion. Notes are optional up to 2,000 characters; completion time and operator are always retained. Completion does not certify battery safety.

Every search/filter area includes **Clear filters**, including option-search popups. Resetting preserves the selected inventory, fixed personal or opened-group scope, chosen batteries and unrelated form values. Messages reset returns to All tasks and All read states while retaining Inbox or Removed; a filtered download includes only the resulting matching messages in that location.

Working inventory has no batteries until actual records are supplied. Both inventories contain reference building names **J18 - Willis Annexe**, **E10 - Hilmer Building** and **G17 - Electrical Engineering Building**, verified from [UNSW's makerspace directory](https://www.making.unsw.edu.au/makerspaces/about/). Only J18 is enabled; other buildings are greyed out and their room information is **Not available**. J18 contains **Demo room** and **Demo workspace**, explicitly marked **Placeholder**. These labels are not verified storage locations or RFID evidence. Room names can be updated later; renaming alone does not remove the placeholder flag.

Responsible owners come from active native staff accounts. Each account has an explicit inventory directory projection; names are never used to infer identity. New batteries require J18 and may leave the room, specifications, dates and RFID identifier unknown. The local disposable test business database was rebuilt for this iteration instead of adding legacy-borrower compatibility features. Existing local test accounts remain usable, and subsequent operations retain normal history.

## Download behavior

Persistent scan, intake and retirement/removal workspaces now keep a prominent sticky exit/return bar visible while scrolling. **Exit scanning**, **Exit intake** and **Back to inventory** retain their existing recovery/confirmation restrictions; the bar explains a blocked exit. Intake and removal drafts remain in this tab after leaving their workflows.

**Filter → Location → Last observed location** narrows results by each battery's latest recorded room, separately from registered storage. **Not observed** and **Recorded address unavailable** distinguish missing readings from older readings without saved address labels. Applied filters, Clear filters, personal views, pages and downloads share this criterion. Results retain recorded labels, time and source; room renaming does not rewrite previous observations.

Date and time fields use an application calendar explicitly configured for English (Australia), with **YYYY-MM-DD** dates and 24-hour **HH:mm** time controls. Date-time fields retain **YYYY-MM-DDTHH:mm** values and Sydney interpretation. This avoids the browser-locale-dependent presentation of native date controls, described in [MDN's date-input reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/date). Optional dates stay blank when cleared, and invalid or incomplete values do not acquire inferred dates or times.

Open **Teaching groups** in the sidebar to browse, create or edit your account's saved sets for the current inventory. Each opened group has status tabs, filters, ordering, selection and downloads within its fixed membership. **Check out group / Return group** prepares eligible members for one reviewed confirmation. Selected members support existing movements and staff retirement; administrators also have common owner/storage/charge/demo-observation updates and individual saved-record actions. Groups contain up to 100 batteries and persist across devices. Select candidates or completed records in scanning to add them to a group; intake additions require confirmed registrations. Choose **Process as teaching group** before scanning when the operation itself should retain group context. Shared Activity preserves the historic name and actual members through later group edits. See the [teaching groups and sorting guide](docs/teaching-groups-and-sorting.md).

Summary downloads support Excel, CSV and JSON. Single and bulk details support Excel workbooks with separate worksheets or structured JSON with separate tables. Nine selectable sections cover specifications, current responsibility, registered storage, latest evidence, complete loans, complete observations, complete charges, complete operations and related directory records. Selection is by information section, not by individual scalar field.

Selected histories include every stored record, including records older than the 200 shown in battery details. UTC timestamps, sources, corrections, operator attribution and preserved legacy charging percentages travel with their relevant records. Export metadata identifies filters, dataset, operator, scope and counts. Account credentials and sessions are never part of inventory exports.

The server reads the selected inventory and history in one D1 batch for each file. It rechecks filters and the authenticated personal scope when generating downloads. Ordinary filter/page changes retain explicit selections; if selected assets leave a personal view after reassignment or return, the download requires review instead of silently widening its scope. Data may have changed since the screen or validation request. The file's metadata and counts describe the downloaded state. Excel cell text longer than the supported limit is preserved in a **Complete text** worksheet. An export exceeding Excel's row limit is rejected with a JSON alternative, rather than silently shortened.

Task-record JSON uses the same Current/Removed location and search as the shared plans/cycles view and includes every matching plan and its recorded cycles. Messages JSON includes only the authenticated recipient's messages with the current Inbox/Removed location, task-state, read-state and search criteria. These downloads carry scope/count metadata and are separate from the nine battery-detail sections; battery downloads do not automatically include periodic tasks or Messages.

## Concurrent operation

The interface refreshes shared data every ten seconds while visible and idle, and on focus. Draft forms are preserved while open. Another operator's confirmed change may take up to the next refresh to appear; server checks apply immediately. Returns submit the exact reviewed loan IDs, and corrections submit the intended action and reviewed return state. Stale drafts are rejected; a return comparison requires explicit acceptance before its reviewed loans change. Movements up to 100 batteries remain one atomic batch. CSV imports recheck active account, role and authorization version at commit. Versioned metadata/account edits reject stale writes, and histories retain the individual operator.

The scan station freezes a captured movement while submitting and preserves its exact request for retries. Uncertain results cannot be discarded or exited until resolved. Intact unfinished queues/attempts are stored in this browser tab's session storage under the account and inventory; after a page refresh, the inventory offers **Resume checkout / return**. Closing the tab, clearing/corrupting browser storage or using another browser does not provide recovery. Saved server history remains available. Storage failure is visibly reported. Tag inputs and manual selections are processed deliberately; retained demonstration simulation requests preserve their original source. A future continuously emitting hardware reader still requires a validated adapter and event buffering.

Task and Messages views refresh every fifteen seconds while visible and idle. Task edits/completions submit the reviewed version, preserve input on conflicts and require explicit review of the latest saved state. Unchanged interrupted retries reuse a request ID. A plan has at most one open cycle; its content and due date remain recorded when the plan changes. Reminder preferences can change independently of that deadline. Calendar rules retain their original month/year anchor; completion-based rules use actual completion. Missed planning periods are never fabricated as completed reviews.

## Current limits

- No real RFID reader, tag or verified reader-to-room mapping has been connected. Demo observations remain explicitly simulated. An observation never checks an asset in or out.
- **In store** means an active asset with no current loan recorded. Scrapped/permanently removed records are excluded from the default active register; select Record status to inspect their archive. Registered storage is the home; last observed location is dated evidence, not continuous tracking or proof of physical presence.
- New charging records contain duration and completion time. Unknown historic durations and specifications stay null; legacy percentages remain available in detailed exports. There is no live charge measurement.
- Native staff accounts are implemented. UNSW SSO, institutional access approval, backup/retention policy and JAGGAER integration remain future decisions.
- One existing legacy inventory per dataset can be adopted without rewriting keys or history. Multiple legacy private inventories require reviewed collision handling before shared access is enabled; none are silently merged.
- Tests cover independent accounts and contested transactions, not departmental-scale load. Staff efficiency has not been measured; see the proposed study.
- Task intervals and procedures are provisional until confirmed for real areas/models. Working storage-area activation rejects placeholder rooms. No task or completion record establishes hardware evidence or safety certification.
- Messages are generated during authenticated requests when an active task's valid Sydney reminder time has been reached. Stopping the server or use suspends evaluation until a later request. Email preferences are saved, but no email sender or unattended scheduler is connected.
- Automatic email, student self-service and safety agents remain deferred. This source release does not deploy or update the earlier hosted service or OpenBayes. No model training is needed.

## Project map

| Directory | Purpose |
| --- | --- |
| app | Staff application, sign-in and authenticated APIs |
| components/application | Application shell, navigation, workspace headings and recovery notices |
| components/inventory | Staff forms, tables, accounts, imports and downloads |
| components/ui | Bundled Shadcn primitives |
| hooks | Browser snapshot, polling, workflow recovery and task loading lifecycles |
| lib | Accounts, validation, inventory domain, export and client utilities |
| lib/client | UI-independent request, draft and recovery contracts |
| lib/server/inventory | Composed inventory services and transactional storage helpers |
| lib/platform | Retained external protocol identifiers |
| styles | Shared theme, base rules, shell, components, inventory and workflows |
| db / drizzle | Database schema and versioned migrations |
| tests | Domain, account, export and D1 invariant checks |
| scripts | Local runtime, checks and build helpers |
| docs | Requirements, design decisions, experiment and actual verification |
| work | Ignored local credentials, database backups and QA evidence |

Read [requirements](docs/requirements.md), [architecture](docs/architecture.md), [validation](docs/validation.md), [experiment protocol](docs/experiment-protocol.md) and [open questions](docs/open-questions.md).

Detailed physical inspection lists, external email delivery and hardware integration remain outside this implementation. Periodic task records and Messages do not establish a verified operating procedure. The earlier frozen 0.3.0 source remains available unchanged.

## Local development

Requires Node.js 22.13 or newer. Preserve the supplied lockfile and runtime configuration.

```sh
npm run install:ci
npm run build
```

On a fresh database, apply migrations `0000` through `0015` once in journal order, using each SQL file's exact name. The current code requires the later model, intake, lifecycle and teaching-group tables and recoverable task-removal fields:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_military_warstar.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_inventory_integrity.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_prevent_record_replacement.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_building_rooms_charge_duration.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_staff_accounts_shared_inventory.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_battery_age_dates.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0006_staff_self_checkout.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0007_room_availability.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0008_periodic_tasks_messages.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0009_optional_task_completion_notes.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0010_battery_models.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0011_batch_intake.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0012_battery_lifecycle.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0013_optional_removal_reason.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0014_personal_teaching_groups.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0015_recoverable_task_removal.sql
npm run dev
```

On existing databases, apply only pending migrations; never rerun the initial migration. Back up existing state first. Keep local preview on loopback.

The local launcher stores a random installation setup key in ignored `work/local-access.json`, without creating a default account. On a fresh installation, use that key in the visible setup form to create the first administrator with your own password. Administrators then create staff accounts. An environment `INVENTORY_SETUP_KEY` takes precedence; a deployment must configure its own secret and HTTPS before real use. The old hosting identity headers and mock cookie do not grant application access.

Set `INVENTORY_DEV_STATE_DIR` for isolated test state, or record a project-local `stateDirectory` in `work/local-access.json`. Use the same path for Wrangler `--persist-to`. Review state and backups remain under ignored `work/qa/`. No hosted database was changed. Dev file watching excludes temporary state and backup directories.

```sh
npm run typecheck
npm test
npm run build
npm run test:api
```

Domain tests use isolated Miniflare D1 databases. API checks use the production build, apply all journaled migrations to a new local database, create temporary native test accounts and start their own loopback Worker. They do not read local-access credentials or use the normal preview database. The runner stops its own processes and keeps diagnostic evidence under ignored `work/qa/api-*`. If a Windows npm shim fails, invoke the installed npm CLI with Node rather than changing global configuration.

## Design reference

The current visual system combines a campus-inspired yellow, black and white palette with restrained typography, light surfaces and short interaction transitions. Its implementation is documented in the [design system](docs/design-system.md). Earlier table and workflow conventions drew from public UNSW JAGGAER guidance; the protected live system was not accessed. This is a student project, with no institutional endorsement or JAGGAER connection.
