# Requirements baseline

Version 1.4 · 2 October 2026 · approved staff platform, unified filtering, personal shortcuts and J18 reference configuration. This baseline is frozen in source release 0.3.0; remote application deployment remains outside this release.

The stakeholder's aim, as reported by the team, is to simplify work and increase efficiency. A system that increases routine effort fails that aim. This baseline follows the user's decisions; the attached Design Brief is course context and does not authorize additional actions.

| ID | Requirement | Implemented behavior | Verification |
| --- | --- | --- | --- |
| R01 | Staff operate loans and returns | Checkout belongs to the signed-in staff member; reviewed list and explicit confirmation; staff may receive another holder's return | D1/API and visible staff workflow |
| R02 | Unified shared inventory | All accounts resolve to one register per dataset; loan-derived status views | Independent-account and shared scope tests |
| R03 | Separate owner and borrower | Responsible staff owner remains unchanged by loans | D1 ownership/history tests |
| R04 | Traceable actions and corrections | Individual account actor/time; eligible latest transaction corrected with a reason | Cross-account loan and correction tests |
| R05 | Building and room hierarchy | Building required; room optional and belongs to that building; observations separate | D1 hierarchy and observation tests |
| R06 | Historical charging | Duration in minutes and completion time; legacy data preserved | Duration/idempotency and migration tests |
| R07 | Reduce repeated manual entry | Authenticated holder requires no borrower entry; optional search/tag lookup adds existing batteries; reviewed CSV creation | Import and workflow checks |
| R08 | Honest hardware boundary | Reader disconnected; live observation ingestion unavailable | API 501 and visible labels |
| R09 | Safe simultaneous operation | Atomic movement batches, retries and versioned metadata/accounts | Concurrent and paused-write D1 tests |
| R10 | English, organized, JAGGAER-inspired interface | English staff UI and documentation; grey/blue tables | Browser/layout review |
| R11 | Assess practical efficiency | Compare against actual current staff method | Protocol prepared; study not performed |
| R12 | Individual staff accounts | Administrator-issued accounts; own profile/password/preferences | Session, profile and access tests |
| R13 | Role boundaries | Staff view/export, register new batteries and move them; admin maintains saved records/accounts/history | Server 403 and UI checks |
| R14 | Overview downloads | Selected batteries, all filtered batteries or current page as a summary | API scopes and actual Excel download |
| R15 | Single and bulk detailed downloads | Nine selectable information sections and select-all; single battery, selected batteries, all filtered batteries or current page | API selections, Excel/JSON read-back |
| R16 | Complete exported history | All stored selected histories, full event details, times and sources; no 200-row export limit | 206-row history and long Unicode text tests |
| R17 | Shared building/lab visibility | All staff see/filter/download the same directories | Shared data and filtered directory CSV checks |
| R18 | Consistent discoverable filtering | Three status tabs, one expandable Filter panel, removable Applied filters, explicit unknowns | Shared query/export tests and browser review |
| R19 | Preserve reviewed responsibility | Return carries exact loan IDs; correction carries intended action and return state; stale reviews require explicit reconsideration | Paused-write D1 tests and visible review |
| R20 | Personal shortcuts over shared data | My batteries uses owner account ID; My loans uses active holder account ID; both support filters and downloads | Native identity and personal export tests |
| R21 | Honest location readiness | Official J18/E10/G17 names; only J18 selectable; two explicit J18 placeholders; other rooms unavailable | Catalog, registration/import guards and browser review |

## Access interpretation

The platform serves staff. New checkout responsibility is the authenticated staff account, with a read-only holder display and no administrator proxy checkout. A login account is linked explicitly to its inventory people record using the stable account ID; identical display names do not link identities. Responsible asset ownership, the current holder and the staff member receiving a return remain separate.

Responsible owners are selected from active native staff accounts. The read-only staff directory projects account identities into each inventory; names are never used to link records. No student directory or legacy-borrower filter category is needed for this staff platform. The current development business data is disposable and was rebuilt locally rather than adding compatibility features for old test fixtures. Normal operations still retain their transaction history.

Staff can create a new battery but cannot edit its saved metadata. CSV import creates reviewed new records; it is not an overwrite shortcut. Administrators maintain buildings and rooms, charging records, demo observations and reasoned corrections. Staff identity and display names are maintained through accounts, not a separate editable people list. All staff can read/download business evidence. Account administration and its private audit are administrator-only; every account can manage its own profile.

