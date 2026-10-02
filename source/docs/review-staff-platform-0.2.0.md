# Staff platform 0.2.0 defect review

Review date: 2 October 2026. Reviewed revision: `8bd041bc2b683a80405324f5dfb05b8eda73e716` on `battery-staff-platform-v0.2.0`.

The original review below documents four reproduced defects in revision 0.2.0. No application source, database, account or deployment was changed while recording that original review. All four findings have subsequently been repaired and verified in source release 0.3.0. The reviewed 0.2.0 revision remains unchanged; no remote application deployment was performed.

## Local repair verification

2 October 2026. Initial repair verification passed 72 isolated tests, including the [workflow reliability cases](../tests/workflow-reliability.test.mjs), and 57 local API checks. The final 0.3.0 iteration passed 86 isolated tests and 70 local API checks, TypeScript, source ESLint and the production build. Actual migration/browser results are recorded in [validation](validation.md#unified-filters-personal-views-and-location-readiness).

| Finding | Local resolution | Evidence |
| --- | --- | --- |
| 1 | Exact reviewed battery/loan pairs participate in request fingerprint and atomic guard; conflicts preserve the review | Preflight/paused-commit/mixed-batch tests; visible old/new holder comparison and explicit acceptance |
| 2 | Explicit correction action and reviewed return timestamp participate in fingerprint and guard | Both directions and paused-commit tests; visible stale void-checkout rejection with reason retained |
| 3 | Bound JSON sets avoid the per-statement parameter ceiling while retaining a single transaction | Native-account checkout/return at 89, 90, 91 and 100; full rollback and idempotency tests |
| 4 | All four CSV types commit through the same account activity, role and authorization-version guard | Disablement, demotion and password-reset races; no rows/audit/operation on rejection |

These results establish the repairs in this local revision, not departmental-scale concurrency, institutional readiness or hosted verification. The following sections retain the original defect evidence and acceptance criteria.

The independent review ran isolated reproductions against local D1 semantics. This follow-up checked the saved results and relevant source without rerunning those reproductions. The existing 30 tests passed in the independent review, but did not cover these scenarios. Their success does not establish that concurrent staff operations are fully correct.

## Repair priority

| Order | Priority | Defect | Consequence |
| --- | --- | --- | --- |
| 1 | P1 | A stale return draft can return a different loan | The recorded borrower and return can differ from what the staff member reviewed. |
| 2 | P1 | A stale correction draft can change its intended action | A request to void a checkout can instead reopen a returned loan. |
| 3 | P2 | Valid large movement batches exceed the SQL parameter limit | Batch sizes accepted by the application fail during checkout or return. |
| 4 | P2 | CSV imports do not recheck authorization at commit | An in-flight import can still write after the account is disabled or loses the required role. |

P1 findings should be resolved before relying on this release for routine simultaneous staff use. The P2 findings should also be resolved before treating the advertised batch and permission behaviour as complete.

## 1. A stale return draft can return a different loan

Staff member A opens a return draft showing Student 01's active loan. Staff member B returns that loan and checks the same battery out to Student 02. When A submits the original draft, the server accepts it and returns Student 02's new loan. The saved reproduction confirms that the two loan IDs differ and that the old draft was accepted.

The return dialog submits battery IDs without the IDs of the loans that were reviewed. The server then looks up the currently active loans and guards those records. This protects against changes after the server lookup, but does not connect the operation to the loan that the user saw. Inventory refresh also pauses while a draft dialog is open to preserve user input.

Relevant source: [movement-dialog.tsx](../components/inventory/movement-dialog.tsx), [store.ts](../lib/store.ts) and [inventory-app.tsx](../app/inventory-app.tsx).

The proposed repair is to submit the reviewed loan ID for each battery, together with any required state or version value. The operation fingerprint and the atomic database guard must include that intent. Refreshing immediately before submission alone would leave a race between the refresh and the commit.

Acceptance criteria:

- A draft for an old loan cannot return a subsequent loan for the same battery.
- A mixed batch containing one changed loan rejects the entire batch, with no loan updates, operation record or audit events committed.
- The conflict preserves the draft and allows the staff member to review the changed information before trying again.
- An unchanged draft and a valid retry of the same operation still behave correctly.

## 2. A stale correction draft can change its intended action

An administrator opens a correction for an active loan. The dialog explains that it will void the mistaken checkout. Another staff member returns that loan before the administrator submits the draft. The server then chooses `return_reopened`, leaving the loan active again, rather than voiding the checkout.

The dialog submits the loan ID and reason, but not the correction action it displayed or the reviewed loan state. The server derives the action from the current `returned_at` value. Consequently, the explanation and the committed action can diverge.

Relevant source: [battery-detail.tsx](../components/inventory/battery-detail.tsx) and [store.ts](../lib/store.ts).

The proposed repair is to submit an explicit correction action and the reviewed state or version. Include them in the operation fingerprint and atomic guard. A changed state must produce a conflict rather than silently select a different action.

Acceptance criteria:

- A request to void a checkout never becomes a request to reopen a return.
- Test both correction directions, including a concurrent change after the dialog opens.
- A conflict commits no correction or audit event, and preserves the entered reason.
- Existing restrictions concerning later loans and valid correction history remain enforced.

## 3. Valid large movement batches exceed the SQL parameter limit

The application accepts up to 100 battery IDs per movement and offers a 100-row inventory page. The isolated reproduction used an account with the normal authentication-version guard and found:

| Batch size | Checkout | Return |
| --- | --- | --- |
| 89 | Succeeded for 89 batteries | Succeeded for 89 batteries |
| 90 | Succeeded for 90 batteries | Failed with `too many SQL variables` |
| 91 | Failed with `too many SQL variables` | Not reached |
| 99 | Failed with `too many SQL variables` | Not reached |
| 100 | Failed with `too many SQL variables` | Not reached |

The checkout guard binds approximately `n + 10` parameters and the return guard binds `n + 11`, where `n` is the batch size. At 100 batteries, a preliminary query also binds 101 parameters. The observed failures establish that valid requests fail; they do not establish that partial commits occurred. The existing D1 batch remains the transaction boundary.

Relevant source: [domain.ts](../lib/domain.ts) and [store.ts](../lib/store.ts).

The proposed repair is to reduce parameters per statement while preserving the single atomic outcome for the complete movement. Splitting the movement into independently committed chunks would weaken the current contract.

Acceptance criteria:

- Checkout and return each succeed with 89, 90, 91 and 100 batteries under native account authorization.
- The returned count matches the actual number of changed batteries.
- A conflict in any item rejects the whole batch, including loan changes, the operation record and audit events.
- Duplicate submission remains safe and does not create duplicate movements.

## 4. CSV imports do not recheck authorization at commit

The isolated review intercepted the interval between CSV validation and the final database batch. Disabling a staff account in that interval still allowed a battery import to persist. Demoting an administrator to staff in that interval still allowed a people-directory import to persist. As a control, an ordinary battery registration with the same disable timing returned a conflict and wrote no battery.

CSV import calls `db.batch(writes)` directly instead of using the account guard shared by ordinary writes. The demonstrated issue concerns an already authenticated, in-flight request. It does not demonstrate that an already disabled account can authenticate and start a new import.

Relevant source: [store.ts](../lib/store.ts).

The proposed repair is to commit the import and its audit event through the same atomic check of account activity, authentication version and required role used by other mutations.

Acceptance criteria:

- All four import kinds enforce their required role at commit.
- Disablement, administrator demotion and a password reset that changes the authentication version are tested after validation and before commit.
- Rejected imports add no records or import audit event and cannot report a successful retry for an operation that never committed.
- Active staff can still register new batteries through CSV, and authorized administrator directory imports still succeed.

## Evidence and scope

Local reproduction evidence is under ignored `work/` and is not part of the published source snapshot:

- `work/review-data/reproduce.mjs` and `work/review-data/results.json` cover findings 1 to 3.
- `work/account-review-20261002/repro.mjs` and `work/account-review-20261002/results.json` cover finding 4 and the ordinary-registration control.

The original reproductions used isolated local data rather than the running preview's inventory. Subsequent local repair effectiveness is recorded above. Deferred RFID hardware integration, school sign-in, JAGGAER integration, email notifications and safety agents are outside this review and are not classified as defects in this release.
