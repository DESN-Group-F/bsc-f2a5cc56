# Requirements baseline

Version 1.0 · 1 October 2026 · approved conversation scope.

The stakeholder's stated aim, as reported by the project team, is to simplify work and increase efficiency. A technically complete system that increases routine effort fails that aim. This baseline follows the user's decisions; the attached Design Brief is course context, not a source of additional authorization.

| ID | Requirement | Implemented behavior | Verification |
| --- | --- | --- | --- |
| R01 | Teachers operate loans and returns | One borrower per checkout batch, reviewed list, explicit confirmation | Browser batch checkout/return |
| R02 | Unified inventory | One battery table; status views derived from loans | D1 lifecycle tests |
| R03 | Separate owner and borrower | Staff owner remains unchanged by loans; current borrower clears on return | D1 ownership/history test |
| R04 | Basic traceability | Loan history and audit events retain actor/time; latest transaction may be corrected with a reason | D1 and browser correction tests |
| R05 | Room-level observed location | Timestamped, sourced observations stored separately from home room | Demo observation and ordering tests |
| R06 | No live battery-level requirement | Manual charge completion time, optional historical percentage | Null/zero/range/time tests |
| R07 | Reduce repeated manual entry | Borrower selected once per batch; searchable registered records; CSV import; duplicate readings ignored | Browser review and import checks |
| R08 | Honest hardware boundary | Reader shown as disconnected; real observation endpoint disabled | API 501 and UI labels |
| R09 | Protect against duplicate/conflicting actions | Idempotent movement submissions and atomic batch guards | Concurrent D1 tests |
| R10 | English, organized, JAGGAER-inspired UI | English copy, grey/blue administration layout, documented structure | Browser/layout review |
| R11 | Assess practical efficiency | Compare with the stakeholder's actual current method | Protocol prepared; study not performed |

## Explicitly deferred

Real RFID ingestion, reader provisioning, verified room mapping, cabinets/shelves, student self-service, real-time charge, safety-agent actions, automatic notifications, school SSO, shared multi-teacher workspace and JAGGAER access.

## Interpretation boundaries

**In store** means no active loan is recorded. It does not prove physical presence. **Storage room** is the registered home. **Last observed room** is evidence at a particular time. Missing detection is not proof of loss.

The earlier student-operated scan idea was superseded by teacher-operated checkout and return. A photo cannot substitute for reading an RFID chip. The current software allows manual tag identifiers and record selection while hardware remains unspecified.
