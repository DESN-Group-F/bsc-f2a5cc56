# Battery Inventory

A staff work platform for the DESN2000 battery-management design project. Its primary aim is to reduce routine staff work while keeping responsibility, lending and dated location evidence traceable.

Release **0.3.0** freezes the approved shared staff platform at Git tag `battery-inventory-v0.3.0-freeze-20261002`. The earlier prototype remains preserved at `battery-inventory-v0.1.0-freeze-20261002`, and the preceding staff release remains on `battery-staff-platform-v0.2.0`.

This release adds authenticated staff responsibility, a unified Filter panel, My batteries/My loans shortcuts, reviewed loan-state guards, battery age and selected-battery downloads. See [the release record](docs/releases/0.3.0.md) for its scope and verification. Source publication does not deploy the application or include any local database.

## Use the local prototype

Open http://127.0.0.1:5173/ and sign in with an account provided by an administrator. The current local review has fictional **admin** and **staff-demo** accounts; their credentials are in ignored `work/local-access.txt`. These are local test accounts, not production defaults.

All active staff see the same **Working inventory** and the same separate **Demonstration inventory**. Accounts have individual profiles and a preferred starting inventory. Demonstration battery specifications and activity are fictional; its responsible owners and holders are explicitly linked local test accounts. J18 rooms are placeholders awaiting confirmation.

| Action | Staff | Administrator |
| --- | --- | --- |
| View, filter and download all business records | Yes | Yes |
| Register new batteries, including reviewed CSV creation | Yes | Yes |
| Confirm checkouts and returns | Yes | Yes |
| Edit saved battery metadata; maintain buildings and rooms | No | Yes |
| Record historical charging and demo observations; correct eligible loan history | No | Yes |
| Create, disable or change staff accounts | No | Yes |
| Edit own profile/preferences and change own password | Yes | Yes |

1. Select batteries or open **Check out batteries** and confirm the reviewed batch with your own signed-in staff account. The holder is read-only. Optional **Add more batteries** searches existing records or looks up a manually entered registered tag. **Return batteries** in the sidebar starts with your outstanding loans and can show all holders; **Return selected** retains the chosen list.
2. Open a battery ID to inspect specifications, manufacture age/time in service, its responsible owner, current holder and recorded histories.
3. Keep **All batteries / In store / On loan** as quick tabs. Open **Filter** for search, chemistry/model, building/room, owner/holder, capacity/voltage, age and activity dates. **Applied filters** above the results lists active conditions with individual removal and clear-all controls. Pagination offers 10, 25, 50 or 100 batteries per page. Counts, pages and filtered exports use the same query rules.
4. Check rows and choose **Download selected** for their summary or complete selected details, including selections across filters/pages. The download dialog also offers all filtered results or the current page. **Download details** on one battery selects its information sections; **Select all information** includes all sections. A movement is limited to 100 batteries, while selected downloads do not inherit that limit.
5. **My batteries** shows assets for which your account is the responsible owner, with in-store/on-loan counts. **My loans** shows your active borrowings. Filters and downloads work within either personal view. These shortcuts do not restrict shared access. Use **My account** for preferences; administrators maintain accounts and saved records. The staff directory is read-only and follows native accounts.

