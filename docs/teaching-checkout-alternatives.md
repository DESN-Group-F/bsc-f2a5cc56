# Temporary teaching checkout alternatives

8 October 2026 · Local implementation after frozen release 0.7.0. No publication or deployment.

## Review a checkout

Open **Teaching groups**, open your fixed group and choose **Check out group**. Selected members use the same review. Available fixed members remain selected. Members held by someone else can receive temporary alternatives. A member already held by you is an existing loan: return or explicitly exclude it. Missing and retired members need group maintenance or explicit exclusion.

**Replace unavailable batteries** fills unresolved slots with strict suggestions. Review the original and actual battery, specifications, registered home and selection source, then choose **Confirm actual checkout**. Suggestions do not reserve stock. Checkout belongs to the signed-in native account and does not change fixed membership, ownership or storage homes.

Strict matching requires exactly equal, known recorded **model, chemistry, capacity (mAh) and voltage (V)**. Blank/null/invalid specifications never establish equivalence. Eligible candidates are active, unborrowed, in the same inventory and fixed personal scope, and not selected for another slot. Room preference uses existing non-placeholder registered room/building relationships: first favour the majority of retained actual members, then rooms covering more remaining matching slots, with stable natural Battery ID ties. Missing, stale and placeholder locations are not inferred; observations do not become storage homes. This deterministic heuristic is not a globally optimal route or physical compatibility check.

## Manual selection and NFC

When no strict candidate is available, choose **Choose manual alternative**, select the original member and use the shared **Filter**. Search, model/specifications, location, people, Age & activity, sorting, Applied filters and Clear filters retain their shared meanings. Candidates may be outside the fixed group but remain inside the eligibility/personal boundary. Clear filters resets criteria/page and retains the reviewed mapping.

Manual alternatives may have different or unknown specifications. The review shows both records and their differences/unknowns, labels the choice **Manual alternative**, and requires teacher confirmation. The system does not certify teaching suitability.

**Entered tag** locates an exact registered identifier. **Native NFC** uses the mobile prototype's foreground native read, cancellation and explicit adoption. A read first stages an identifier proposal; explicit adoption and inventory lookup can add an existing asset to the review. Reading cannot register, borrow, return or change a group. Unknown/cross-inventory tags, duplicate choices, unavailable stock and failed/cancelled reads have explicit results. The browser states that native NFC is unavailable and retains inventory selection and entered tags.

Each manual queue has one explicit input source. Switching clears existing manual choices only after review; original members and automatic suggestions remain selection evidence. Excluded choices from another source cannot silently re-enter. Typed tags never become hardware evidence. Native evidence retains the platform, full canonical UID in validated byte order, raw NDEF records, device attempt/read times and adoption time. Names and NDEF URLs cannot establish identity. Device evidence is not a server attestation or proof of physical acceptance.

## Actual loans, history and deletion

**Actual group checkouts** appears in group cards and opened groups. Search and outstanding-only criteria have Clear filters. Runs persist independently of later group edits/archiving. **Return this checkout** returns all or selected outstanding actual batteries with their saved Loan IDs and reviewed current versions/tags. Returned/cancelled/deleted loans cannot be replaced with a later loan. Ordinary returns and corrections update that same saved loan's status.

Additive migration **0020** stores immutable run identities with purge-only snapshot changes and evidence revision triggers. Evidence includes historic group identity/name/version/owner, requested original members, original/actual bindings and specification/storage snapshots, original and actual Loan IDs, method/source, differences/match result, borrower and server time. Unused fixed membership and notes stay in private versioned group history; shared runs contain the members used in the business operation.

Shared Activity shows expandable actual member actions and original → actual mappings. Partial-return summaries include only that operation's returned members. **Download checkout / JSON** includes mappings, source evidence, exact status and complete retained checkout/return/reopen/void history for the saved Loan IDs, including receiving actors/times. Later loans are excluded. Actual exporter identity is separate from historical borrower identity. Existing detail exports keep their complete-history semantics.

Authorized admin deletion of a Scrapped asset clears its histories and related structured asset snapshots. A deleted actual mapping loses raw NFC/source/loan evidence; comparisons involving a deleted asset are removed. Independent assets, Task/group definitions and human notes remain. Minimal BAT IDs and hashed tag/request reservations prevent identity reuse and delayed-write resurrection; exports never reconstruct deleted evidence.

## Atomic protection and recovery

One D1 batch protects native authority, group ownership/version/membership, original exact loans, all original/actual versions and tags (including null), lifecycle, personal scope and actual loan absence, then commits the receipt, loans, run and audit. Concurrent suggestions are not reservations: a losing checkout must be reviewed again.

Before POST, the complete draft and exact request are stored under account/inventory keys and read back. Mobile storage is also flushed. Failure blocks submission. An unknown outcome locks the original ID/payload/source; **Retry same request** cannot read another tag or select another battery. Only a matching receipt or durable final rejection resolves it. Navigation, inventory changes and sign-out preserve recovery. Valid exact attempts take priority over redundant drafts. Receipt verification permits only minimal authoritative deletion of historical evidence during an unaffected exact return; other changes remain failures.

Web recovery requires the same intact tab/account/inventory; closing the tab or changing devices does not transfer unresolved input. Confirmed runs are server-persistent. Mobile pending storage is durable. Requests are bounded to 100 actual batteries and a 250,000-byte client preflight. Oversized reader evidence remains in the draft and is never truncated; reduce the batch or explicitly change source.

Per-asset audit currently repeats the run snapshot. The 100-member test passes; long-term history size and staff time savings remain unmeasured. Actual test/browser results are in [validation](validation.md). Native SDK compilation, signing, installation and physical NFC acceptance remain external; the mobile test build is separate from the formal release.
