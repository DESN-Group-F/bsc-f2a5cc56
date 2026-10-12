# 13 October 2026 web/server release

Deployment: `2026-10-13-web-server-integration-1.0.0`. Application version remains `1.0.0`. The public origin is exactly `https://zztv-battery.gear-c1.openbayes.net`. This release serves the reviewed PC web application and shared APIs; it does not install, rebuild or publish Android.

The authoritative predecessor is `2026-10-12-workspace-1.0.0`, source commit `d0e1640a0c516ba6c68aeae4695b12a8afb12525`. The launcher copies the actual latest predecessor database from the explicitly reviewed saved-home execution. Historical acceptance counts are not used as a data snapshot. All 23 migrations, applied receipts, native accounts, sessions and business cells must be preserved. No migration is appended or applied to the copied database.

## Build, seal and package

Use the complete source exported from the reviewed sealed Git commit. The source manifest has `sourceCommit` and a `records` array of `{ "path": "relative/file", "sha256": "..." }` for every published source file, including the vendor code, required licenses and battery catalog build input. The packager checks the full Git tree, each actual SHA-256 and the corresponding sealed Git blob. The earlier local integration subset hash is not sufficient source provenance for this release.

Build that source using the accepted dependency lockfile. Then run:

```sh
python deploy/openbayes/2026-10-13/package-release.py \
  --source-commit REVIEWED_SEALED_COMMIT \
  --source /path/to/exported/sealed/source \
  --source-manifest /path/to/complete-source-manifest.json \
  --build /path/to/reviewed/build/source \
  --output /path/to/local/release-output
```

The output is `release.zip`, `release.zip.sha256` and `package-result.json`. It contains the production build, exact source/applied migration sidecars, the strict shared gateway, these launch/rollback adapters and the release manifest. Local credentials, databases, scratch state, mobile/desktop source and runtime dependencies are excluded. The historical CRLF receipt of migration 0000 remains separate from its hash-verified accepted LF source. Required Vite metadata and third-party notices remain intact.

Upload the verified archive and its checksum to the explicitly requested GitHub release tag `battery-inventory-v1.0.0-integration-20261013` in `DESN-Group-F/bsc-f2a5cc56`. Obtain `install-release.py` from the exact sealed source commit and verify its recorded installer SHA-256 before running it. Do not insert archive hashes into source before sealing; the commit and archive pins are supplied separately to avoid circular provenance.

## Current saved-home prerequisites

The project root is the resolved `/openbayes/home/battery-inventory`. A legitimate saved-home symlink may resolve this root; internal release/data paths must remain unlinked. Retain:

- `releases/2026-10-12-workspace-1.0.0/` and its manifest, source migrations and applied sidecars.
- `data-2026-10-12-workspace-1.0.0/` with the actual current business data and verified completion marker.
- `releases/0.6.1/runtime/node_modules/` with Miniflare `4.20260515.0` and workerd `1.20260515.1`, including their required notices.
- `tools/node-v24.21.0/bin/node` and the shared `.teaching-deployment.lock`.

Review the actual execution, retained home and running process before cutover. Set both `INVENTORY_EXPECTED_SAVED_HOME_EXECUTION` and `INVENTORY_RESTORED_FROM_EXECUTION` to that exact reviewed source. Stop the previous inventory cleanly, retaining the execution and saved home. The shared kernel lock rejects concurrent runtimes and is inherited by Node for the entire runtime lifetime. An additional exclusive runtime-owner record blocks an orphan or unverified stale process; never remove it merely because a Node PID is absent. First verify its whole owned process tree has stopped.

## GitHub download and launch

After reviewing the sealed commit, installer hash and archive hash:

```sh
# Set both restoration variables to the reviewed latest saved-home execution first.
export INVENTORY_MANUAL_STOP=1
export INVENTORY_PORT=8081
python3 install-release.py \
  --source-commit REVIEWED_SEALED_COMMIT \
  --sha256 REVIEWED_RELEASE_ZIP_SHA256
```

