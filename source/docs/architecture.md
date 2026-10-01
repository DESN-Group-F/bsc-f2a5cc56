# Architecture and design decisions

## System boundary

The browser presents the teacher's review workflow. The authenticated API validates inputs, resolves identity server-side and performs prepared SQL against Cloudflare D1. Drizzle defines a versioned schema; runtime domain operations use the D1 API directly so their transactional boundary is explicit.

```mermaid
flowchart LR
    Teacher --> UI[English web interface]
    UI --> API[Authenticated inventory API]
    API --> Store[Inventory domain]
    Store --> D1[(D1 database)]
    Reader[RFID reader: unvalidated] -. future adapter .-> API
    D1 --> Views[Inventory and history views]
    Views --> UI
```

## Data model

| Table | Responsibility |
| --- | --- |
| people | Staff owners and borrower records |
| rooms | Registered room-level locations |
| batteries | Asset identity, tag, specifications, owner and home room |
| loans | Checkout, borrower snapshot, return and correction state |
| observations | Room, observation time, receipt time and source |
| charges | Historical completion time, optional percentage, recorder |
| audit_events | Who did what, when, and relevant before/after details |
| operations | Idempotency result and transaction guard |
| workspaces | One-time demo initialization marker |

All queries are scoped to the server-provided operator ID and dataset. Demonstration and working inventories cannot mix. This is an individual private prototype: sharing the Site does not create a shared departmental inventory.

## Loan state

The database has a partial unique index allowing only one active loan for each battery. Confirmed checkout creates a loan. Confirmed return closes it. Both retain audit events. Return review may contain batteries from different borrowers.

A batch starts with an operations row whose CHECK constraint succeeds only if all expected loan states still hold. D1 batch applies that row and every movement atomically. A conflict rolls back the complete batch. Request identifiers permit safe retries after an interrupted response; reusing an identifier for a different action is rejected.

Only the most recent loan is eligible for correction. A mistaken active checkout is marked corrected; a mistaken return is reopened. The audit records the reason and pre-correction values. Existing transactions are not deleted.

## Location and charging

Loan state is independent of observations. Latest location sorts by observation time, then receipt time and insertion order. Delayed older evidence cannot replace newer evidence. Observation time and source always travel with the room.

New observations store the registered room name and building when the evidence is received. The room version, observation and audit event are checked and committed together. Later room edits do not change those stored labels. For a delayed observation, this snapshot does not reconstruct the room's name at an earlier observation time.

Older observations without saved labels retain their room ID and display that the original label is unavailable. The migration does not guess historical names. Location evidence is appended; existing observations cannot be rewritten.

Charge records use completion time rather than arrival time. Null percentage means unknown; zero is a valid historical value. Neither value is presented as current state of charge. Sydney date entry is converted to UTC and rejects skipped/ambiguous daylight-saving times.

## Metadata and relationship integrity

People, rooms and batteries have a version number. Edits must submit the version loaded by the form. A stale edit returns HTTP 409 with `record_conflict`; it changes neither the record nor its audit history. A transaction guard verifies the version again when the write commits, so a change between validation and persistence is also rejected.

The form keeps the teacher's input after a conflict. Loading the latest record retains other users' changes to untouched fields and keeps the teacher's edited fields. If both changed the same field, the form shows the saved value alongside the current proposal. The teacher reviews and explicitly saves the result.

Versioned database triggers enforce record identity, version increments and same-inventory relationships even for direct SQL writes. A responsible battery owner must be a staff record and cannot be demoted while responsible for a battery. Battery storage rooms, loan borrowers, observations and charging records must belong to the same inventory as the battery. Future table rebuilds must recreate these trigger constraints.

Existing metadata and history identifiers cannot be inserted again through SQLite replacement or upsert statements. This prevents bypassing update guards and prevents a duplicate RFID identifier from deleting another battery. Metadata changes use ordinary versioned updates; observation evidence uses new identifiers.

The additive migration leaves existing business rows in place. Trigger validation avoids a table rebuild and the foreign-key deletion behavior described in [Cloudflare D1's foreign-key guidance](https://developers.cloudflare.com/d1/sql-api/foreign-keys/). Constraint failures use SQLite's documented [trigger error mechanism](https://www.sqlite.org/lang_createtrigger.html).

## Usability decisions

- A teacher selects the borrower once for a batch.
- Unknown or duplicate tag identifiers produce visible messages before confirmation.
- Searchable registered records reduce typing; CSV import supports initial setup.
- Invalid input remains in the form for correction.
- If a write succeeds but the following refresh fails, the message says the write succeeded and requests a refresh.
- Base UI combobox popups render inside the form's container to cooperate with Radix dialog focus/dismissal.
- Browser tools can read inventory or stage a review. They cannot commit a loan; the teacher confirms through the visible interface.

## Access and operational limits

Authentication is supplied by the hosting platform. Application code uses the provider-neutral helpers in `lib/auth.ts`; exact external header and route identifiers are isolated in `lib/platform/auth-contract.ts`. Those identifiers are required by the current hosting service and cannot be renamed as application branding. Local mock authentication uses the fictional account **admin**, is limited to loopback development and is not bundled for production. API writes validate origin and JSON content; SQL parameters are bound.

Institutional access approval, shared roles, authentication through UNSW, backup/restore policy, retention and administrative tamper protection are not delivered in this prototype. Audit history is application-preserved, not a cryptographically immutable compliance ledger.

## Visual reference

The design uses the public [UNSW JAGGAER quick reference guides](https://www.unsw.edu.au/assurance-integrity/safety/systems/Jaggaer/qrg), especially [Container Operations](https://www.unsw.edu.au/content/dam/pdfs/planning-assurance/safety/jaggaer/7-Container-Operations.pdf). The reference supplies visual conventions; it does not establish an integration contract. The live protected JAGGAER application was not accessed.