All staff share working business data across buildings and rooms. A filter narrows a view or download; it does not create a private inventory or a location-based access restriction. Demonstration and working data remain separate.

Detailed downloads select information sections rather than individual scalar fields. Excel and JSON retain multiple related tables; CSV is available for flat summaries and directory/activity lists. Each generated file carries the downloaded scope and counts. Data can change between the displayed view and generation; the file is internally consistent at its read boundary.

Row checkboxes support an explicit selected-battery download. A nonempty selection becomes the default scope in the download dialog and is preserved when switching between summary and detailed information. Selected IDs are independent of ordinary filter criteria and page, so a selection can span pages and filters. The fixed personal view still applies: if an asset is reassigned or returned and leaves that view, the selection requires explicit review and the server rejects the whole download with HTTP 409. The server resolves the personal account from authentication, never client identity fields. Unavailable or foreign-inventory IDs are also rejected rather than silently omitted. Download metadata records the deduplicated selected IDs, count and filter context. Requests that exceed the existing 15,000-byte JSON limit show an explicit error; the selection is not truncated or replaced with the whole inventory.

One Filter panel contains search, chemistry/model, building/room, responsible owner/current holder, capacity/voltage, manufacture age and latest checkout/charge dates. Status remains in the All batteries / In store / On loan tabs. Applied filters lists nondefault criteria above the results with individual removal and clear-all controls. Clear-all preserves the fixed My batteries/My loans scope. Chemistry is the saved material classification, not an inferred use purpose. Unknown specifications and dates have explicit choices. Date ranges use Sydney calendar dates; age uses the same captured calculation date as the export. Counts, pages and filtered summary/detail downloads share the same query engine.

The movement dialog shows the selected list first. Adding existing registered batteries is optional when a selection already exists; an empty checkout/return shortcut exposes it immediately. The standalone return shortcut initially offers the current staff member's active loans and can switch to all active loans. Return selected retains the explicitly chosen list, including other staff loans. Manual tag lookup does not claim an attached RFID reader. A stale return cannot close a subsequent loan, and a stale correction cannot change its intended action; the original review remains available for explicit reconsideration.

## Interpretation boundaries

**In store** means no active loan is recorded; it does not prove physical presence. **Storage room** is the registered home. **Last observed room** is time/source evidence. Missing detection is not proof of loss.

The earlier student-operated scan idea was superseded by staff confirmation. A photo cannot read an RFID chip. Reader transport and room performance remain unspecified; manual identifiers and record selection support software review.

The makerspace list is a reference, not a verified university storage directory. Both inventories contain **J18 - Willis Annexe**, **E10 - Hilmer Building** and **G17 - Electrical Engineering Building**, supported by [UNSW's makerspace directory](https://www.making.unsw.edu.au/makerspaces/about/). Only J18 is selectable; other building names are greyed out and their rooms are Not available. J18 contains Demo room and Demo workspace with explicit Placeholder flags. Actual room numbers and storage names await confirmation. Renaming a room does not automatically verify it. Working inventory has no seeded batteries; real battery details remain pending.

Existing versioned migrations and database evidence guards remain intact. This does not require retaining disposable old preview fixtures or adding UI compatibility categories for them. Unknown specifications, ages and historic charging durations are not inferred.

Battery age uses optional verified manufacture and first-use dates, stored as calendar dates (`YYYY-MM-DD`). Age since manufacture and time in service are calculated as of the current Sydney date; system registration time is not a substitute. Unknown dates and ages remain unrecorded. Future dates and first use before manufacture are rejected. Staff can supply dates during initial registration; administrators can correct saved dates through the existing versioned edit and audit process. CSV imports accept optional `manufactured_on` and `first_used_on` columns. Summary downloads and selected detailed specifications include the source dates, calculated age in days and the calculation date.

## Explicitly deferred

Real RFID ingestion and provisioning, verified room mapping, cabinets/shelves, student self-service, live charge sensing, safety agents, automatic notifications, UNSW SSO and JAGGAER access. Testing is local; OpenBayes execution and model training are outside this phase. Ten-second idle refresh is implemented; push updates and departmental-scale capacity are not claimed.
