# Battery Inventory

A staff work platform for the DESN2000 battery-management design project. Its primary aim is to reduce routine staff work while keeping responsibility, lending and dated location evidence traceable.

Release **0.5.0** freezes the current staff platform at Git tag `battery-inventory-v0.5.0-freeze-20261003`, on branch `battery-staff-platform-v0.5.0`. Earlier source releases and their tags remain unchanged.

This release includes shared native staff accounts, role permissions, editable responsibility, battery age, unified filters, personal inventory/activity views and selectable complete exports. See [the release record](docs/releases/0.5.0.md) for the frozen scope, verification and limits. Source publication does not deploy the application or include any local business database.

The frozen source also includes **Recurring tasks**, **Messages** and a persistent **Scan checkout / Scan return** station, with reviewed batches, exact-request recovery and cleanup of successful simulator selections. The [task and Messages plan](docs/messages-and-reminders-plan.md) describes the implemented workflow and remaining email/scheduler conditions. Reminders are evaluated during authenticated use; email and unattended delivery are unavailable.

The [staff workflow demonstration and guide](docs/staff-workflow-demo.md) provides a four-scene presentation script and a daily quick guide for batch borrowing and returns, shared tasks, selections across pages and periodic task templates.

## Use the local prototype

Open http://127.0.0.1:5173/ and sign in with an account provided by an administrator. The current local review has fictional **admin** and **staff-demo** accounts; their credentials are in ignored `work/local-access.txt`. These are local test accounts, not production defaults.

All active staff see the same **Working inventory** and the same separate **Demonstration inventory**. Accounts have individual profiles and a preferred starting inventory. Demonstration battery specifications and activity are fictional; its responsible owners and holders are explicitly linked local test accounts. J18 rooms are placeholders awaiting confirmation.

| Action | Staff | Administrator |
| --- | --- | --- |
| View, filter and download all business records | Yes | Yes |
| View/download shared periodic plans and cycles | Yes | Yes |
| Configure periodic plans | No | Yes |
| Complete a reviewed task cycle | Currently assigned tasks | All tasks |
| Read and download own Messages | Yes | Yes |
| Register new batteries, including reviewed CSV creation | Yes | Yes |
| Confirm checkouts and returns | Yes | Yes |
| Edit saved battery metadata; maintain buildings and rooms | No | Yes |
| Record historical charging and demo observations; correct eligible loan history | No | Yes |
| Create, disable or change staff accounts | No | Yes |
| Edit own profile/preferences and change own password | Yes | Yes |

1. Open **Scan checkout** or **Scan return** for a station that stays open until **Exit scanning**. Continuous mode saves each eligible entered tag immediately; Batch mode builds a review list and saves the confirmed batch together. Manual tag entry is available; the demonstration inventory also supplies simulated single/multiple/repeated/unknown reads. Success appears only after the server confirms a saved transaction. Repeated reads do not duplicate a battery within the session. Checkout belongs to your own signed-in staff account; returns may receive another holder's battery. Select a return room once for the session, or leave it unspecified; return placement is dated staff/simulated confirmation, not hardware evidence, and does not change registered storage. Existing row-based **Check out selected / Return selected** actions retain their reviewed-list dialog.
2. Open a battery ID to inspect specifications, manufacture age/time in service, its responsible owner, current holder and recorded histories.
3. Keep **All batteries / In store / On loan** as quick tabs. Open **Filter** for search, chemistry/model, building/room, owner/holder, capacity/voltage, age and activity dates. **Applied filters** above the results lists active conditions with individual removal and clear-all controls. Pagination offers 10, 25, 50 or 100 batteries per page. Counts, pages and filtered exports use the same query rules.
4. Check rows and choose **Download selected** for their summary or complete selected details, including selections across filters/pages. The download dialog also offers all filtered results or the current page. **Download details** on one battery selects its information sections; **Select all information** includes all sections. A movement is limited to 100 batteries, while selected downloads do not inherit that limit.
5. **My batteries** shows assets for which your account is the responsible owner, with in-store/on-loan counts. **My loans** shows your active borrowings. Filters and downloads work within either personal view. These shortcuts do not restrict shared access. Use **My account** for preferences; administrators maintain accounts and saved records. The staff directory is read-only and follows native accounts.
6. **My activity**, under **MY WORK**, shows inventory operations performed by your signed-in account, with search, pagination and a CSV download of the full matching history. **Activity history** continues to show everyone's inventory operations. Personal activity follows the recorded operator account ID, including operations on someone else's battery; it does not include account-management or sign-in records.
7. **Recurring tasks** shows shared periodic plans and recorded cycles. Administrators start with one of three templates: weekly storage-area review, teaching-period inventory reconciliation or applicable six-calendar-month storage maintenance review. Dates, applicability, reminder time and assignments require explicit confirmation; all staff can view/search/download the complete matching task records as JSON. Actual procedures and real battery data remain pending.
8. **Messages** is your persistent personal inbox. All / To do / Completed tabs filter task state; All read states / Unread / Read separately filter message reading. A red dot in the sidebar and beside unread subjects indicates unread messages, including any whose task is already completed. Search and a complete matching JSON download use the same criteria. Mark read records only your read state. **Open task** shows its reviewed requirements and recorded deadline; assigned staff or administrators can confirm completion after performing the task. Completion notes are optional, with a maximum of 2,000 characters. The completion time and operator are retained whether or not notes are supplied. Completion does not certify battery safety.

