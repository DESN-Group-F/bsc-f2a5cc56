# Validation record

1 October 2026 · Windows portable development preview.

Current frozen source: [release 0.3.0](releases/0.3.0.md), 2 October 2026. Its final implemented iteration passed 86 isolated tests and 70 local API checks; see [the current validation section](#unified-filters-personal-views-and-location-readiness). Earlier sections retain their dated results and limitations.

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

## Battery age

2 October 2026. Batteries now store optional manufacture and first-use calendar dates. The register and details calculate age since manufacture and time in service using the current Sydney date. Completed calendar months use anniversaries clamped to the last day of shorter months; exported ages use exact elapsed calendar days and include the calculation date. Unknown dates remain null and are not inferred from registration time, loans or charging history.

- The full isolated suite passed **44 tests, 0 failures**, including 11 new date/storage/migration tests and three new export tests. Cases cover leap and century rules, month ends, Sydney midnight and daylight saving, future and reversed dates, staff registration versus administrator editing, mixed invalid CSV batches, stale date edits, direct SQL guards and preservation of earlier integrity triggers and history.
- TypeScript, scoped ESLint and the production build passed.
- The first full test run had one failure because the new migration test requested `PRAGMA integrity_check`, which the local D1 interface rejected as unauthorized. The test now uses supported foreign-key checking and exact record/history comparisons. The complete suite then passed.
- Migration `0005` adds two nullable columns and date-validation triggers without rebuilding tables. The local preview state was backed up before applying it. Counts before and after were unchanged: 12 batteries, four people, three buildings, four rooms, seven loans, four charging records, one observation, 19 audit events and 17 operation records. All 12 batteries initially retained null lifecycle dates, and foreign-key checking found no violations.
- Browser checks confirmed the date inputs, unknown-age display, saved dates, calculated age and clearing dates back to unknown. A temporary check on the fictional `QA-STAFF-001` used manufacture date `2024-10-02` and first-use date `2025-01-15`. The interface displayed **2 years** and **1 year, 8 months, 17 days** as of `2026-10-02`. The example dates were then cleared through the normal administrator edit; the test edits remain in the audit history.
- The first automated fill changed the date input's DOM value without updating the controlled form value. Normal keyboard input updated the form and persisted the dates correctly, as verified against the server audit and read-back. A partial keyboard deletion also left an incomplete native date input; clearing all its segments restored a valid blank field. These observations distinguish the automation/input behavior from the successfully verified saved-date workflow.
- An actual browser Excel download contained nine worksheets. Read-back confirmed both example dates, manufacturing age **730 days**, time in service **625 days** and calculation date `2026-10-02`. After restoration, an API read confirmed both dates were null and all 12 batteries remained present.

Local screenshots, backup and download-check evidence remain under ignored `work/qa/`. The running local preview was updated; hosted migration and deployment were not performed. The four open concurrency/import findings in [the staff-platform review](review-staff-platform-0.2.0.md) remain unresolved and are not covered by a claim that the age change makes the entire platform reliable.

## Downloads of checked batteries

2 October 2026. The reported interface showed two checked batteries while its detailed download still targeted all 12 filtered batteries. The prior checkbox selection was not part of the export request. The register now provides **Download selected** and defaults the normal download dialog to the checked IDs when a selection exists. Summary and detailed information keep the chosen selected, filtered or current-page range when the information depth changes.

- Export requests now carry a deduplicated explicit selected-ID scope. It is independent of filtering and pagination, includes only related battery evidence and rejects missing or different-inventory IDs as a whole. The dialog freezes the chosen ID list and allows staff to inspect it. Oversized JSON requests produce an explicit error rather than truncation or a broader download.
- The full isolated suite passed **51 tests, 0 failures**, including seven new selected-export tests. Coverage includes exact IDs/counts, complete selected history beyond 200 records, related-directory exclusion, CSV/Excel/JSON read-back, staff access, empty/malformed/contradictory scopes, foreign-inventory rejection, cross-page selection and 201 IDs without truncation. Existing age and export tests also passed.
- TypeScript, scoped ESLint and the production build passed.
- Browser validation checked `BAT-001` and `BAT-002`, opened **Download selected**, and confirmed **Selected batteries (2)**. Switching to detailed information retained the same two IDs and count.
- Actual downloaded Excel files were read back. The summary workbook had two worksheets and exactly those two battery rows. The detailed workbook had nine worksheets and exactly those two battery rows; its loan, charge, observation and operation records contained no other explicit battery IDs. Related directories contained only `demo-staff`, `demo-store` and `J18` for this example.

Screenshots and read-back results are under ignored `work/qa/`. These checks downloaded existing local demonstration data and did not register or change batteries, loans or account permissions. The earlier staff-platform concurrency/import findings remain open.

## Staff responsibility, filters and reliability

2 October 2026. The approved local workflow now checks batteries out to the authenticated staff account, with no alternate-holder fields accepted. Account and inventory-person identity are linked explicitly; original unlinked loans remain legacy history. Common and optional advanced filters share one query model with counts, pages and downloads. The four findings from the original 0.2.0 review are repaired in this local revision.

- The full isolated suite passed **72 tests, 0 failures**. Twelve new workflow tests cover spoofed identities/names, same-name directory separation, reserved-ID collision rejection, original legacy loans and returns, stale reviewed returns before and after validation, both stale correction directions, actor-bound retries, native checkout/return batches at 89/90/91/100, all-or-nothing rollback including new directory linkage, CSV authorization races, immutable original identity/history and additive migration preservation. Nine filter tests cover unknown values, bounds, native holder identity, latest valid checkout, Sydney date/DST comparisons and filtered/selected export consistency. Existing age and selected-export regressions still pass.
- **57 local API checks passed**, including server permissions, strict self-checkout, administrator proxy rejection, cross-account receipt, holder-linked export, missing reviewed state rejection, stale return/correction protection, invalid ranges, selected downloads outside filters, account/session boundaries and real Excel attachments.
- TypeScript, scoped ESLint and the production build passed. The final 100-battery UI guard disables oversized movement selections with visible guidance without limiting selected downloads.
- Migration `0006` was applied once after stopping the preview and backing up its state under ignored `work/qa/workflow-preview-backup-1790931860080`. Before/after counts were identical: 12 batteries, four people, three buildings, four rooms, 11 loans, four charge records, one observation, 28 audit events and 23 operations. Exact people/loan read-back preserved all old fields and added only null account references. Foreign-key checking found zero violations. The isolated migration test additionally compares preserved business tables and integrity guards.
- During development, automatic hot reload exposed the new snapshot query before migration, temporarily producing missing-column/503 responses. The preview was stopped, backed up, migrated and restarted; the subsequent API/browser checks succeeded. No history was rewritten to resolve those responses.
- Browser checkout showed **Checked out to: admin · admin**, the selected battery first and collapsed optional adding. Confirming `QA-STAFF-001` saved the native holder. The sidebar return shortcut then showed exactly that account-linked outstanding battery; historical loans were available under all loans. An explicit selected return for `BAT-003` retained its original **Demo Student 01 / Legacy borrower** responsibility without applying the personal-loan filter.
- For a visible stale-return check, a separate authenticated local request returned the reviewed admin loan and checked the battery out as Demo Staff. The old form returned 409, retained the admin review and disabled confirmation. **Review latest loans** showed the original and different latest loan; **Accept reviewed changes** explicitly changed the draft before another confirmation returned the Demo Staff loan as admin. An initial attempt was interrupted by development hot reload resetting component state; the completed conflict check used the still-old loaded record and a newly prepared review after the code stopped changing.
- For a visible stale-correction check, an admin form displayed the action to void its active checkout and retained the entered reason. Demo Staff returned that loan before submission. The form rejected the correction, retained the original void action/reason, and history refresh showed the genuine return still intact. No return was reopened or checkout voided by the rejected request.
- Browser filters `Li-ion` and capacity minimum 4,000 mAh produced one matching battery, with status counts **1 / 0 / 1**. Two explicitly selected IDs remained selected, including one outside the filters. Actual Excel read-back confirmed the detailed selected download contained exactly `BAT-003` and `QA-STAFF-001` across nine worksheets, with native and original student loan history and lifecycle fields retained. Changing the range to all filtered batteries generated a two-worksheet summary containing only `BAT-003`.
- The first workbook read-back assertion treated exported empty cells as SQL nulls and used an incorrect expected age-column name. Inspecting actual headers/cells corrected the checker to the existing export contract; both downloaded files then passed. No export or inventory data was changed to satisfy that assertion.

Browser checks added genuine fictional checkout/return records and their audit events. `QA-STAFF-001` ended in store; other original active loans were retained. Evidence/screenshots remain under ignored `work/qa/`. The earlier source release, remote Site and OpenBayes were not updated. No real reader, school identity, email, safety agent, load study or stakeholder efficiency experiment was tested.

## Unified filters, personal views and location readiness

2 October 2026. The approved iteration keeps the three status tabs, places all other battery criteria under one Filter panel, displays Applied filters, and adds My batteries/My loans to the sidebar. The user explicitly identified current business data as disposable test data. Old preview fixtures were replaced with fresh local state instead of adding legacy-borrower compatibility features. Local native test accounts and session hashes were retained; no business rows were copied. Normal new operations still retain their history.

- **86 isolated tests passed, 0 failures**, including ten native personal-inventory tests and four location-catalog tests. Coverage includes distinct account IDs despite identical names, owner versus active holder, personal filters/pages/exports, server-authenticated scope despite forged client IDs, selected-scope changes, active-owner checks at atomic commit, disabled-account attribution, placeholder renaming, J18 write limits, and incremental migration guards. Existing age, selected-history, concurrency, import and permissions tests passed.
- **70 local API checks passed**, including shared native identity, the empty working battery register, official reference names and placeholder flags, unsupported building/room creation/import rejection, both accounts' personal filtered exports, self-checkout, cross-account receipt, stale transaction guards, complete downloads and session boundaries.
- TypeScript, source ESLint and the production build passed. An initial broad lint invocation included archived/generated files inside ignored work/ and reported errors there. Lint now excludes work/ and dist/ explicitly; the final source check passed without warnings. Initial test failures used obsolete demo IDs and seeded student loans; fixtures were updated to explicit native staff accounts and prepared test loans without weakening application constraints.
- Migration 0007 was applied to fresh isolated local preview state with zero foreign-key violations. Its final observation trigger was separately exercised through the running API: a simulated BAT-002 observation saved **Demo room — Placeholder** with source **Demo observation**. No physical room detection was implied.
- Browser review confirmed the collapsed Filter control, status tabs, removable Applied filters, and greyed-out E10/G17 choices. The staff registration form offered only J18 plus optional **Demo room — Placeholder / Demo workspace — Placeholder**. No Legacy borrower category appeared.
- A staff checkout of BAT-001 changed the sidebar's active-loan count to one. My loans showed only that battery; Search narrowed it, and an actual Excel download contained exactly BAT-001 and personalScope **borrowed** in Export information. An early automation input produced jumbled search text; explicit controlled input and a real key event corrected it. The workbook checker initially expected a Metadata worksheet, then used the actual Export information worksheet and passed. Neither incident changed application records.
- While BAT-001 remained selected in My loans, a different account returned it and changed its responsible owner. Refresh retained selection, displayed **Your selected batteries have changed scope**, and disabled download/movement actions until explicit removal. Clear filters preserved My loans. A subsequent staff checkout showed **admin** as responsible owner and **Demo Staff** as current holder, with sidebar counts of five responsible batteries and one current borrowing.

The final local demonstration contains six fictional batteries, one active native staff loan, two loan records, three fictional charge records and one explicitly simulated observation. Working inventory remains without batteries. Both inventories have three reference buildings and two J18 placeholder rooms. Real battery specifications and verified rooms remain pending. Official names were checked against [UNSW's makerspace directory](https://www.making.unsw.edu.au/makerspaces/about/) and [contact directory](https://www.making.unsw.edu.au/access/contact-us/).

Evidence remains in ignored work/qa/: reference-domain-tests.log, staff-api-results.json, reference-build.log, reference-preview-reset.json, reference-browser-api-results.json, reference-personal-filter.png and reference-scope-change.png. Testing used local loopback; no source push, remote deployment or model training was performed. Stakeholder workload reduction remains a proposed measurement, not a demonstrated outcome.
