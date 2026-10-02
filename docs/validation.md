# Validation record

1 October 2026 · Windows portable development preview.

## Shared staff platform release

2 October 2026 · Release 0.2.0 · Windows local preview and isolated Miniflare D1. Earlier dated sections describe their own releases; private per-operator access is superseded by the shared staff platform.

| Check | Actual result |
| --- | --- |
| Domain/account/export/D1 tests | 30 passed, 0 failed |
| Local API checks | 44 passed, including native HTTP file downloads |
| TypeScript | Passed on final source |
| Scoped application/test ESLint | Passed with 0 errors and 0 warnings |
| Production build | Passed for client, server and Worker bundles |
| Legacy preview retention | All original values across ten business tables preserved; zero foreign-key violations; SQLite integrity check returned ok |
| Actual browser file downloads | Current-page Excel, filtered detailed Excel, selected single-battery JSON, directory CSV and admin account CSV downloaded and read back |

The migration review used a backup of the earlier isolated preview, leaving the separately retained original local state untouched. Its baseline held 7 batteries, 4 people, 3 buildings, 4 rooms, 2 loans, 4 charges, 1 observation, 7 audit events, 6 operations and 1 initialization marker. Migration 0004 and the shared mapping retained every original row and value, including old scope keys and actor/history evidence. Five fictional QA batteries and subsequent QA movements were added in the copied preview. The resulting preview contains 12 batteries; that is test stock, not a confirmed university inventory.

### Automated boundary evidence

- Independent accounts resolve to the same dataset while demo/working data stay separate. Staff can register a new battery and move shared assets, but cannot edit saved metadata, maintain directories/evidence, correct loans or administer accounts.
- Concurrent checkout has one winner and no partial batch. Account disabling or role changes after movement validation reject the write at its commit guard. Original ownership and individual checkout/return operators remain traceable.
- Setup requires an installation secret and can create only one initial administrator. Passwords have distinct salts; persisted session tokens are hashes. Self-profile inputs cannot elevate roles or alter another account. Disabled/reset accounts lose previous sessions; stale account updates and removal of the last active administrator are blocked.
- Anonymous downloads and spoofed old hosting identity headers/cookies cannot grant access. Cross-origin writes and malformed inputs are rejected. URL-normalized sign-in return paths stay on the application origin.
- Detail exports retain 206 charging records while the detail view displays only 200. A 72,001-code-unit Unicode audit value is preserved across Excel text parts. Selected sections exclude unselected tables; detailed CSV requests are rejected to avoid losing related tables.
- Business and account histories resist replacement/upsert bypasses. Multiple legacy scopes return a review requirement and leave their records intact rather than silently selecting or merging them.

### Visible workflow evidence

Administrator and regular staff sign-in, personal profiles, shared inventory, permission-specific controls, filtering, pagination and export selections were reviewed in the local browser. Staff had no account administration or saved-metadata edit controls, while new-battery registration and lending remained available. The administrator account list showed the two fictional local accounts.

The downloaded second-page workbook contained exactly QA-BULK-04 and QA-STAFF-001. A filtered detailed workbook contained six batteries and the selected evidence/directory worksheets. A single-battery JSON export with only loan history selected contained Batteries and Loans tables. The filtered directory CSV held one matching person; the admin account CSV held two accounts and no password, session or authorization-version fields. Empty detail selection disabled Download.

A second authorized client changed the fictional staff profile while its administrator edit form was open. The stale save was rejected without saving the draft. Review latest account retained the edited display name, loaded the untouched changed email and showed the saved values for comparison. The draft was cancelled and the fictional account's original profile values restored; those test actions remain in account audit history.

A separate staff client checked out a QA battery while the administrator's filtered inventory stayed open. The page automatically changed to On loan with the registered borrower, retaining its search text. An administrator return subsequently appeared as In store. The peer test session was revoked after verification. This establishes visible refresh in the tested case, not push delivery or a load capacity guarantee.

Narrow-window navigation was checked and now closes after choosing a page. Desktop export layout and the current narrow account form were inspected. The local launcher was restarted successfully against the same isolated state and retains the preview at http://127.0.0.1:5173/.

### Corrections during validation

The first browser download approach used a temporary blob; the in-app browser did not reliably report or save it. Server-generated HTTP attachments replaced that approach, and the resulting files were actually downloaded and parsed. The dev server also exited once with Windows EBUSY while watching a temporary release backup. Work, database-state and build directories are now excluded from watching; the launcher was restarted successfully. A late account-message edit had a missing JSX brace, caught by static checking and repaired before the final type/lint/build passes.

QA receipts, screenshots, credentials and private database backups stay in ignored work/qa/ or work/local-access files. They are not committed as project deliverables. During this work, a separate source-cleanup workflow replaced the published frozen tag with the neutral source snapshot 667de0c. Its changes from the original 9f76089 baseline are limited to publishing instructions, ignored tool state and the optional watch-polling environment setting; business source is unchanged. The original baseline remains in local refs. This staff release uses the reviewed frozen source as its publication base and does not modify its tag. The separate inspection workflow proposal stays a draft outside this implemented release.

