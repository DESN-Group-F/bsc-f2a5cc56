# Battery Inventory — dated OpenBayes adapters

These adapters belong to deployment `2026-10-08-teaching-groups`, based on the existing native-account `0.6.1` installation. The application package version remains `0.7.0`; this dated current build includes reviewed changes after the earlier frozen `0.7.0` source snapshot. The deployment manifest and source snapshot hash identify the actual contents. This directory does not create a new Git tag, source publication or Sites deployment.

The three adapter files alone are not a deployable application. Use them with the reviewed production `dist/server`, `dist/client`, complete `drizzle` sources, `deployment.json` and retained Linux runtime. The self-contained upload helper supplies that exact bundle and refuses to overwrite an existing release with different bytes. Do not recursively upload a development checkout, local dependencies, tool state, credentials or a business database.

## Installation status

The dated application was installed and accepted on 8 October 2026 in container `olHwbBC1EiM`, named `DESN2000-battery-inventory-20261008`, execution `77pbj3hl5zt3`. Its initial saved home was copied from original execution 9, `yloqznsdaj7b`. The public application is [Battery Inventory](https://zztv-desn-web-20261008.gear-c1.openbayes.net/) on port 8081. Actual logs verified original typed cells, 21 migrations and Linux lock inheritance; public HTTP passed 50/50 checks and native browser login/review passed. See [the dated handover](../../../docs/deployment-openbayes-2026-10-08.md) for evidence, failure records and operating limits. Future continuation must retain the latest current data and use its actual saved-home source.

## Required saved-home layout

All paths below are relative to `/openbayes/home/battery-inventory/`:

| Path | Purpose |
| --- | --- |
| `releases/0.6.1/` | Retained original release, manifest, sources and applied migration sidecars |
| `releases/0.6.1/runtime/node_modules/` | Retained Linux dependencies: Miniflare `4.20260515.0`, workerd `1.20260515.1` |
| `tools/node-v24.21.0/bin/node` | Retained verified Linux Node runtime |
| `data-v0.6.1/` | Original native accounts and business database; preserved as the old backup boundary |
| `releases/2026-10-08-teaching-groups/` | Reviewed dated application build and these adapters |
| `releases/2026-10-08-teaching-groups/migrations/` | Verified applied-byte sidecars prepared by the launcher |
| `data-2026-10-08-teaching-groups/` | Preserved copy upgraded to twenty-one migrations; current data after startup and new writes |
| `.teaching-deployment.lock` | Kernel lock held for the deployment/runtime lifetime |

The adapters require exactly one inventory SQLite file, the expected original receipts, native accounts and an active administrator. They reject missing, ambiguous or unknown data instead of creating an empty replacement. Required runtime dependency notices and licenses must remain with the retained installation.

## Initial installation and environment

Restore the reviewed saved home first and confirm its source in the OpenBayes console. For this initial installation only, the reviewed source is `yloqznsdaj7b`. Set both restoration variables to this identifier only after verifying that the platform actually copied it:

```sh
export INVENTORY_EXPECTED_SAVED_HOME_EXECUTION=yloqznsdaj7b
export INVENTORY_RESTORED_FROM_EXECUTION=yloqznsdaj7b
export INVENTORY_MANUAL_STOP=1
export INVENTORY_PORT=8081
```

Upload the reviewed `deploy-battery-20261008.py` helper into the execution's working directory. Check its SHA-256 against `661e9e347ffab48e8e94d7d3d8ac14e3d86069f2c54972f192c3f2f22c2729be` before execution, then run it with Python 3. The helper verifies its embedded archive, installs only the named release and starts `upgrade-and-run.py`. If the helper is missing, upload it successfully and recheck its hash; do not continue by running an unrelated old launcher.

The launcher sets `INVENTORY_BUNDLE_ROOT`, `INVENTORY_DATA_ROOT`, `PORT` and its inherited lock variables for the Node runtime. Do not fabricate lock flags or start `runtime.mjs` directly. Do not set `INVENTORY_LOCAL_TEST` on the server. The existing accounts remain authoritative; no administrator setup key, new default password or bootstrap account is needed.

## Migration and account preservation

The launcher takes a SQLite backup of `data-v0.6.1` into the named current directory, compares all original typed cells and retains the original database. It preserves previously applied migration sidecars 0000–0015 and their stored hashes. The original applied 0000 sidecar has CRLF while its source has LF; `migration-compatibility.json` records both hashes and permits only that verified line-ending difference. Do not normalize an already applied sidecar or rewrite its receipt.

Only unapplied migrations are appended, in journal order:

| Migration | Change |
| --- | --- |
| 0016 | Custom task plans |
| 0017 | Battery inspections |
| 0018 | Retired-asset actions |
| 0019 | New arrivals |
| 0020 | Teaching checkout alternatives and actual runs |

Each migration and its receipt use one atomic D1 batch. The runtime checks the existing schema against an independently migrated reference, verifies receipt order and migration bytes, and checks original cells after every applied migration. HTTP starts only after the twenty-one-migration boundary is verified. Failed or interrupted upgrades retain their original copy and committed receipt prefix; the adapters do not reset data to bypass a conflict.

Original native account IDs, roles, password hashes, salts, authentication versions, loans, private groups and history are retained. Native session cookies are forwarded to the application; untrusted hosting identity headers are removed. The dated gateway does not authenticate users through the old `portable-admin` identity injection. **Do not use the historical `deploy/openbayes/runtime.mjs`, `verify.mjs`, `resume.py` or `build-bundle.py` to launch or validate this release.** Those earlier adapters use a different authentication and movement contract.

## Lock, shutdown and continuation

The Linux launcher holds a nonblocking `flock` and passes its descriptor to the Node process. The runtime verifies the inherited descriptor against the saved-home lock. A separate acquisition probe must fail before startup. The descriptor remains inherited while Node is alive, including if its Python supervisor exits unexpectedly. A second current-release launcher refuses to start while that lock is held. These guards do not replace the operational requirement to stop any other inventory service using the same saved database before upgrading.

For normal shutdown, stop the owning launcher or use the OpenBayes execution stop control. The launcher forwards termination, and the runtime closes HTTP and D1 while preserving current data. To stop compute charges, stop the OpenBayes execution and confirm its closed state; stopping only the web process leaves a Jupyter workspace running.

For a later execution, restore the **latest saved home containing the authoritative current data**, then confirm that restoration in the console. Replace the two restoration values with the newly reviewed source execution; do not blindly reuse the initial `yloqznsdaj7b` command. Preserve the current data directory, completion/source markers, named release, original release, migration sidecars and runtime tools together.

With the completed release already installed, start through the same launcher:

```sh
# Set both restoration variables to the actual reviewed saved-home source first.
export INVENTORY_MANUAL_STOP=1
export INVENTORY_PORT=8081
python3 /openbayes/home/battery-inventory/releases/2026-10-08-teaching-groups/upgrade-and-run.py
```

A completed `data-2026-10-08-teaching-groups` is retained and checked, rather than recopied from the old backup. After any new business writes, this current directory is authoritative. Restoring only `data-v0.6.1` would omit those later operations. Never delete completion markers, replace the current database with the old copy or invent matching restoration values to force a restart.

## Validation, cost and limits

The isolated deployment source passed 738 tests with zero failures/skips, TypeScript, full ESLint and the production build. Nine Python safeguards, nine actual-D1/native HTTP recovery checks and six packaging safeguards passed separately. These are local acceptance results. Actual remote startup separately established migration preservation, inherited Linux lock checks and `inventory_ready`; public HTTP passed 50/50 checks and original native sign-in/browser review succeeded. Preserve earlier failed attempt records separately from successful acceptance.

The approved CPU workspace has 2 cores and 4 GiB RAM at the observed CNY 0.30 per running hour. `INVENTORY_MANUAL_STOP=1` disables the adapter's automatic timeout. The default bounded mode, when manual stop is absent, permits up to two hours. This manual execution has no automatic restart, high-availability arrangement or guarantee about the platform's final bill or separate storage charges.

This is a single-execution Miniflare/workerd service. The mobile/native prototype and diagnostic NFC route are excluded. Shared NFC evidence contracts do not establish physical NFC reading, device installation, signing, school identity integration or real RFID ingestion. Existing client bundle-size advisories and unverified load/availability limits remain.
