# Local web/server integration candidate

This adapter packages application version 1.0.0 as an unpublished, unsealed local candidate. Its accepted base is `d0e1640a0c516ba6c68aeae4695b12a8afb12525`; its current source has no sealed source commit. The source, build, gateway and adapter hashes in `candidate.json` identify the actual captured bytes. They do not establish publication or hosted acceptance.

The recorded current predecessor is `2026-10-12-workspace-1.0.0` with 23 migrations. This candidate preserves those exact sources and applied sidecars, including migration 0000's historical CRLF receipt. It introduces no migration and applies no migration to the copied business database. The earlier qualified dated launcher remains separate and unchanged.

## Package locally

After completing a local production build, run from the candidate repository:

```sh
python deploy/openbayes/integration-candidate/package-candidate.py --source . --output work/openbayes-integration-candidate
python deploy/openbayes/integration-candidate/test-candidate.py --source . --output work/openbayes-integration-candidate
```

The output is `candidate.zip`, its SHA-256 sidecar and `package-result.json`. The archive contains the complete production web build, source/applied migration records, the strict shared HTTP gateway, and these candidate adapters. Mobile source, local tool state, scratch files, runtime dependencies, credentials and databases are excluded. Required build metadata and third-party notices remain intact. Packaging performs no upload, extraction into an installation, deployment or network request.

The source hash uses the shared integration source manifest. The build hash identifies separately captured production files. The caller must build the selected source before packaging; a source/build hash pair alone does not prove that a sealed source commit produced a build. Repackage after any application, gateway or adapter change.

## Local preservation and launch fixture

Use only an isolated synthetic saved-home fixture. Before launch it must contain:

- `releases/2026-10-12-workspace-1.0.0/deployment.json` identifying the exact predecessor source commit, plus its matching `drizzle/` and applied `migrations/`.
- `data-2026-10-12-workspace-1.0.0/d1/` with exactly one current inventory SQLite database, eight native account records, an active administrator, and all 23 exact `portable_migrations` receipts.
- `data-2026-10-12-workspace-1.0.0/upgrade-complete.json` confirming that predecessor's 23-migration schema and preservation checks.
- The verified extracted candidate archive and installed Miniflare 4.20260515.0 / workerd 1.20260515.1 dependencies.

Set `INVENTORY_LOCAL_TEST=1`, `INVENTORY_PROJECT_ROOT` to that fixture, `INVENTORY_TEST_NODE` to the installed Node executable, and `INVENTORY_TEST_NODE_MODULES` to its existing dependency directory. Set both `INVENTORY_EXPECTED_SAVED_HOME_EXECUTION` and `INVENTORY_RESTORED_FROM_EXECUTION` to the same explicitly reviewed synthetic execution identity. Then run `python /path/to/extracted/candidate/launch.py`.

The launcher holds the same `.teaching-deployment.lock` kernel lock for the complete runtime lifetime and passes its descriptor on Linux. On Windows the Node child also holds an exclusive runtime-owner record; a surviving child blocks another runtime after its Python parent exits. A stale owner remains blocked until its entire owned process tree has been explicitly verified stopped and its record is manually removed. A missing Node PID alone does not prove workerd stopped. It makes an independent SQLite backup, then a separate candidate data copy. Every original typed cell is compared across the source, backup and copy before starting. The original data directory is retained unchanged. An incomplete or mismatched copy is rejected; an existing completed candidate is retained with its later writes. A different reviewed execution identity is rejected instead of silently reusing an older copy.

The runtime verifies every supplied file hash, the retained backup, all exact migration receipts and the complete 23-migration schema including integrity triggers before HTTP starts. The launcher never resets accounts or business state, and the candidate runtime does not bootstrap an administrator. Keep existing native sign-in credentials authoritative.

The default listener is HTTP on an isolated `127.0.0.1` port. For canonical HTTPS semantics over raw local HTTP, set `INVENTORY_PUBLIC_ORIGIN=https://zztv-battery.gear-c1.openbayes.net` and send that Host header to the local listener. This exercises the configured origin and Secure cookie behavior; it does not provide TLS or establish remote/device connectivity. In the source checkout, run `node scripts/test-domain.mjs --compile-only` first to prepare the ignored `work/qa` fixture helpers, then `node deploy/openbayes/integration-candidate/test-runtime.mjs` for the synthetic copied-D1 startup, native sign-in and restart check. Its normal Windows shutdown uses the runtime's ten-second bounded timer, which disposes its owned Node/workerd state before Python exits.

Use an explicitly selected standalone Python for Windows qualification. Microsoft Store Python can redirect a Node path under Local AppData into its package cache, causing an installed Node executable to appear unavailable. Set `INVENTORY_TEST_PYTHON` to the installed standalone Python executable before running `test-runtime.mjs`; retain the already tested Node runtime. The local launcher uses a Windows directory junction for existing dependencies, which avoids requiring symbolic-link elevation. Long copied SQLite paths are inspected with the Windows extended-path form.

The retained Windows workerd runtime has a separate SQLite path limit and did not accept a namespaced D1 persistence root in local testing. If the nested checkout exceeds that limit, set `INVENTORY_TEST_FIXTURE_ROOT` to an explicitly selected shorter ignored `work` directory. The test creates a new exclusive `obc-` fixture there and records its full path; it does not use existing databases. This path choice qualifies only that local fixture and does not establish Linux/OpenBayes support.

## Future hosted milestone

The intended later origin is `https://zztv-battery.gear-c1.openbayes.net/` for PC web and Android clients. This candidate refuses an ordinary hosted launch and refuses `/openbayes/home` as its local fixture. A later explicit release decision must seal the reviewed source, qualify the Linux/OpenBayes launcher and retained runtime, verify the actual latest saved-home execution and current database, and test the real proxy/TLS, PC and phone paths before a hosted milestone can be accepted. No hosted database, existing execution or remote storage was accessed by preparing this candidate.