### Remaining limits

No actual RFID hardware, school SSO, JAGGAER API, email or safety agent was tested. No departmental-scale load test, formal penetration test or stakeholder efficiency trial was performed. Institutional approval, production secret/HTTPS configuration, backup/retention policy and any multiple-register legacy migration remain release gates. This source was built locally; it was not deployed to OpenBayes or the earlier hosted Site. No model training was performed.


## Building, room and charging revision

2 October 2026 · Local development and isolated D1 review. Earlier sections retain the results and limitations of their dated releases; percentage entry described in the initial release is superseded by this revision.

| Check | Actual result |
| --- | --- |
| Domain/D1 regression tests | 23 passed, 0 failed |
| TypeScript and scoped application ESLint | Passed on the final source |
| Production build | Passed after the final interface changes |
| Local API boundary checks | 8 passed |
| Existing local database upgrade | Original columns/rows across nine business tables matched the pre-upgrade backup; zero foreign-key violations |

The retained local database contained 8 batteries, 5 people, 5 rooms, 4 loans, 4 charging records, 2 observations, 22 audit events, 15 operations and 1 workspace marker. Migration 0003 preserved all original values, including versions, identifiers, actors, history and legacy charging percentages. Historic charging durations and unmapped building references remained unknown. A backup and comparison receipt are retained in ignored `work/qa/`; no private database contents are included in project deliverables.

An isolated preview database was used for UI checks, separate from those retained records. Observed outcomes:

- The working inventory offered only J18 - Willis Annexe, with no people, rooms or batteries. The makerspace reference list was not imported as stock or staff.
- A new fictional battery was registered with J18 and an unspecified room; optional specifications and tag stayed blank.
- A fictional alternate building and its room were registered through the management forms. The room ID was derived automatically, avoiding repeated number entry.
- The battery's room choices contained only rooms in the selected building. Changing buildings cleared the old room and offered only the new building's room; the saved hierarchy survived a page reload.
- A zero-minute charging attempt was rejected while retaining the input. A 90-minute record displayed its completion time and remained readable after reload.
- A demo room observation displayed building, room, time and the explicit Demo observation source; it did not assign the registered home room or change loan status.

Screenshots are retained under ignored `work/qa/`. No real RFID or stakeholder efficiency experiment was performed. The duration/time input is a manual historical record, not a measurement or safety judgement.

The OpenBayes execution d1jh04u8xzi3 was stopped and the console visibly showed closed with duration 16:43:34. Its mapping no longer displayed a usable public address. The stop dialog confirmed retention of the working directory; saved file contents and final settled charges were not re-inspected. This revision was not deployed to OpenBayes or the earlier hosted Site. No model training was performed.

## Initial implementation results

| Check | Result | Scope |
| --- | --- | --- |
| TypeScript | Passed | Application and component types |
| Application ESLint | Passed | Application, domain and inventory components; one documented asynchronous-fetch rule exception |
| Production build | Passed | Vinext client, server and Worker bundle |
| Domain/D1 tests | 12 passed, 0 failed | Real Miniflare D1 transactions and constraints |
| Local API checks | 8 passed | Authentication boundary, validation, origin and pending hardware |

Domain tests cover demo/live/operator isolation, ownership and borrower history, movement deduplication and retries, conflicting atomic batches, concurrent checkout, overlapping returns, observation ordering/source, null versus zero charge, future/range validation, reasoned corrections, latest-loan protection, unique identifiers, atomic imports, CSV quoting/formula export and Sydney daylight-saving conversion.

The initial test run had two assertion failures comparing equivalent timestamp strings. Expected values were corrected to canonical UTC ISO format; domain behavior did not change for those failures.

Local API checks verify unauthenticated access returns 401, supplied identity headers cannot bypass local sign-in, non-JSON returns 415, malformed JSON returns 400, cross-origin writes return 403, working inventory remains empty, unknown batteries return 404 and real RFID observations return 501.

## Browser results

- Demonstration inventory loads from the database with actual computed status counts.
- A staged two-battery checkout requires visible confirmation; duplicate tag input is ignored.
- Checkout survives a page reload. Return clears current borrowers and retains history.
- Historical charge of 0% displays as 0%, not as missing data.
- Demo observation stores a room, time and source without changing loan status.
- Correcting a return reopens the loan and retains the original return and correction reason in audit history.
- Invalid person ID leaves the name and ID in the form; correcting the ID permits registration.
- A new asset can be registered with unknown specifications and unassigned tag.
- Editing an asset updates its displayed record.
- CSV import presents a preview and saves a confirmed example room.
- Switching to working inventory displays an empty register without fictional records.
- Browser tools expose read and stage operations, reject invalid input and do not directly persist movements.

A dropdown initially dismissed its parent form when an option was chosen. Rendering its popup inside the form container fixed the issue; room and owner selections were retested successfully.

