# 5 November 2026 Teams embedding update

Deployment: `2026-11-05-teams-embedding-1.0.0`. Application version remains `1.0.0`. The public origin is exactly `https://zztv-battery.gear-c1.openbayes.net`.

This update lets the management console open inside a Microsoft Teams website tab (`docs/teams-pc-client.md`):

- The gateway no longer sends `X-Frame-Options: DENY`. `/console` and `/signin` carry `Content-Security-Policy: frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft`, every other response `frame-ancestors 'none'`, and only those two pages accept a cross-site navigation into a frame (`Sec-Fetch-Dest: iframe`). APIs, assets, other pages and writes stay same-origin only.
- A sign-in made inside a frame gets a `SameSite=None; Secure; Partitioned` session cookie, which browsers keep for that embedding host alone; ordinary sign-in keeps the `SameSite=Strict` cookie. Every write still requires the exact same Origin.
- The sign-in page says that it is not a UNSW (zID) sign-in and, inside Teams, confirms the session before opening the console. The console's My account has Sign out.

Migrations, schema and stored data are unchanged. The authoritative predecessor is `2026-11-05-web-console-wrapup-1.0.0`, source commit `dcb1256ece33b7e0a2aed14ccb3888c324fcaa4d`, with 25 migration receipts. This update appends **no** migration. It serves an independent verified copy of the current database (`data-2026-11-05-teams-embedding-1.0.0/`); the predecessor data directory, its receipts and every business cell remain unchanged.

## Build, seal and package

Export the complete source of the sealed commit, build it with the accepted lockfile and run the release checks, then:

```sh
python deploy/openbayes/2026-11-05-teams/package-release.py \
  --source-commit REVIEWED_SEALED_COMMIT \
  --source /path/to/sealed/git/checkout \
  --source-manifest /path/to/complete-source-manifest.json \
  --build /path/to/reviewed/build/source \
  --output /path/to/local/release-output
```

The 25 accepted receipts are the 23 from `deploy/openbayes/2026-10-12/migration-compatibility.json` and 0023/0024 (LF source bytes); all are marked `previouslyApplied: true`. The preflight compares them with the retained predecessor release on the server. Attach `release.zip` and `release.zip.sha256` to the GitHub release `battery-inventory-v1.0.0-teams-20261105`. Do not replace the attachments of `battery-inventory-v1.0.0-wrapup-20261105` or `battery-inventory-v1.0.0-console-20261104`.

## Saved-home prerequisites

The project root is `/openbayes/home/battery-inventory`. Retain:

- `releases/2026-11-05-web-console-wrapup-1.0.0/` (the predecessor application, used by `revert` and `rollback`).
- `data-2026-11-05-web-console-wrapup-1.0.0/` with its `upgrade-source.json` and `upgrade-complete.json` (25 migrations, schema verified, original preserved).
- `releases/0.6.1/runtime/node_modules/` with Miniflare `4.20260515.0` and workerd `1.20260515.1`.
- `tools/node-v24.21.0/bin/node` and the shared `.teaching-deployment.lock`.

## Cutover