Working inventory has no batteries until actual records are supplied. Both inventories contain reference building names **J18 - Willis Annexe**, **E10 - Hilmer Building** and **G17 - Electrical Engineering Building**, verified from [UNSW's makerspace directory](https://www.making.unsw.edu.au/makerspaces/about/). Only J18 is enabled; other buildings are greyed out and their room information is **Not available**. J18 contains **Demo room** and **Demo workspace**, explicitly marked **Placeholder**. These labels are not verified storage locations or RFID evidence. Room names can be updated later; renaming alone does not remove the placeholder flag.

Responsible owners come from active native staff accounts. Each account has an explicit inventory directory projection; names are never used to infer identity. New batteries require J18 and may leave the room, specifications, dates and RFID identifier unknown. The local disposable test business database was rebuilt for this iteration instead of adding legacy-borrower compatibility features. Existing local test accounts remain usable, and subsequent operations retain normal history.

## Download behavior

Summary downloads support Excel, CSV and JSON. Single and bulk details support Excel workbooks with separate worksheets or structured JSON with separate tables. Nine selectable sections cover specifications, current responsibility, registered storage, latest evidence, complete loans, complete observations, complete charges, complete operations and related directory records. Selection is by information section, not by individual scalar field.

Selected histories include every stored record, including records older than the 200 shown in battery details. UTC timestamps, sources, corrections, operator attribution and preserved legacy charging percentages travel with their relevant records. Export metadata identifies filters, dataset, operator, scope and counts. Account credentials and sessions are never part of inventory exports.

The server reads the selected inventory and history in one D1 batch for each file. It rechecks filters and the authenticated personal scope when generating downloads. Ordinary filter/page changes retain explicit selections; if selected assets leave a personal view after reassignment or return, the download requires review instead of silently widening its scope. Data may have changed since the screen or validation request. The file's metadata and counts describe the downloaded state. Excel cell text longer than the supported limit is preserved in a **Complete text** worksheet. An export exceeding Excel's row limit is rejected with a JSON alternative, rather than silently shortened.

## Concurrent operation

The interface refreshes shared data every ten seconds while visible and idle, and on focus. Draft forms are preserved while open. Another operator's confirmed change may take up to the next refresh to appear; server checks apply immediately. Returns submit the exact reviewed loan IDs, and corrections submit the intended action and reviewed return state. Stale drafts are rejected; a return comparison requires explicit acceptance before its reviewed loans change. Movements up to 100 batteries remain one atomic batch. CSV imports recheck active account, role and authorization version at commit. Versioned metadata/account edits reject stale writes, and histories retain the individual operator.

## Current limits

- No real RFID reader, tag or verified reader-to-room mapping has been connected. Demo observations remain explicitly simulated. An observation never checks an asset in or out.
- **In store** means no active loan is recorded. Registered storage is the home; last observed location is dated evidence, not continuous tracking or proof of physical presence.
- New charging records contain duration and completion time. Unknown historic durations and specifications stay null; legacy percentages remain available in detailed exports. There is no live charge measurement.
- Native staff accounts are implemented. UNSW SSO, institutional access approval, backup/retention policy and JAGGAER integration remain future decisions.
- One existing legacy inventory per dataset can be adopted without rewriting keys or history. Multiple legacy private inventories require reviewed collision handling before shared access is enabled; none are silently merged.
- Tests cover independent accounts and contested transactions, not departmental-scale load. Staff efficiency has not been measured; see the proposed study.
- Automatic email, student self-service and safety agents remain deferred. This release runs locally; it has not been deployed to the earlier Site or OpenBayes. No model training is needed.

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

Inspection lists, periodic reminders, follow-up and hardware integration remain outside this implemented release. Separate local planning drafts are not included in the frozen source.

## Local development

Requires Node.js 22.13 or newer. Preserve the supplied lockfile and runtime configuration.

```sh
npm run install:ci
npm run build
```

On a fresh database, apply migrations `0000` through `0007` once in journal order, using each SQL file's exact name:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_military_warstar.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_inventory_integrity.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_prevent_record_replacement.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_building_rooms_charge_duration.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_staff_accounts_shared_inventory.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_battery_age_dates.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0006_staff_self_checkout.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0007_room_availability.sql
npm run dev
```

On existing databases, apply only pending migrations; never rerun the initial migration. Back up existing state first. Keep local preview on loopback.

The local launcher stores a random installation setup key in ignored `work/local-access.json`, without creating a default account. On a fresh installation, use that key in the visible setup form to create the first administrator with your own password. Administrators then create staff accounts. An environment `INVENTORY_SETUP_KEY` takes precedence; a deployment must configure its own secret and HTTPS before real use. The old hosting identity headers and mock cookie do not grant application access.

Set `INVENTORY_DEV_STATE_DIR` for isolated test state, or record a project-local `stateDirectory` in `work/local-access.json`. Use the same path for Wrangler `--persist-to`. The current review uses a fresh `work/qa/reference-preview-state-*` directory configured there. No hosted database was changed. Dev file watching excludes temporary state and backup directories.

```sh
npm run typecheck
npm test
npm run test:api
npm run build
```

Domain tests use isolated Miniflare D1 databases. API checks require the local preview and fictional credentials in ignored `work/local-access.json`; they never target a hosted site. If a Windows npm shim fails, invoke the installed npm CLI with Node rather than changing global configuration.

## Design reference

The restrained blue controls, grey navigation and structured tables draw from the public [UNSW JAGGAER guidance](https://www.unsw.edu.au/assurance-integrity/safety/systems/Jaggaer/qrg). The protected live system was not accessed. This is a student project, with no institutional endorsement or JAGGAER connection.