The installer accepts only the fixed GitHub release asset and reviewed checksum. Redirects are restricted to approved GitHub HTTPS hosts. It checks the complete manifest, source identity and all migration source/applied hashes before extraction, rejects a differing existing release, and never downloads or resets business data. Installation then invokes the locked launcher with the source pin.

Before cutover, use the same installer with `--install-only` to verify and stage the release while the existing application remains running. This mode does not open a business database or start a runtime. Run `qualify-linux.py` from the staged release with `--archive`, `--sha256`, `--source-commit`, `--previous-release`, `--node`, `--node-modules`, an independent `--fixture-root` such as `/tmp`, and `--report`. The fixture root is rejected if its resolved path lies inside the normal saved home. After successful qualification and deliberate cutover, start `upgrade-and-run.py --source-commit REVIEWED_SEALED_COMMIT`.

The launcher creates an independent verified SQLite backup and a separate current data copy at `data-2026-10-13-web-server-integration-1.0.0/`. Source, backup and copied typed cells must match before startup. The original source database remains intact. Schema, integrity triggers and every exact migration receipt are checked before HTTP is served. The external listener is `0.0.0.0:8081`; Miniflare stays on loopback. The strict gateway uses the fixed canonical origin, ordinary native sessions and server permissions. It does not trust forwarded identity headers or rewrite cookies to simulate HTTPS.

Verify PC sign-in, the real canonical HTTPS origin, `/healthz`, exact saved-home/copy evidence and current inventory reads before considering Android integration. Existing credentials and sessions remain authoritative. Do not bootstrap or reset accounts. Qualification with synthetic fixtures is separate from real TLS/proxy, PC and phone acceptance.

## Maintenance rollback preserving later writes

The former launcher is tied to its older data directory. Starting it directly after this release receives writes would display stale stock and omit later transactions. Do not use it as rollback.

Stop this runtime cleanly, keep the latest saved home and use the NEW rollback adapter:

```sh
export INVENTORY_MANUAL_STOP=1
export INVENTORY_PORT=8081
python3 /openbayes/home/battery-inventory/releases/2026-10-13-web-server-integration-1.0.0/rollback-and-run.py \
  --source-commit REVIEWED_SEALED_COMMIT \
  --confirm-current-data-maintenance
```

It verifies the current completed 23-migration database and retained predecessor application, takes an independent pre-rollback backup of current data, and serves that CURRENT database using the predecessor build plus the strict new gateway. It never copies the old predecessor database over current data. The original current completion/copy evidence remains in place.

Rollback is explicitly maintenance-only. Native sign-in/sign-out, inventory/directory reads and complete JSON exports remain available. All business writes, old application pages, task-engine/message routes and human XLSX/CSV exports are blocked with a visible maintenance explanation. The old source cannot parse/replay the new operator registration and native NFC requests, and its source labels are not qualified for these records. Preserve those unresolved requests until the new release is restored; no compatibility fallback changes their payloads or evidence.

After repair, stop maintenance mode and run `upgrade-and-run.py --source-commit REVIEWED_SEALED_COMMIT` from the new release. It retains the same completed current database, later writes, native sessions and exact receipts; it does not recopy predecessor stock.

The initial copy remains bound to its reviewed execution identity. A later different saved-home execution requires a separately reviewed resume record; the current adapter fails closed rather than guessing continuity. This release does not claim generic unattended resume, high availability or physical NFC acceptance.

## Qualification

`test-release.py` exercises archive/download policy and typed-cell preservation using synthetic SQLite fixtures only. `qualify-linux.py` prepares an isolated synthetic Linux saved home and runs the actual normal/rollback/restart path. Run it with the reviewed extracted archive, installed exact runtime dependencies and Node. It must never use the normal saved-home business database. Record its actual results separately from hosted cutover and PC validation.
