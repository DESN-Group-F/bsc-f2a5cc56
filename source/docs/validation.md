# Validation record

1 October 2026 · Windows portable development preview.

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
