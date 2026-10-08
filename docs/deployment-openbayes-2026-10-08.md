# OpenBayes deployment handover — 8 October 2026

The dated build was installed and running on 8 October 2026. Actual server startup, original-record preservation, native sign-in, public HTTP and browser checks passed. This is acceptance of this execution at the recorded time, not an availability guarantee.

| Operating field | Verified result |
| --- | --- |
| Deployment identifier | `2026-10-08-teaching-groups` |
| Application package version | `0.7.0` |
| Running execution | `77pbj3hl5zt3`, execution 1 of container `olHwbBC1EiM` (`DESN2000-battery-inventory-20261008`) |
| Public HTTPS URL | [Battery Inventory](https://zztv-desn-web-20261008.gear-c1.openbayes.net/) |
| Actual restored saved-home execution | Original execution 9, `yloqznsdaj7b`; confirmed in the workspace data binding and startup evidence |
| Remote migration receipts and schema | 21 receipts; five additive migrations verified in order, final schema verified |
| Remote original-cell preservation | All typed cells across the 27 original tables retained, including 8 native accounts |
| Public HTTP and browser results | 50/50 HTTP checks; actual native login, inventory, group/manual review and navigation checked |
| Resource and observed CPU rate | 2 CPU cores, 4 GiB RAM; CNY 0.30 per running hour |
| Stop policy | Manual stop, with `INVENTORY_MANUAL_STOP=1` |

## Release identity and scope

This dated deployment contains the reviewed current web application, including post-freeze Teaching group alternatives, exact checkout/return recovery, registration reminders, inspection and retired-asset workflows, and the latest presentation and list-animation repairs. It includes reviewed uncommitted changes based on commit `14e18151e52184b24d4b941f1057c78c34a88b09`.

The existing frozen `0.7.0` source tag describes an earlier snapshot. Although the application package version is also `0.7.0`, the frozen tag and this dated deployment are different source contents. The deployment identifier and source snapshot hash distinguish this build. This operation does not create a Git push, new tag, source release or Sites publication.

The approved upload contains only the production web server/client artifacts, all twenty-one migration sources, the deployment adapters and their manifest. It excludes the mobile/native prototype, its diagnostic NFC route, cloud build configuration, installed local dependencies, local tool state, credentials and business databases. Shared Teaching NFC evidence and operator-entered registration protocols remain where the web backend requires them. The web interface reports its native reader limitation; inclusion of those protocols does not imply browser hardware reading or physical NFC acceptance. Retained server runtime dependencies keep their required third-party license notices.

## Accepted local verification

All development writes used isolated fixtures. Normal local and hosted business data were not test fixtures.

| Verification | Accepted result | Evidence under ignored work/openbayes-20261008/ |
| --- | --- | --- |
| Isolated main-web source suite | 738 passed, zero failed or skipped | `source-tests.log` |
| TypeScript | Passed | `source-typecheck.log` |
| Full source ESLint | Passed | `source-lint.log` |
| Production web build | Passed | `source-build.log` |
| Final adapter ESLint | Passed | `adapter-lint.log` |
| Python upgrade safeguards | 9 passed | `python-upgrade-tests-delivery.log` |
| Actual D1 and native HTTP/recovery checks | 9 passed | `runtime-tests-delivery.log`, `runtime-verification.json` |
| Self-contained packaging safeguards | 6 passed | `package-tests-delivery.log`, `package-verification.json` |

Evidence listed above is retained under ignored `work/openbayes-20261008/`; filenames in that table refer to that directory. The source suite excludes 41 prototype/diagnostic tests from the earlier 779-test development workspace; 738 is the independently tested deployment source, not a claim that the excluded prototype was deployed. Existing large-client-chunk advisories remain.

The D1 checks cover migration interruption and resume, unchanged original typed cells, native passwords and Staff permissions, same-origin protection, session continuity, graceful restart after new writes, schema/receipt rejection, duplicate-runtime rejection, and rollback of the complete 0018 migration with its receipt. Packaging checks cover exact manifest extraction, identical retries, refusal to overwrite a different release, altered-payload rejection and unsafe-path rejection.

Earlier local attempts with Windows SQLite path-opening failures remain in their original logs and are not counted as passes. The accepted delivery reruns are the evidence listed above. Windows validation alone does not verify Linux kernel lock behavior; the actual Linux startup separately confirmed independent acquisition rejection and Node inheritance of descriptor 3 for the runtime lifetime. Physical NFC, native SDK compilation, signing and device installation were not accepted by this deployment test.

Independent artifact inspection found 481 source files matching the source manifest; complete relative imports in the bundled Worker; no local absolute paths, diagnostic `/nfc-test` route or native prototype imports in the build; and no matches for the inspected high-confidence token/private-key patterns. Pattern scans are safeguards, not proof that every possible secret format was detected.

## Artifact identity

The final archive has 130 files and 6,792,060 uncompressed bytes. ZIP and helper checksums, embedded payload, file manifest, frozen adapter copies and launch-command helper checksum were independently compared.

| Artifact | SHA-256 |
| --- | --- |
| Source snapshot manifest | `1741d89a21c01057a046b2ce32b226ec69c6fd34be00c4b760bb3e6c25b94cc0` |
| `release.zip` | `9730a9f6d8a4b3e37d372a5cce2a5c7addf89bd1fc1384b1ec5042dd0b75fed2` |
| `deploy-battery-20261008.py` | `661e9e347ffab48e8e94d7d3d8ac14e3d86069f2c54972f192c3f2f22c2729be` |
| `runtime.mjs` | `1a27542dd9e0a050000e26b581f57554701617170c23abad2ec0bc52799e83ac` |
| `upgrade-and-run.py` | `922835c921576dce27fa20e08e2cf0e6f3c95a163b9bd07cab1d15e9f5018392` |
| `migration-compatibility.json` | `4c48e3aa3f39e131ae2139f6bbd6178f681fbb7b4bdd65d3e5c676f1a9e63394` |

The three adapter files are preserved verbatim under `deploy/openbayes/2026-10-08/`. Neither the archive nor this handover includes a password or session token.

## Database preservation and migrations

The adapter requires the retained native-account `0.6.1` release and `data-v0.6.1`, including its sixteen verified migration receipts. It copies the existing database through SQLite backup into `data-2026-10-08-teaching-groups`; it does not upload a local database or create a replacement for a missing saved database. The original database is retained.

Already applied sidecars 0000–0015 are preserved byte for byte. In particular, the original applied 0000 sidecar has CRLF while its source uses LF. The compatibility record preserves both hashes and verifies this line-ending-only difference; it does not normalize an already applied migration or replace its receipt.

Only unapplied migrations 0016–0020 are appended in journal order: custom tasks, battery inspections, retired-asset actions, new arrivals and Teaching checkouts. Each migration and its receipt share an atomic D1 batch. Before serving HTTP, the runtime verifies the expected schema and guards against an independently migrated reference and compares original typed business cells. An interrupted migration is resumed against the exact preserved copy and receipt prefix. A changed schema, migration hash or receipt is rejected rather than repaired by resetting the database.

After successful startup and subsequent operations, **`data-2026-10-08-teaching-groups` becomes the authoritative current database**. The retained `data-v0.6.1` remains a backup of the old boundary. Recopying the old database after new writes would lose later work; the launcher therefore retains a completed current copy instead of recreating it.

The successful remote startup measured 8 native accounts, 5 existing sessions, 9 batteries, 12 loans, 25 inventory audit entries, 2 private Teaching groups and 1 Task plan. All 27 original table counts and typed cells were checked. Public reads confirmed all 8 accounts active, 9 demonstration batteries and 0 working-inventory batteries. The browser authenticated using the original administrator password; no passwords, roles or accounts were reset or imported. Authenticated task reads may naturally create due cycles/reminders, and inventory reads retain normal reference provisioning; public verification must distinguish this application behavior from test-created business operations.

## Stop and resume

The execution is configured for manual stopping. CPU charges continue while it runs at the observed CNY 0.30 hourly rate, before any separately charged storage or platform services. No automatic shutdown, unattended restart or high-availability arrangement is claimed.

Stop through the OpenBayes execution controls and confirm that the execution is closed. Preserve its saved `/openbayes/home` output. For a later continuation, select the latest execution containing the authoritative current database and confirm the actual copied saved home; do not restore the pre-upgrade execution merely because its identifier appears in an older command. Set `INVENTORY_EXPECTED_SAVED_HOME_EXECUTION` and `INVENTORY_RESTORED_FROM_EXECUTION` to that reviewed source, keeping them equal only after checking the platform restoration. Preserve the current release, migration sidecars, completion markers, accounts, runtime tools and current data directory together.

The existing retained Linux Node/runtime dependencies are reused after adapter version checks. The runtime requires the existing native account password and serves native session cookies; it does not replace accounts with hosting identity headers. The application remains a portable Miniflare/workerd service on a single OpenBayes execution. Actual Linux lock and public acceptance evidence are recorded below. A remote stop/resume or crash-recovery exercise was not performed against the normal server data; local actual-D1 interruption and restart tests passed. Future continuation must copy the latest execution containing the current data. At handover, that is `77pbj3hl5zt3`, rather than original execution 9. A Jupyter workspace continuation starts Jupyter; start the application through the current dated launcher afterward. See [the adapter operating guide](../deploy/openbayes/2026-10-08/README.md) for exact variables and commands.

## Attempt record and accepted remote verification

Execution 10, `kjpq8ioj0hy9`, was continued from execution 9, `yloqznsdaj7b`, with the saved home copied. The task-form upload did not retain the deployment helper. The attempt failed because the helper was missing before this deployment's database-copy/migration script ran. It is not a successful installation or server startup and must not be reported as one.

The new Jupyter workspace `77pbj3hl5zt3` copied the original saved home. Its browser upload control did not produce an observable file chooser. The official OpenBayes temporary source-upload API then uploaded only the frozen self-contained helper as source object `AVKQ9lJOoAp`. An independent download verified all 2,020,573 bytes and the helper hash. The workspace downloaded the same object through a short-lived link and verified it again before executing. The account token and storage credentials remained local memory; neither was sent into the workspace or included in the package. The signed link is temporary and is not a deployment credential.

The application was started through `nohup env` with the initial reviewed restoration variables, `INVENTORY_MANUAL_STOP=1` and `INVENTORY_PORT=8081`. Server output is retained at `/openbayes/home/battery-inventory/server-20261008.log`. The actual `inventory_ready` event identifies version `0.7.0`, the dated deployment, port 8081, 21 migrations, native authentication, preserved accounts and disabled automatic stopping. The canonical data directory resolves through the platform's saved-home link to `/output/battery-inventory/data-2026-10-08-teaching-groups`.

The independent startup audit passed 11/11 checks. It compared every one of the 11 JSON startup events with the visible Jupyter log capture, including the frozen package hash, original restoration, migration order, cell preservation and real Linux lock evidence. Evidence is in `remote-startup.log`, `remote-startup-ax.txt` and `remote-startup-verification.json` under ignored `work/openbayes-20261008/`.

The accepted public HTTP run completed at `2026-10-08T09:00:16.945Z` with 50/50 checks: the dated health response, anonymous and spoofed-identity rejection, private-file protection, original native sign-in and secure cookie attributes, closed setup, same-origin protection, preserved account membership, inventory/movement consistency, Task/message/private-group/actual-checkout reads, complete 9-record demonstration export, correct empty working-inventory export rejection, authenticated page and sign-out of the verification session. Evidence is `public-verification.json` and `public-verification.log`. The first two runs failed only because the inherited verifier incorrectly expected a file for an empty working inventory. Actual response 400 correctly stated that no batteries matched. The source already requires that response; the verifier was corrected and rerun. Both earlier reports/logs remain as `public-verification-attempt1.*` and `public-verification-attempt2.*`.

The public browser signed in with the existing native administrator password and displayed the 9 demonstration batteries with 4 in store and 5 in use. An existing four-member group showed its borrowed member and unavailable capacity evidence. Strict recommendation correctly refused unknown specifications. Manual selection of an available battery outside the fixed group showed differing model, chemistry and voltage and unknown capacity comparison, with teacher suitability confirmation required. Shared filter search and Clear filters retained the reviewed mapping. An explicit source switch required clearing manual choices, retained available fixed members and displayed the browser native-NFC limitation. Direct tag input correctly rejected an unknown exact tag without registering an asset. The review was cancelled without submitting a checkout; inventory totals and the fixed four-member group remained unchanged.

Collapse/re-expand and keyboard focus movement through the sidebar retained stable inventory row coordinates and no row transforms. Captured browser warning/error logs were empty. This does not claim physical pointer-hover tracing or all-browser animation acceptance. Browser evidence is `public-browser-verification.json`, `public-manual-review-ax.txt`, `public-tag-review-ax.txt` and `public-inventory.png`. No normal inventory movements, registration, account edits, group edits or resets were submitted.

The prior releases used Git-download launchers, which remain in the saved home as historical scripts. This execution installed the verified build directly; the dated current source was not pushed to Git. Running an old Git launcher would not reproduce this dated build. No Sites publication, Git tag or formal source freeze was performed.

Public verification used existing native sign-in, reads/exports, an explicitly rejected cross-origin session change, and sign-out of its own verification session. It does not submit setup, demo initialization, import/reset, loan movements, registration, group edits or manual task writes. No physical battery, reader, school identity integration or departmental load/availability acceptance is implied.
