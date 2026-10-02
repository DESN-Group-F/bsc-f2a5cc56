# Battery Inventory

A staff work platform for the DESN2000 battery-management design project. Its primary aim is to reduce routine staff work while keeping responsibility, lending and dated location evidence traceable.

Release **0.2.0** implements the approved shared staff platform. The earlier prototype is preserved at Git tag `battery-inventory-v0.1.0-freeze-20261002`; subsequent work uses a separate branch.

## Use the local prototype

Open http://127.0.0.1:5173/ and sign in with an account provided by an administrator. The current local review has fictional **admin** and **staff-demo** accounts; their credentials are in ignored `work/local-access.txt`. These are local test accounts, not production defaults.

All active staff see the same **Working inventory** and the same separate **Demonstration inventory**. Accounts have individual profiles and a preferred starting inventory. Demonstration batteries, people, rooms and histories are fictional.

| Action | Staff | Administrator |
| --- | --- | --- |
| View, filter and download all business records | Yes | Yes |
| Register new batteries, including reviewed CSV creation | Yes | Yes |
| Confirm checkouts and returns | Yes | Yes |
| Edit saved battery metadata; maintain people, buildings and rooms | No | Yes |
| Record historical charging and demo observations; correct eligible loan history | No | Yes |
| Create, disable or change staff accounts | No | Yes |
| Edit own profile/preferences and change own password | Yes | Yes |

1. Select batteries or open **Check out batteries**, choose one registered borrower and review the batch before confirmation. Returns use an equivalent review.
2. Open a battery ID to inspect specifications, its responsible owner, current borrower and recorded histories.
3. Filter the inventory by status, storage building, storage room, responsible owner or search text. Pagination offers 10, 25, 50 or 100 batteries per page.
4. Choose **Download** for all filtered results or the current page as a summary. Choose **Detailed battery records** for all filtered batteries, or **Download details** on one battery. Select information sections or use **Select all information**.
5. Use **My account** for personal preferences. Administrators use **Staff accounts** and **Manage records** for initial setup and maintenance.

Working inventory begins with **J18 - Willis Annexe**, and no batteries, people or rooms. An administrator registers responsible owners and borrowers. Each new battery requires a building; its room, specifications and RFID identifier may remain unknown. J18 115 is a project-space reference, not a verified battery store. Room choices belong to the selected building.

## Download behavior

Summary downloads support Excel, CSV and JSON. Single and bulk details support Excel workbooks with separate worksheets or structured JSON with separate tables. Nine selectable sections cover specifications, current responsibility, registered storage, latest evidence, complete loans, complete observations, complete charges, complete operations and related directory records. Selection is by information section, not by individual scalar field.

Selected histories include every stored record, including records older than the 200 shown in battery details. UTC timestamps, sources, corrections, operator attribution and preserved legacy charging percentages travel with their relevant records. Export metadata identifies filters, dataset, operator, scope and counts. Account credentials and sessions are never part of inventory exports.

The server reads the selected inventory and history in one D1 batch for each file. It rechecks the filters when generating the download; data may have changed since the screen or validation request. The file's metadata and counts describe the downloaded state. Excel cell text longer than the supported limit is preserved in a **Complete text** worksheet. An export exceeding Excel's row limit is rejected with a JSON alternative, rather than silently shortened.

## Concurrent operation

The interface refreshes shared data every ten seconds while visible and idle, and on focus. Draft forms are preserved while open. Another operator's confirmed change may take up to the next refresh to appear; server checks apply immediately. Conflicting movements cannot partially save a batch. Versioned metadata/account edits reject stale writes, and histories retain the individual operator.

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

## Local development

Requires Node.js 22.13 or newer. Preserve the supplied lockfile and runtime configuration.

```sh
npm run install:ci
npm run build
```

On a fresh database, apply migrations `0000` through `0004` once in journal order, using each SQL file's exact name:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_military_warstar.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_inventory_integrity.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_prevent_record_replacement.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_building_rooms_charge_duration.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_staff_accounts_shared_inventory.sql
npm run dev
```

On existing databases, apply only pending migrations; never rerun the initial migration. Back up existing state first. Keep local preview on loopback.

The local launcher stores a random installation setup key in ignored `work/local-access.json`, without creating a default account. On a fresh installation, use that key in the visible setup form to create the first administrator with your own password. Administrators then create staff accounts. An environment `INVENTORY_SETUP_KEY` takes precedence; a deployment must configure its own secret and HTTPS before real use. The old hosting identity headers and mock cookie do not grant application access.

Set `INVENTORY_DEV_STATE_DIR` for isolated test state, or record a project-local `stateDirectory` in `work/local-access.json`. Use the same path for Wrangler `--persist-to`. The current review uses `work/qa/staff-preview-state` and retains the original local state separately. Dev file watching excludes temporary state and backup directories.

```sh
npm run typecheck
npm test
npm run test:api
npm run build
```

Domain tests use isolated Miniflare D1 databases. API checks require the local preview and fictional credentials in ignored `work/local-access.json`; they never target a hosted site. If a Windows npm shim fails, invoke the installed npm CLI with Node rather than changing global configuration.

## Design reference

The restrained blue controls, grey navigation and structured tables draw from the public [UNSW JAGGAER guidance](https://www.unsw.edu.au/assurance-integrity/safety/systems/Jaggaer/qrg). The protected live system was not accessed. This is a student project, with no institutional endorsement or JAGGAER connection.
