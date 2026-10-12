# Web and server integration release — 13 October 2026

This release prepares the shared web and server application for a later Android integration trial. The application version remains `1.0.0`; deployment `2026-10-13-web-server-integration-1.0.0` and its immutable source/build manifest distinguish it from the previous deployment. Android binaries and source are outside this release.

The intended publication reference is `battery-inventory-v1.0.0-integration-20261013` in `DESN-Group-F/bsc-f2a5cc56`. Source publication and package availability alone do not establish successful OpenBayes startup or acceptance. Record actual deployment evidence separately after the published package has been verified on the host.

## Application changes

- The shared HTTP gateway accepts authenticated native requests without browser-only request metadata. It retains exact public-origin checks, rejects cross-site browser writes, strips untrusted identity headers, and verifies the application's own session-cookie attributes.
- Demonstration inventory supports native NFC evidence for lookup, reviewed movement, intake, removal and Teaching workflows. Raw identifiers and device evidence remain separate from authoritative server times and saved receipts. Working native NFC remains disabled pending physical-device acceptance.
- Operator-entered registration uses the existing shared account, inventory and registration infrastructure. Advertised capabilities describe implemented operations; unrelated desktop metadata/import extensions are excluded.
- Browser scan, intake, removal and Teaching inputs state their hardware limitation and retain manual selection and entered-tag workflows. Source labels distinguish native evidence, typed tags, manual selection and simulation.
- Recovered native drafts retain their original evidence. Invalid local recovery blocks unsafe continuation and offers a scoped raw recovery export without silently discarding unresolved requests.

The accepted yellow Scan return appearance is included. The dependency lockfile, database schema and migration sources `0000` through `0022` remain unchanged. No migration is introduced or applied to the copied current database by this deployment.

## Preservation and rollback

The new launcher requires the verified `2026-10-12-workspace-1.0.0` installation and its authoritative current database. It preserves existing accounts, passwords, sessions and business records, creates an independent verified backup and a separate candidate copy, and rejects missing or ambiguous state. A completed candidate retains later writes on restart.

After the new service accepts writes, its database remains authoritative. Rollback must preserve that current database; replacing it with the older pre-cutover copy would discard later work. The deployment adapters provide a bounded maintenance rollback using the previous application against current data, with business writes blocked where old/native contract compatibility is not established. The prior release and pre-cutover database remain independently available as recovery evidence.

Use the [deployment guide](../../deploy/openbayes/2026-10-13/README.md) for verified installation, startup, backup and rollback commands. Linux runtime, inherited locking, copied-data integrity, proxy/TLS and public browser behavior require actual hosted verification before deployment acceptance.

## Verification boundary

Local preparation passed 902 serial regression tests, 284 business HTTP checks through the built application, browser checkout/return/history checks, and candidate-package preservation/startup/restart checks. A final focused 30-test Teaching input check, typecheck, lint and production build followed the last interface repair. Initial Windows parallel-test resource failures and local packaging path limitations were resolved for the recorded validation environment; this does not establish arbitrary Windows path support or server acceptance.

The published source manifest must cover every sealed source file, including vendored styles, required licenses and the battery catalog. Production artifacts must be built from that sealed source and checked separately. Local native-evidence fixtures do not establish physical NFC performance.

The deployment trial first verifies the shared web/server installation from a computer. The final Android APK joins only after its own debugging and an explicit build/origin compatibility check. Physical tag registration, reviewed checkout, web visibility of the same loan, return and matching history/export remain the later device acceptance sequence.
