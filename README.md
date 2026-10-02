# Battery Inventory

A teacher-operated battery inventory and loan prototype for DESN2000. The governing aim is to reduce the teacher's workload while making each battery's responsibility and movements traceable.

## Use the prototype

Open the private application and sign in with your authorized account. Start in **Demonstration inventory**, whose batteries, people, rooms and sample histories are fictional.

1. Select batteries in the table or open **Check out batteries**.
2. Choose a registered borrower, add batteries and review the list.
3. Confirm the checkout. Return batteries through the equivalent review.
4. Open a battery ID to inspect responsibility, observations, historical charging and loan history.
5. Use **Manage records** to register or import people, buildings, rooms and batteries.

**Working inventory** starts with the reference building **J18 - Willis Annexe**, and no batteries, people or rooms. Register a staff owner, then choose a building for each battery. Leave its room unspecified until confirmed; J18 115 is the project-space reference, not a verified battery store. Buildings and rooms are configurable, and room choices belong to the selected building. Unknown specifications and RFID identifiers may stay blank. CSV templates are available inside the import dialog.

## Current limits

- No real RFID device has been connected or tested. Manual tag entry and record selection allow software review. Demo observations are explicitly simulated.
- An RFID observation does not change loan status. A last observed room is dated evidence, not a continuous location guarantee.
- New observations retain room labels at receipt. Older observations without saved labels show their room ID and an unavailable-label note; historical names are not guessed.
- Storage building and optional room record the registered home. This prototype does not infer where a returned battery was physically placed. Legacy unmapped building labels stay unconfirmed until reviewed.
- New charging records contain duration in minutes and completion time. Old percentages remain preserved in the database, and unknown historic durations stay null. There is no live battery-level measurement.
- Access uses hosting-managed authentication. Each operator has a separate inventory; a shared departmental workspace and UNSW SSO are pending institutional decisions.
- JAGGAER integration, automatic email alerts and an AI safety agent are deferred.
- Efficiency improvement has not yet been measured with teachers. See the proposed experiment before making such a claim.

## Project map

| Directory | Purpose |
| --- | --- |
| app | Application shell and authenticated inventory API |
| components/inventory | Teacher forms, tables, history and import UI |
| components/ui | Bundled Shadcn primitives |
| lib | Authentication, validation, inventory domain, fixtures and client utilities |
| lib/platform | External authentication protocol identifiers |
| db / drizzle | Database schema and versioned migrations |
| tests | Domain and D1 invariant checks |
| scripts | Local runtime, checks and build helpers |
| docs | Requirements, decisions, experiment and verification |
| work | Ignored local references, test builds and QA scratch files |

Start with [requirements](docs/requirements.md), [architecture](docs/architecture.md), [validation](docs/validation.md), [experiment protocol](docs/experiment-protocol.md) and [open questions](docs/open-questions.md).

## Local development

Requires Node.js 22.13 or newer. Preserve the supplied lockfile and runtime configuration.

```sh
npm run install:ci
node scripts/run-framework.mjs build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_military_warstar.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_inventory_integrity.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_prevent_record_replacement.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_building_rooms_charge_duration.sql
node scripts/run-framework.mjs dev
```

On a fresh local database, apply each migration once in journal order. On an existing database, apply only migrations not yet installed; never rerun the initial migration. Hosted deployment tracks applied migrations. The preview normally opens at http://127.0.0.1:5173/. The local sign-in helper uses the fictional account **admin**; it is absent from production builds. Keep local preview on loopback.

For isolated UI testing, set `INVENTORY_DEV_STATE_DIR` to a separate project-local directory and use that same directory for Wrangler's `--persist-to` migration commands. The default remains `.wrangler/state`. The 2 October location/charging changes have been checked locally; they have not been published to the earlier hosted Site or OpenBayes. OpenBayes execution was stopped for this phase. No model training is required by these inventory functions.

```sh
node node_modules/typescript/bin/tsc --noEmit
node scripts/test-domain.mjs
node scripts/test-api.mjs
node scripts/run-framework.mjs build
```

The domain tests use an isolated Miniflare D1 database. API checks require the local dev preview and never target a hosted Site. If a Windows npm shim fails, invoke the installed npm CLI with Node rather than changing global configuration.

## Design reference

The restrained blue controls, grey navigation and structured inventory tables draw from the public [UNSW JAGGAER guidance](https://www.unsw.edu.au/assurance-integrity/safety/systems/Jaggaer/qrg). The protected live system was not accessed. This prototype is a student project, with no institutional endorsement or JAGGAER connection.
