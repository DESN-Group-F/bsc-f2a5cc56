# Requirements baseline

Version 1.2 · 2 October 2026 · approved staff platform and shared inventory scope. Implemented application release: 0.2.0.

The stakeholder's aim, as reported by the team, is to simplify work and increase efficiency. A system that increases routine effort fails that aim. This baseline follows the user's decisions; the attached Design Brief is course context and does not authorize additional actions.

| ID | Requirement | Implemented behavior | Verification |
| --- | --- | --- | --- |
| R01 | Staff operate loans and returns | One borrower per checkout batch; reviewed list and explicit confirmation | D1/API and visible staff workflow |
| R02 | Unified shared inventory | All accounts resolve to one register per dataset; loan-derived status views | Independent-account and shared scope tests |
| R03 | Separate owner and borrower | Responsible staff owner remains unchanged by loans | D1 ownership/history tests |
| R04 | Traceable actions and corrections | Individual account actor/time; eligible latest transaction corrected with a reason | Cross-account loan and correction tests |
| R05 | Building and room hierarchy | Building required; room optional and belongs to that building; observations separate | D1 hierarchy and observation tests |
| R06 | Historical charging | Duration in minutes and completion time; legacy data preserved | Duration/idempotency and migration tests |
| R07 | Reduce repeated manual entry | Borrower once per batch; searchable records; reviewed CSV creation | Import and workflow checks |
| R08 | Honest hardware boundary | Reader disconnected; live observation ingestion unavailable | API 501 and visible labels |
| R09 | Safe simultaneous operation | Atomic movement batches, retries and versioned metadata/accounts | Concurrent and paused-write D1 tests |
| R10 | English, organized, JAGGAER-inspired interface | English staff UI and documentation; grey/blue tables | Browser/layout review |
| R11 | Assess practical efficiency | Compare against actual current staff method | Protocol prepared; study not performed |
| R12 | Individual staff accounts | Administrator-issued accounts; own profile/password/preferences | Session, profile and access tests |
| R13 | Role boundaries | Staff view/export, register new batteries and move them; admin maintains saved records/accounts/history | Server 403 and UI checks |
| R14 | Filtered overview downloads | All filtered batteries or current page as a summary | API scopes and actual two-row Excel download |
| R15 | Single and bulk detailed downloads | Nine selectable information sections and select-all; single battery or all filtered batteries | API selections, Excel/JSON read-back |
| R16 | Complete exported history | All stored selected histories, full event details, times and sources; no 200-row export limit | 206-row history and long Unicode text tests |
| R17 | Shared building/lab visibility | All staff see/filter/download the same directories | Shared data and filtered directory CSV checks |

## Access interpretation

Students are borrower records, not platform accounts. Login identities and inventory people are distinct: a responsible-owner record does not grant system access.

Staff can create a new battery but cannot edit its saved metadata. CSV import creates reviewed new records; it is not an overwrite shortcut. Administrators maintain people, buildings and rooms, charging records, demo observations and reasoned corrections. These maintenance actions follow the administrator-only saved-information boundary. All staff can read/download their business evidence. Account administration and its private audit are administrator-only; every account can manage its own profile.

All staff share working business data across buildings and rooms. A filter narrows a view or download; it does not create a private inventory or a location-based access restriction. Demonstration and working data remain separate.

Detailed downloads select information sections rather than individual scalar fields. Excel and JSON retain multiple related tables; CSV is available for flat summaries and directory/activity lists. Each generated file carries the downloaded scope and counts. Data can change between the displayed view and generation; the file is internally consistent at its read boundary.

## Interpretation boundaries

**In store** means no active loan is recorded; it does not prove physical presence. **Storage room** is the registered home. **Last observed room** is time/source evidence. Missing detection is not proof of loss.

The earlier student-operated scan idea was superseded by staff confirmation. A photo cannot read an RFID chip. Reader transport and room performance remain unspecified; manual identifiers and record selection support software review.

The makerspace list is a reference, not a verified university storage directory. Working inventory begins with **J18 - Willis Annexe** and no people, rooms or batteries. J18 115 is the project-space reference; actual storage remains unconfirmed. Additional locations are not guessed from the list. J18's name is supported by the [UNSW school contact page](https://www.unsw.edu.au/engineering/our-schools/mechanical-and-manufacturing-engineering/about-us/contact-us).

Legacy identifiers, labels, actors, loans, observations and charging percentages are preserved. Unknown historic charging duration and specifications remain unknown. The single local legacy register was adopted without rewriting it. Multiple private legacy inventories need a reviewed migration before sharing.

## Explicitly deferred

Real RFID ingestion and provisioning, verified room mapping, cabinets/shelves, student self-service, live charge sensing, safety agents, automatic notifications, UNSW SSO and JAGGAER access. Testing is local; OpenBayes execution and model training are outside this phase. Ten-second idle refresh is implemented; push updates and departmental-scale capacity are not claimed.