Run every step from the staged release directory with the same three pins: `--source-commit COMMIT --sha256 ARCHIVE_SHA256 --execution EXECUTION` (the saved-home execution recorded in the predecessor's `upgrade-source.json`). Do not start or stop either release by hand.

1. Stage while the predecessor keeps serving: `python3 install-release.py --install-only --source-commit COMMIT --sha256 ARCHIVE_SHA256` (with `INVENTORY_EXPECTED_SAVED_HOME_EXECUTION` and `INVENTORY_RESTORED_FROM_EXECUTION` set to the reviewed execution). This opens no business database.
2. `python3 cutover.py preflight ...` — read-only: this update's manifest, the predecessor application, journal, accepted receipts and completion marker, Node and runtime module versions, exactly one predecessor launcher and no stray runtime process, predecessor health, and a consistent online copy of the current database for integrity, receipts and table counts.
3. `python3 cutover.py qualify ...` — downloads the archive again, requires its `deployment.json` to equal the staged one, and runs `qualify-linux.py` with synthetic data under `/tmp`: a predecessor shaped like the wrap-up data, an interrupted first start, resume, sign-in, origin enforcement, the console page, the frame policy and framed page entry, the embedded sign-in (partitioned cookie, reads, refused cross-site write, sign-out), Web NFC-shaped intake evidence, a metadata edit and a model creation with exact retries, a SIGKILL followed by a restart, rollback through the real retained predecessor application (its ordinary cookie, ordinary writes, this gateway) and restoration.
4. `python3 cutover.py cutover ...` — repeats every refusable check, requires the preflight and qualification records of this exact commit, archive and staged manifest, then sends SIGTERM to the predecessor launcher and waits for its whole process tree to exit and port 8081 to stop listening. It backs up the stopped database under the shared lock, verifies the backup cell by cell, and starts this update with `INVENTORY_MANUAL_STOP=1` and `INVENTORY_PORT=8081`. The launcher makes an independent SQLite backup and a separate copy with identical typed cells; the runtime compares the schema with a fresh reference built from the 25 migrations and checks every original cell before serving HTTP. Records: `cutover-20261105-teams/attempt-*/`. Service is interrupted from the stop until the update reports ready; the attempt records hold both times.
5. `python3 cutover.py verify ...` — immediately, before anyone signs in: health (deployment, commit, 25 migrations, normal mode), every business table of the new copy equal to the pre-cutover backup (sessions and sign-in attempts excepted), the predecessor database unchanged, receipts and triggers identical to the predecessor's, and the completion marker with no appended migration. Then check `/signin`, anonymous 401, the signed-in web application and `/console` in a browser.

## Going back

- **While this update holds no business record the predecessor lacks:** `python3 cutover.py revert ...`. Before stopping anything it refuses if the predecessor database changed since the backup, if this copy was ever served in rollback, or if a read-only copy of the live update database already shows changed business tables. It then stops this update, compares again, renames the copy aside as `superseded-data-…-attempt-…` and starts the predecessor on its own unchanged data. If business records changed while it was stopping, it starts this update again and refuses.
- **After business writes:** `python3 cutover.py rollback ...`. It serves the CURRENT database through the retained wrap-up application (`rollback-and-run.py`): the previous web client with the same schema and receipts behind this release's gateway, so sign-in, reads, writes and exports keep working. Tabs already signed in keep working; a new sign-in inside a Teams frame then gets the ordinary Strict cookie and fails until `restore`, so use the browser meanwhile. Health reports mode `rollback-predecessor-application`. `python3 cutover.py restore ...` returns to this update on the same data. Before stopping anything, both refuse if the predecessor's own data changed (the launcher would refuse). Each switch writes an online backup of the stopped database into the attempt directory (`rollback-…-before.sqlite`, `restore-…-before.sqlite`) and a record; a rollback start also leaves a uniquely named receipt and `pre-rollback-….sqlite` in the data directory (`rollback-source.json` keeps the first receipt). Nothing is copied over or rewritten. If the new mode does not become ready, the previous mode is started again on the same data.
- **Never start the predecessor by hand on its own data after cutover.** `data-2026-11-05-web-console-wrapup-1.0.0/` stops receiving records at cutover; serving it would hide every later transaction. As a guard, this update refuses to start on its copy once the predecessor's data differs from the state it was copied from.

## After an execution restart

Processes do not survive a restart of the execution; nothing starts automatically. Always use `resume` from this release directory:

```sh
python3 cutover.py resume --source-commit COMMIT --sha256 ARCHIVE_SHA256 --execution EXECUTION
```

- After cutover (this update's copy is complete): starts this update on its copy, in the mode it last served in according to the switch and resume records (`--mode normal` or `--mode rollback` overrides). It refuses `--mode predecessor`: the wrap-up release must not serve its own older data.
- After a completed `revert` (copy absent, latest attempt holds a `reverted-…` record): starts the wrap-up release on its own data.
- Before any cutover (no attempt, no copy): starts the wrap-up release only with an explicit `--mode predecessor`, so a saved home restored from an older execution is never served without a decision.
- An interrupted cutover (copy present but its first start never completed, or no copy and no completed revert): refuses and names `revert`, which serves the wrap-up release on its unchanged data.

`resume` refuses while anything answers on port 8081 or any launcher or runtime process exists. It copies the database files exactly as the restart left them (`as-found-…`, including any write-ahead log) as evidence, makes an online backup under the shared lock (SQLite applies the committed write-ahead frames when the database is opened, so the backup holds every committed record) and verifies it, archives the stale `.runtime-owner.json`, starts the launcher and checks the health identity. Records: `cutover-20261105-teams/resume-*/`.

## Qualification

`test-release.py` exercises packaging, download policy, staging, the 25-receipt boundary (no appended or unknown receipt), stale-copy refusal, rollback and restoration with synthetic SQLite fixtures. `test-cutover.py` checks the cutover helper's listener detection, normal and rollback launcher detection, process-tree handling and comparisons. `test-phases.py` drives `rollback`, `restore` (a failed start that returns to the previous mode, a double failure and an uncleared failed start, each still recorded), a complete `revert`, its refusals and every `resume` state, including the mode inferred from the records, with stand-in launchers and synthetic databases and a write-ahead log left by a killed writer. `test-launcher.py` checks clean signal shutdown on Linux. `qualify-linux.py` runs the real runtime and the real retained predecessor application with synthetic data, including a SIGKILL of the running update followed by a restart on the same copy. None of them opens the hosted business database. Physical NFC reads are checked separately on an Android phone (`docs/web-nfc-scanning.md`).
