# Temporary teaching checkout alternatives

Updated 10 October 2026 · Local 1.0.0 development. No publication or deployment.

## Review a checkout

Open **Teaching groups** to review ongoing actual checkouts first. Open a group to see its default members below the actual checkout section. **Check out group** and selected members use the same review. Available default members remain selected. Active members can receive an explicitly selected temporary alternative. For a member already held by you, **Continue using** retains the exact existing Loan ID and original checkout time. Missing and retired members need group maintenance or explicit exclusion.

**Replace unavailable batteries** fills unresolved slots with strict suggestions. Review the original and actual battery, specifications, Last observation and selection source, then confirm the actual checkout. Suggestions do not reserve stock. Checkout belongs to the signed-in native account and does not change default membership, ownership or storage homes. Last observation includes time and source and cannot confirm the battery's present location.

Strict matching requires exactly equal, known recorded **model, chemistry, capacity (mAh) and voltage (V)**. Blank/null/invalid specifications never establish equivalence. Automatic candidates are active, unborrowed, in the same inventory and fixed personal scope, and not selected for another slot. Natural Battery ID provides deterministic ordering. Manual selection may explicitly continue a battery already held by the same native account. The same active loan cannot cover multiple teaching runs. Neither registered home nor Last observation is used to claim physical availability or to certify compatibility.

## Complete the substitution lifecycle

Temporary A → B changes only the actual checkout. A remains a default group member, and any independent loan of A remains untouched. If A becomes available while B is still borrowed, the checkout continues using B. Returning B ends its temporary use; no manual restoration is required before the next checkout uses the current default group again.

When the group already has outstanding batteries, starting a checkout first offers **Continue existing checkout**. Uncovered current default members can be added to that run with a reviewed **continue** request. A deliberate **Start separate new checkout** permits another session with distinct actual batteries; it cannot duplicate an existing active Loan ID. Covered members otherwise require the existing run's continuation or exchange workflow. Later group edits apply to future selections and do not rewrite historical runs.

**Exchange battery** reviews the outgoing exact loan and incoming battery. The actual-hand-back checkbox starts unchecked. When checked, the server returns the outgoing loan and creates or associates the incoming loan in one guarded transaction. When unchecked, both responsibilities remain outstanding and the earlier battery is labelled pending return. Substitution, damage and missing assets never silently settle a loan. Each change is appended with an incrementing run revision; the original run remains immutable. Ordinary returns continue updating the matching exact loans.

**Make replacement permanent** shows one A → B default-membership change. It preserves the loaded group name, notes, other members and ordering, and uses the existing versioned group-update endpoint and exact-request recovery. Another tab's intervening edit rejects the review rather than being merged or overwritten. The old battery remains in inventory, and neither current loans nor earlier runs are changed. There is no automatic adoption of an entire actual checkout as the default group.

## Manual selection and NFC

When no strict candidate is available, choose **Choose manual alternative**, select the original member and use the shared **Filter**. Search, model/specifications, location, people, Age & activity, sorting, Applied filters and Clear filters retain their shared meanings. Candidates may be outside the fixed group but remain inside the eligibility/personal boundary. Clear filters resets criteria/page and retains the reviewed mapping.

Manual alternatives may have different or unknown specifications. The review shows both records and their differences/unknowns, labels the choice **Manual alternative**, and requires teacher confirmation. The system does not certify teaching suitability.

**Entered tag** locates an exact registered identifier. **Native NFC** uses the mobile prototype's foreground native read, cancellation and explicit adoption. A read first stages an identifier proposal; explicit adoption and inventory lookup can add an existing asset to the review. Reading cannot register, borrow, return or change a group. Unknown/cross-inventory tags, duplicate choices, unavailable stock and failed/cancelled reads have explicit results. The browser states that native NFC is unavailable and retains inventory selection and entered tags.

Each manual queue has one explicit input source. Switching clears existing manual choices only after review; original members and automatic suggestions remain selection evidence. Excluded choices from another source cannot silently re-enter. Typed tags never become hardware evidence. Native evidence retains the platform, full canonical UID in validated byte order, raw NDEF records, device attempt/read times and adoption time. Names and NDEF URLs cannot establish identity. Device evidence is not a server attestation or proof of physical acceptance.

## Actual loans, history and deletion

**Actual group checkouts** appears in group cards and opened groups. Search and outstanding-only criteria have Clear filters. Runs persist independently of later group edits/archiving. **Return this checkout** returns all or selected outstanding actual batteries with their saved Loan IDs and reviewed current versions/tags. Returned/cancelled/deleted loans cannot be replaced with a later loan. Ordinary returns and corrections update that same saved loan's status.

Additive migration **0020** stores immutable run identities with purge-only snapshot changes and evidence revision triggers. Migration **0022** adds append-only continuation/exchange evidence and preserves identity, account and same-inventory guards. Evidence includes historic group identity/name/version/owner, requested original members, original/actual bindings and specification/storage snapshots, original and actual Loan IDs, method/source, differences/match result, borrower and server time. Unused default membership and notes stay in private versioned group history; shared runs contain the members used in the business operation.

Shared Activity shows expandable actual member actions and original → actual mappings. Partial-return summaries include only that operation's returned members. **Download checkout / JSON** includes mappings, source evidence, exact status and complete retained checkout/return/reopen/void history for the saved Loan IDs, including receiving actors/times. Later loans are excluded. Actual exporter identity is separate from historical borrower identity. Existing detail exports keep their complete-history semantics.

Authorized admin deletion of a Scrapped asset clears its histories and related structured asset snapshots. A deleted actual mapping loses raw NFC/source/loan evidence; comparisons involving a deleted asset are removed. Independent assets, Task/group definitions and human notes remain. Minimal BAT IDs and hashed tag/request reservations prevent identity reuse and delayed-write resurrection; exports never reconstruct deleted evidence.

## Atomic protection and recovery

One D1 batch protects native authority, group ownership/version/membership, original exact loans, all original/actual versions and tags (including null), lifecycle, personal scope and actual loan absence, then commits the receipt, loans, run and audit. Concurrent suggestions are not reservations: a losing checkout must be reviewed again.

Before POST, the complete draft and exact request are stored under account/inventory keys and read back. Mobile storage is also flushed. Failure blocks submission. An unknown outcome locks the original ID/payload/source; **Retry same request** cannot read another tag or select another battery. Only a matching receipt or durable final rejection resolves it. Navigation, inventory changes and sign-out preserve recovery. Valid exact attempts take priority over redundant drafts. Receipt verification permits only minimal authoritative deletion of historical evidence during an unaffected exact return; other changes remain failures.

Web recovery requires the same intact tab/account/inventory; closing the tab or changing devices does not transfer unresolved input. Confirmed runs are server-persistent. Mobile pending storage is durable. Requests are bounded to 100 actual batteries and a 250,000-byte client preflight. Oversized reader evidence remains in the draft and is never truncated; reduce the batch or explicitly change source.

Per-asset audit currently repeats the run snapshot. The 100-member test passes; long-term history size and staff time savings remain unmeasured. Actual test/browser results are in [validation](validation.md). Native SDK compilation, signing, installation and physical NFC acceptance remain external; the mobile test build is separate from the formal release.
