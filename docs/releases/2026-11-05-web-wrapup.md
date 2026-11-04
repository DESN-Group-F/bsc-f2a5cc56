# Web client wrap-up: code-only update (5 November 2026)

Deployment `2026-11-05-web-console-wrapup-1.0.0`. Application version remains 1.0.0. GitHub release `battery-inventory-v1.0.0-wrapup-20261105`.

## What changes for staff

- The `/nfc-test` test page and the simulated intake controls ("Simulate this tag", "Simulate next new battery") are gone. Drafts, batches and unresolved requests saved by the simulated intake still recover and can be confirmed or removed.
- Scan checkout and Scan return no longer offer "Process as teaching group". Whole-group checkout and return are in Teaching groups (teaching checkout runs), as in the iOS and Android apps. A scan session saved with a group still shows it and finishes as before.
- In the Demonstration inventory only, Chrome on Android can scan NFC tags in the browser: Scan checkout and return, First-time intake, Retire or remove and the teaching checkout review. Like Mapping this is a demonstration feature. Working inventory and the management console (`/console`) show no scanning; other browsers and iPhones are told that scanning is not supported. Details: `docs/web-nfc-scanning.md`.

## What does not change

Server API code, permissions, migrations (25), schema and stored data. The update serves an independent verified copy of the current database; the 4 November data directory is kept unchanged.

## Release identity

- Predecessor: `2026-11-04-web-server-console-1.0.0`, source `285fa362b91bffcc7da9a508eab8c24c7878b145`, 25 receipts.
- Application source: byte-identical to `ad41e79ebe9fe69c2ac5dd17b918fdeeefd58846` (branch `battery-staff-platform-management-console-20261104`), whose exported source passed install, typecheck, lint, every domain test file one at a time, the production build and the isolated API checks on Windows on 4 November.
- Deployment tooling: `deploy/openbayes/2026-11-05/` (`README.md` there has the cutover, rollback and resume procedure).

## Going back

`cutover.py revert` while nothing was written; afterwards `cutover.py rollback` serves the current data through the 4 November application (the previous web client, with ordinary reads and writes), and `cutover.py restore` returns to this update.
