# 4 November 2026 web/server release

Deployment: `2026-11-04-web-server-console-1.0.0`. Application version remains `1.0.0`. The public origin is exactly `https://zztv-battery.gear-c1.openbayes.net`. This release serves the reviewed PC web application, the management console at `/console` and the shared APIs. It does not install or publish any phone client.

The authoritative predecessor is `2026-10-13-web-server-integration-1.0.0-r3`, source commit `2c2e8e8d21e4108ad60334cccf604aab386babfb`, with 23 migration receipts. This release appends exactly two reviewed migrations, `0023_operator_metadata_edits` and `0024_reviewed_csv_imports`. Both add integrity triggers on `operations` for request outcomes of new kinds and for model-creation outcomes; neither creates, rebuilds nor rewrites a table. They are applied only to an independent verified copy of the current database. The predecessor data directory, its 23 receipts and every business cell remain unchanged.

The source is the reviewed public snapshot branch `battery-staff-platform-management-console-20261104` in `DESN-Group-F/bsc-f2a5cc56`. Its runtime code (application, components, libraries, migrations, deployment adapters, styles, public files and build configuration) is byte-identical to the branch verified locally on 4 November; phone, desktop and native iOS client sources are not part of the snapshot.

## Build, seal and package

Export the complete source of the sealed commit, build it with the accepted lockfile and run:

```sh
python deploy/openbayes/2026-11-04/package-release.py \
  --source-commit REVIEWED_SEALED_COMMIT \
  --source /path/to/exported/sealed/source \
  --source-manifest /path/to/complete-source-manifest.json \
  --build /path/to/reviewed/build/source \
  --output /path/to/local/release-output
```

The source manifest lists every file of the sealed Git tree with its SHA-256; the packager checks each one against its Git blob. The 23 predecessor receipts come from `deploy/openbayes/2026-10-12/migration-compatibility.json`, exactly as for R3; migrations 0023 and 0024 must be LF and are recorded with `previouslyApplied: false`. The output is `release.zip`, `release.zip.sha256` and `package-result.json`. Credentials, databases, scratch state, phone and desktop sources and runtime dependencies are excluded.

Attach the archive and checksum to the GitHub release `battery-inventory-v1.0.0-console-20261104`. Obtain `install-release.py` from the sealed commit and verify its recorded SHA-256 before running it.

## Saved-home prerequisites

The project root is `/openbayes/home/battery-inventory`. Retain:

- `releases/2026-10-13-web-server-integration-1.0.0-r3/` with its manifest, build, source migrations and applied sidecars (the maintenance-rollback application).
- `data-2026-10-13-web-server-integration-1.0.0-r3/` with the current business data and its `upgrade-complete.json` (23 migrations, schema verified, original preserved).
- `releases/0.6.1/runtime/node_modules/` with Miniflare `4.20260515.0` and workerd `1.20260515.1`.
- `tools/node-v24.21.0/bin/node` and the shared `.teaching-deployment.lock`.

## Cutover

Run every step from the staged release directory with the same three pins: `--source-commit COMMIT --sha256 ARCHIVE_SHA256 --execution EXECUTION`. Do not start or stop either release by hand while this cutover is in progress.

1. Stage while R3 keeps serving: `python3 install-release.py --install-only --source-commit COMMIT --sha256 ARCHIVE_SHA256` (with `INVENTORY_EXPECTED_SAVED_HOME_EXECUTION` and `INVENTORY_RESTORED_FROM_EXECUTION` set to the reviewed saved-home execution). This opens no business database.
2. `python3 cutover.py preflight ...` — read-only while R3 serves: release manifest, R3 application and migration bytes, R3 completion marker, Node and runtime module versions, exactly one R3 launcher and no stray runtime process, R3 health, and a consistent online copy of the R3 database for integrity, receipts and table counts.
3. `python3 cutover.py qualify ...` — downloads the archive again, requires its `deployment.json` to equal the staged one, and runs `qualify-linux.py` with synthetic data under `/tmp`: an R3-shaped fictional predecessor, interrupted starts after 0023 and after 0024, resume, sign-in, origin enforcement, the console page, a metadata edit with its exact retry and outcome lookup, legacy and reviewed model creation with exact retries, maintenance rollback against the current copy and restoration.
4. `python3 cutover.py cutover ...` — repeats every refusable check, requires the preflight and qualification records of this exact commit, archive and staged manifest, then sends SIGTERM to the R3 launcher and waits for its whole process tree to exit and port 8081 to stop listening. It backs up the stopped R3 database under the shared lock, verifies the backup cell by cell, and starts this release with `INVENTORY_MANUAL_STOP=1` and `INVENTORY_PORT=8081`. The launcher makes an independent SQLite backup and a separate copy at `data-2026-11-04-web-server-console-1.0.0/` with identical typed cells; the runtime appends 0023 and 0024, each with its receipt in one atomic D1 batch, compares the schema with a fresh reference after each step and checks every original cell before serving HTTP. Each attempt keeps its records in `cutover-20261104/attempt-*/`.
5. `python3 cutover.py verify ...` — immediately, before anyone signs in: health (deployment, commit, 25 migrations, normal mode), every business table of the new copy equal to the pre-cutover backup (sessions and sign-in attempts excepted), R3's database unchanged with 23 receipts, the new triggers present and the completion marker. Then check `/signin`, anonymous 401 and the signed-in web application and `/console` in a browser. Signed-in task and message reads may generate due reminders, which are ordinary records.

## Rollback

- **While the new release holds no business record that R3 lacks:** `python3 cutover.py revert ...`. It refuses before stopping anything if R3's database changed since the backup. It then stops this release, compares the copy with the pre-cutover backup, renames the copy aside as `superseded-data-…-attempt-…` so no later start can serve it, and starts R3 on its own unchanged data. If business records changed, it starts this release again instead and refuses.
- **After business writes:** do not start R3 on its own data, which would hide later transactions. Use `rollback-and-run.py --source-commit COMMIT --confirm-current-data-maintenance` from this release. It backs up the current 25-migration database and serves it read-only through the R3 build and the maintenance gateway (sign-in, inventory reads and JSON exports; business writes, task routes, human exports and `/console` return 503). Restore with `upgrade-and-run.py`; the completed copy, later writes, sessions and exact receipts are retained.
- Never start R3 by hand while `data-2026-11-04-web-server-console-1.0.0/` exists. As a guard, this release refuses to start on a copy (complete or not) once R3's database differs from the state it was copied from.

## Qualification

`test-release.py` exercises packaging, download policy, staging, the 23-to-25 receipt boundary, stale-copy refusal and typed-cell preservation with synthetic SQLite fixtures. `test-cutover.py` checks the cutover helper's listener detection, launcher and process-tree handling and comparisons. `test-launcher.py` checks clean signal shutdown on Linux. `qualify-linux.py` runs the real runtime with synthetic data. None of them opens the hosted business database. Their results are recorded separately from cutover and acceptance.
