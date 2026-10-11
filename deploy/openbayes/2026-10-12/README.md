# Battery Inventory — 12 October 2026 deployment adapters

These adapters target deployment `2026-10-12-workspace-1.0.0`, application version `1.0.0`. They upgrade the authoritative database from the dated `2026-10-08-teaching-groups` deployment. The adapters alone are not an application package, and this operating guide does not establish successful remote deployment.

Use the reviewed production `dist/server`, `dist/client`, twenty-three migration sources, the three adapter files and `deployment.json`. The manifest identifies every supplied file by its SHA-256. Do not upload local dependencies, credentials, databases, mobile prototypes or desktop development work.

## Existing installation required

All paths are relative to `/openbayes/home/battery-inventory/`:

| Path | Purpose |
| --- | --- |
| `releases/2026-10-08-teaching-groups/` | Retained previous application, manifest, source migrations and applied migration sidecars |
| `data-2026-10-08-teaching-groups/` | Authoritative prior database with twenty-one exact receipts and a verified completion marker |
| `releases/0.6.1/runtime/node_modules/` | Retained Miniflare `4.20260515.0` and workerd `1.20260515.1` dependencies and their required license notices |
| `tools/node-v24.21.0/bin/node` | Retained verified Linux Node runtime |
| `releases/2026-10-12-workspace-1.0.0/` | New verified production package and these adapters |
| `data-2026-10-12-workspace-1.0.0/` | New preserved copy; authoritative after successful upgrade and subsequent writes |
| `.teaching-deployment.lock` | Shared kernel lock used by both dated deployments |

The old `data-v0.6.1` is an older backup boundary. This launcher never copies it as the upgrade source. It requires the latest dated database, at least eight retained native accounts and an active administrator. Missing, ambiguous, incomplete or mismatched data is rejected without creating an empty replacement.

## Upgrade and restart

Confirm the latest execution and actual saved-home source in the hosting console. Set `INVENTORY_EXPECTED_SAVED_HOME_EXECUTION` and `INVENTORY_RESTORED_FROM_EXECUTION` to that reviewed source. Do not copy an older execution over a newer authoritative database or invent matching restoration values.

Stop the prior inventory process cleanly before launching this deployment. The shared kernel lock additionally rejects concurrent old and new runtimes. Keep the saved home, prior releases and databases intact.

After verifying the downloaded package and its manifest, launch through Python:

```sh
# Set both restoration variables to the reviewed saved-home source first.
export INVENTORY_MANUAL_STOP=1
export INVENTORY_PORT=8081
python3 /openbayes/home/battery-inventory/releases/2026-10-12-workspace-1.0.0/upgrade-and-run.py
```

Do not start `runtime.mjs` directly or set `INVENTORY_LOCAL_TEST` on the server. The launcher verifies and passes the kernel-lock descriptor to Node for the runtime lifetime. Existing passwords, account roles and native sessions remain authoritative; no account bootstrap or password reset is required.

The first launch makes a SQLite backup of the authoritative twenty-one-migration database, compares all original typed cells and retains the source unchanged. It verifies the retained applied sidecars byte for byte, including the CRLF form of migration 0000. Only migrations 0021 (room beacon configuration) and 0022 (teaching checkout changes) are appended. Each migration and its receipt use an atomic D1 batch. Schema and original-cell checks must pass before HTTP is served.

An interrupted upgrade retains its exact copy and committed receipt prefix. A completed new database is retained on restart, including later business writes; the launcher never recopies the prior database over it. Once this new database has received writes, the old application cannot be treated as a current-data rollback by pointing it at its older copy.

After startup, verify `/healthz`, the `inventory_ready` event, twenty-three migration receipts, preserved accounts and inventory reads using the existing native credentials. Verification must not submit registration, movements, group edits, demo initialization, imports or resets against normal hosted data.

Manual stopping leaves the compute execution running until the hosting execution itself is stopped. Preserve its latest saved home when stopping or resuming. This deployment does not establish unattended restart, high availability, physical Bluetooth/NFC acceptance or an ongoing availability guarantee.

## Local validation records

Local upgrade tests use isolated fixtures under ignored `work/openbayes-20261012/`. Python safeguards cover typed-cell backup preservation, verified prior completion, the current migration boundary, receipt/hash rejection, migration byte preservation and duplicate launch rejection. Actual D1 tests separately cover interruption and resume, full migration rollback, schema checks, native authentication, permissions, session continuity and restart after writes. Record their actual results separately from remote acceptance.

## GitHub packaging and installation

Publish the reviewed source commit and release tag first. Build from that isolated source using the retained dependency lockfile. The packager accepts the immutable source commit, production build directory and a reviewed source manifest containing a `records` array of `{ "path": "relative/source/file", "sha256": "..." }`. It verifies those source bytes before packaging; the caller must establish that the source manifest and build belong to the sealed Git commit. Keep that reviewed source manifest with the release validation records.

```sh
python3 deploy/openbayes/2026-10-12/package-release.py \
  --source-commit REVIEWED_GIT_COMMIT \
  --source /path/to/reviewed/source \
  --source-manifest /path/to/reviewed/source-manifest.json \
  --output /path/to/release-output
python3 deploy/openbayes/2026-10-12/test-packaging.py \
  --output /path/to/release-output \
  --build-source /path/to/reviewed/source
```

The output includes `release.zip`, `release.zip.sha256` and `package-result.json`. Only the production web build, twenty-three migration sources, three runtime adapters and their exact manifest enter the archive. Preserve the generated client `.assetsignore`, which excludes private build metadata from static serving, and the two Vite build manifests. Only those three exact hidden paths are accepted; other hidden files, credentials and databases remain rejected. The build-source test exercises the actual production file layout before publication. Do not place the archive checksum or source commit inside the source installer before sealing the Git commit; they are supplied separately to avoid circular source provenance.

Attach the verified archive and its checksum to the GitHub release for tag `battery-inventory-v1.0.0-update-20261012` in `DESN-Group-F/bsc-f2a5cc56`. Download `install-release.py` from that exact source commit and verify its recorded SHA-256 before execution. The installer downloads the fixed release asset URL, restricts every redirect to approved GitHub HTTPS hosts, checks the archive checksum, source commit, complete file manifest and migration list, and refuses to replace a different existing release. A legitimate hosting saved-home symlink is resolved before checking internal installation paths.

```sh
# Review the saved-home source and set both restoration variables first.
export INVENTORY_MANUAL_STOP=1
export INVENTORY_PORT=8081
python3 install-release.py \
  --source-commit REVIEWED_GIT_COMMIT \
  --sha256 REVIEWED_RELEASE_ZIP_SHA256
```

The installer does not require a GitHub token on the server. It never downloads or resets business data. It requires the authoritative `data-2026-10-08-teaching-groups` directory, then hands control to the migration-safe launcher. Archive or manifest failures stop before any release extraction; differing existing releases are retained unchanged. A partial new installation stays in a uniquely named staging directory and is never used as the active release.