Desktop at 1440 × 900 and mobile at 390 × 844 were inspected. The teacher's review form fits the narrow screen, and wide inventory columns scroll within their table. Search displays the matching record with saved room/time/source evidence.

## Not verified

No real RFID reader, tag, room discrimination, battery-level sensor, school SSO, shared workspace, JAGGAER API, email delivery or AI safety agent was tested. No stakeholder efficiency trial has been performed. Hosted production behavior has not been exercised as a separate browser test.

These results establish a working software prototype within the stated scope; they do not establish readiness for departmental deployment.

## Application naming cleanup

1 October 2026. Application authentication helpers and build integration use neutral names. Exact hosting authentication routes and headers are isolated in a platform contract. Required hosting configuration, environment keys and third-party license notices remain intact.

- TypeScript and production build passed after the cleanup.
- The existing eight local API checks passed again.
- The local preview reports the fictional account as **admin**. Its stable database key is retained, and all seven existing preview batteries and twelve audit events remain readable.
- The extra record-retention check initially used an incorrect expected asset ID. It passed after using the stored ID; no records were changed to satisfy the check.
- A sign-in request with an external return URL redirects safely to `/` and retains the HttpOnly/SameSite cookie flags.
- Inventory domain logic, schema and hosted account IDs were unchanged. Domain tests and hosted browser tests were not rerun for this naming change.

## Database integrity repairs

1 October 2026. The database review reproduced stale-form overwrites, a race between staff demotion and battery registration, room labels changing historical observations, and direct cross-inventory references. A final isolated SQL probe also reproduced replacement statements bypassing update triggers: replacing the responsible staff row left six fictional batteries with a non-staff owner.

- People, rooms and batteries now use versioned edits with an atomic audit boundary. Stale forms and edits that lose a race return `record_conflict` without changing records or adding misleading audit events.
- New observation labels are stored at receipt, including the building. Older missing labels remain unavailable and retain a stable room ID. Delayed packets do not reconstruct historical room names at their earlier observation time.
- Versioned triggers enforce same-inventory references, stable identities, staff ownership and ordinary versioned updates. Duplicate-record insertion guards block replacement/upsert bypasses and replacement through an already assigned RFID identifier.
- Domain/D1 regression tests: **21 passed, 0 failed**. Cases cover both concurrent orders, post-validation races, direct SQL bypass attempts and migration of an existing register with loan, charging, observation and audit history.
- TypeScript passed after the interface and domain changes. Production build and all eight local API checks passed again with the final replacement-guard migration.
- The local preview database was backed up before migration. Migrations `0001` and `0002` were applied once, without rebuilding tables or modifying the already applied `0000` migration.
- Local browser checks confirmed stale-save blocking, preservation of teacher input, merging of untouched fields, comparison of overlapping changes, explicit reviewed saving, and location history retaining the original room/building after a rename.
- One browser automation attempt displayed a different name from the value subsequently saved, with unexpected extra input characters. Its precise input source was not established. Controlled input and immediate submission were then checked against both the rendered register and the API; the intended name and independently changed capacity matched. This establishes the successful recheck, not a diagnosis of the earlier input interference.

The hosted read-only preflight found no invalid owner, loan, observation or charging relationships. Its nine-table baseline contained six batteries, four people, three rooms, two loans, three charge records, one audit event and one initialization marker; observations and operations were empty. This is a migration baseline, not a stakeholder efficiency result. Post-publication read-back is retained in local QA output and the task record.

Screenshots and probe outputs remain under ignored `work/qa/`. Real RFID ingestion, shared departmental access and institutional readiness remain unverified.

### Hosted migration compatibility

The first integrity publication failed at 09:14:27 UTC with `incomplete input: SQLITE_ERROR`. A full nine-table read-back found every business row unchanged, and all five columns added by `0001` were absent. This identifies `0001_inventory_integrity` as the first pending migration; `0002` follows it and was not reached. The applied `0000` migration and its metadata were left unchanged.

Failure identifiers: Site `appgprj_6abdfbe8cc5c81919d49ecfd26786287`; version `appgprj_6abdfbe8cc5c81919d49ecfd26786287~appgver_362fefcd15d08191aedc416edfcd117d`; deployment `appgdep_6abe2469448c8191807fc6f0463ac8d6`.

Cloudflare's official issue tracker reports remote splitter failures with [CRLF trigger migrations](https://github.com/cloudflare/workers-sdk/issues/14991) and [unparenthesized CASE inside triggers](https://github.com/cloudflare/workers-sdk/issues/4727). Those reports are consistent with this failure, but the deployment error did not expose its exact parser path. The pending trigger migrations were changed to LF with Git attributes and equivalent conditional `SELECT RAISE ... WHERE` statements. Their schema snapshots did not change. Fresh isolated D1 tests and a new archive validate the corrected migrations before another publication; they do not treat the first failed deployment as successful.