Every search/filter area includes **Clear filters**, including option-search popups. Resetting preserves the selected inventory, fixed personal scope, chosen batteries and unrelated form values. Messages reset returns to All tasks and All read states; a filtered download includes only the resulting matching messages.

Working inventory has no batteries until actual records are supplied. Both inventories contain reference building names **J18 - Willis Annexe**, **E10 - Hilmer Building** and **G17 - Electrical Engineering Building**, verified from [UNSW's makerspace directory](https://www.making.unsw.edu.au/makerspaces/about/). Only J18 is enabled; other buildings are greyed out and their room information is **Not available**. J18 contains **Demo room** and **Demo workspace**, explicitly marked **Placeholder**. These labels are not verified storage locations or RFID evidence. Room names can be updated later; renaming alone does not remove the placeholder flag.

Responsible owners come from active native staff accounts. Each account has an explicit inventory directory projection; names are never used to infer identity. New batteries require J18 and may leave the room, specifications, dates and RFID identifier unknown. The local disposable test business database was rebuilt for this iteration instead of adding legacy-borrower compatibility features. Existing local test accounts remain usable, and subsequent operations retain normal history.

## Download behavior

Summary downloads support Excel, CSV and JSON. Single and bulk details support Excel workbooks with separate worksheets or structured JSON with separate tables. Nine selectable sections cover specifications, current responsibility, registered storage, latest evidence, complete loans, complete observations, complete charges, complete operations and related directory records. Selection is by information section, not by individual scalar field.

Selected histories include every stored record, including records older than the 200 shown in battery details. UTC timestamps, sources, corrections, operator attribution and preserved legacy charging percentages travel with their relevant records. Export metadata identifies filters, dataset, operator, scope and counts. Account credentials and sessions are never part of inventory exports.

The server reads the selected inventory and history in one D1 batch for each file. It rechecks filters and the authenticated personal scope when generating downloads. Ordinary filter/page changes retain explicit selections; if selected assets leave a personal view after reassignment or return, the download requires review instead of silently widening its scope. Data may have changed since the screen or validation request. The file's metadata and counts describe the downloaded state. Excel cell text longer than the supported limit is preserved in a **Complete text** worksheet. An export exceeding Excel's row limit is rejected with a JSON alternative, rather than silently shortened.

Task-record JSON uses the same search as the shared plans/cycles view and includes every matching plan and its recorded cycles. Messages JSON includes only the authenticated recipient's messages with the current task-state, read-state and search criteria. These downloads carry scope/count metadata and are separate from the nine battery-detail sections; battery downloads do not automatically include periodic tasks or Messages.

## Concurrent operation

The interface refreshes shared data every ten seconds while visible and idle, and on focus. Draft forms are preserved while open. Another operator's confirmed change may take up to the next refresh to appear; server checks apply immediately. Returns submit the exact reviewed loan IDs, and corrections submit the intended action and reviewed return state. Stale drafts are rejected; a return comparison requires explicit acceptance before its reviewed loans change. Movements up to 100 batteries remain one atomic batch. CSV imports recheck active account, role and authorization version at commit. Versioned metadata/account edits reject stale writes, and histories retain the individual operator.

The scan station freezes a captured movement while submitting and preserves its exact request for retries. Uncertain results cannot be discarded or exited until resolved. Intact unfinished queues/attempts are stored in this browser tab's session storage under the account and inventory; after a page refresh, the inventory offers **Resume checkout / return**. Closing the tab, clearing/corrupting browser storage or using another browser does not provide recovery. Saved server history remains available. Storage failure is visibly reported. Simulated arrays are processed deliberately; a future continuously emitting hardware reader still requires a validated adapter and event buffering.

Task and Messages views refresh every fifteen seconds while visible and idle. Task edits/completions submit the reviewed version, preserve input on conflicts and require explicit review of the latest saved state. Unchanged interrupted retries reuse a request ID. A plan has at most one open cycle; its content and due date remain recorded when the plan changes. Reminder preferences can change independently of that deadline. Calendar rules retain their original month/year anchor; completion-based rules use actual completion. Missed planning periods are never fabricated as completed reviews.

## Current limits

- No real RFID reader, tag or verified reader-to-room mapping has been connected. Demo observations remain explicitly simulated. An observation never checks an asset in or out.
- **In store** means no active loan is recorded. Registered storage is the home; last observed location is dated evidence, not continuous tracking or proof of physical presence.
- New charging records contain duration and completion time. Unknown historic durations and specifications stay null; legacy percentages remain available in detailed exports. There is no live charge measurement.
- Native staff accounts are implemented. UNSW SSO, institutional access approval, backup/retention policy and JAGGAER integration remain future decisions.
- One existing legacy inventory per dataset can be adopted without rewriting keys or history. Multiple legacy private inventories require reviewed collision handling before shared access is enabled; none are silently merged.
- Tests cover independent accounts and contested transactions, not departmental-scale load. Staff efficiency has not been measured; see the proposed study.
- Task intervals and procedures are provisional until confirmed for real areas/models. Working storage-area activation rejects placeholder rooms. No task or completion record establishes hardware evidence or safety certification.
- Messages are generated during authenticated requests when an active task's valid Sydney reminder time has been reached. Stopping the server or use suspends evaluation until a later request. Email preferences are saved, but no email sender or unattended scheduler is connected.
- Automatic email, student self-service and safety agents remain deferred. Release 0.5.0 has not been deployed to the earlier hosted service or OpenBayes. No model training is needed.

## Project map

| Directory | Purpose |
| --- | --- |
| app | Staff application, sign-in and authenticated APIs |
| components/inventory | Staff forms, tables, accounts, imports and downloads |
| components/ui | Bundled Shadcn primitives |
| lib | Accounts, validation, inventory domain, export and client utilities |
| lib/platform | Retained external protocol identifiers |
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

On a fresh database, apply migrations `0000` through `0009` once in journal order, using each SQL file's exact name:

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
npm run dev
```

On existing databases, apply only pending migrations; never rerun the initial migration. Back up existing state first. Keep local preview on loopback.

The local launcher stores a random installation setup key in ignored `work/local-access.json`, without creating a default account. On a fresh installation, use that key in the visible setup form to create the first administrator with your own password. Administrators then create staff accounts. An environment `INVENTORY_SETUP_KEY` takes precedence; a deployment must configure its own secret and HTTPS before real use. The old hosting identity headers and mock cookie do not grant application access.

Set `INVENTORY_DEV_STATE_DIR` for isolated test state, or record a project-local `stateDirectory` in `work/local-access.json`. Use the same path for Wrangler `--persist-to`. Review state and backups remain under ignored `work/qa/`. No hosted database was changed. Dev file watching excludes temporary state and backup directories.

```sh
npm run typecheck
npm test
npm run test:api
npm run build
```

Domain tests use isolated Miniflare D1 databases. API checks require the local preview and fictional credentials in ignored `work/local-access.json`; they never target a hosted site. If a Windows npm shim fails, invoke the installed npm CLI with Node rather than changing global configuration.

## Design reference

The restrained blue controls, grey navigation and structured tables draw from the public [UNSW JAGGAER guidance](https://www.unsw.edu.au/assurance-integrity/safety/systems/Jaggaer/qrg). The protected live system was not accessed. This is a student project, with no institutional endorsement or JAGGAER connection.
