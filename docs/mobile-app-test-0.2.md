# Mobile App Test 0.2.0

## Purpose and release boundary

Prepare the complete existing inventory business interface while Apple membership review is pending. This local functional-test iteration is independent of the formal release sequence. It does not authorize publication, hosted backend changes, cloud builds, TestFlight uploads or real RFID ingestion.

The first physical target remains the operator-declared iPhone 13 and NTAG213 sticker. The earlier Shortcuts/Safari trial remains separate evidence and does not validate the installed application's Core NFC plugin.

## Included source

- Staff and administrator login, shared inventory and personal scopes, filters, battery details and complete history.
- Reviewed single/bulk checkout and return, authenticated self-checkout, exact tag/version/loan guards and original-request recovery.
- Teaching groups, task plans, messages, model creation/selection, intake/removal and role-controlled administration reused from the existing client.
- Summary/detail downloads, native file/share adapter and explicit recovery export.
- Demonstration-only recoverable operator registration, automatic permanent ID and server registration time. Canonical NFC UID or no tag; J18 with an optional room. Unknown specifications and dates remain unknown.
- Explicit native NFC read/cancel, raw UID/NDEF evidence, interrupted-read recovery, proposal confirmation and JSON evidence export. Browser NFC remains unavailable.
- Fixed-origin native HTTPS service transport. Session cookies stay in Keychain or Android Keystore-encrypted preferences; business files are separate. Local credential reset does not claim server revocation.

`scripts/sync-mobile-frontend.mjs` snapshots the runtime client graph into `mobile/src/shared/`, rejects server imports and records hashes. Narrow mobile adapters replace browser-tab recovery, page navigation and downloads; persistent workflow boundaries prevent leaving a station through the additional App navigation. Business permissions remain enforced by the backend.

## Recovery and truthful source handling

Captured requests are stored before POST. Native business files use Foundation atomic writes or Android AtomicFile, followed by complete readback. Browser preview uses an isolated localStorage envelope. Storage failure blocks new mutations; unreadable saved data is never silently replaced. The reviewed original request is retained after response loss and retried only through an explicit action.

Verified registration receipts and pending-request removal are persisted together. A failed acknowledgement retains the original pending request. Temporary synchronous draft state can exist while a save is in progress; the UI shows that state and blocks further actions. Force termination during that interval may leave the last acknowledged draft. No network mutation is sent until its captured request has been acknowledged by storage.

An NFC result is independent device evidence. Selecting **Use identifier as operator input** confirms the proposed identity for the reviewed business workflow. The movement records retain their operator input source; the application does not relabel that source as an accepted hardware observation or infer a reader-to-room mapping. No NDEF URL is opened automatically, and no tag is written or locked.

## Local test

From the project root:

```powershell
cd mobile
npm ci
npm test
npm run test:plugin
npm run build
node ../scripts/prepare-mobile-native.mjs --all
cd ..
node scripts/start-mobile-app-test.mjs --phone-address 192.168.1.102 --port 5182
```

Replace the example private address if this computer changes network. Open `/mobile-preview` through `127.0.0.1` on the computer to view fictional temporary credentials. The phone opens the LAN App URL and signs in with a fictional test account. Setup credentials are not exposed through the LAN setup route. This service uses disposable local D1 data and does not access the hosted inventory.

Test: login; register an untagged battery; review and confirm; check the assigned ID; queue both tagged and untagged assets; refresh and recover; explicitly confirm checkout; confirm self-holder; exit; return the exact loans; inspect history/export; verify private groups and administrator boundaries. Browser input exercises business behavior only.

## Actual checks on 5 October 2026

- Full mobile production web bundle built successfully with 100 snapshotted client files.
- Mobile tests: 29 passed, zero skipped. Includes storage failure/corruption, save-before-POST/read, original-request retry, concurrent acknowledgement, malformed/cancelled/interrupted NFC and truthful browser unavailability.
- Native adapter controlled tests: six passed, zero skipped. Production Java code exercised with SDK/HTTP/vault doubles, including 55 NFC lifecycle, 95 service policy and 115 service/atomic-file orchestration assertions. These are not Android SDK or real file-system acceptance.
- Isolated real HTTP/D1 business checks: 36 passed, covering recoverable registration and tagged/untagged guarded checkout/return. Report: `work/qa/api-qxgEvD/mobile-business-results.json`.
- Main domain/UI-contract regression: 567 passed, zero skipped. TypeScript and scoped ESLint passed. Source-export fixtures: 11 passed with complete frontend/plugin/helper selection and LF manifest integrity.
- iOS and Android assets/plugin references synchronized. NFC declarations, entitlements, package linkage and privacy resource checks passed. No SDK compilation is implied.
- At a 390 by 844 browser viewport, fictional staff login succeeded. Registration returned `BAT-00000001` with server time, null tag and unknown specifications. The two-entry mixed tag/no-tag queue survived refresh; both batteries checked out to the signed-in staff account and both returned with unspecified placement. Stations remained open until explicit exit. The inventory's registration entry opened the same recoverable workflow.
- Staff created a private one-member teaching group. Sign-out succeeded; the administrator's teaching-group workspace correctly showed no access to that staff group. Administrator task and administration navigation loaded. The browser document had no horizontal overflow at the tested narrow viewport.
- The inventory registration dialog also bound the operator-confirmed known UID to `BAT-00000002`, refreshed inventory immediately and showed the correct separate UID, registration time and unknown fields in battery details. This is operator entry against a real local backend, not an App radio read.
- Browser NFC evidence export was clicked, but the browser automation download event timed out. A completed file save was not independently verified for this new build. Existing server export/binary response checks do not establish browser or native share acceptance.

A local source-only archive was prepared at `work/mobile-test-snapshots/mobile-business-test-020-20261005.zip` (248 source files; SHA-256 `2dfaa5dd966913b6919826f1e91cba8c1d42d156e386e8598aac3102a0cc449e`). A clean dependency install, standalone snapshot-manifest verification, web production build and two-platform native synchronization succeeded in its separate copy. No backend, credentials, business database, Git history or signing material is included. The archive contains the checkpoint documentation from its creation; later checks are recorded here without replacing that archive. No publication or cloud execution occurred.

## Remaining acceptance gates

1. Compile the native projects against current Xcode/iOS and Android SDKs. Correct compiler or runtime integration errors if found. The current Windows checks cannot prove Swift compilation or iOS file protection.
2. After Apple review, confirm team and bundle identifier, enable NFC capability, configure signing and a compatible authorized HTTPS test backend, then install a signed test build. Membership approval alone does not complete these steps.
3. On the iPhone: login/logout/expiration and corrupt-vault recovery, native export/share, keyboard/safe-area use, background/restart and forced-termination recovery, HTTPS transport and all visible workflow checks.
4. Use the known sticker UID `04:9F:7C:62:A6:20:90` to verify UID order, leading zero, cancel/timeout/duplicate/unsupported behavior and ten declared-condition reads. Confirm every read proposes the correct asset and cannot commit without review. Record actual outcomes separately.
5. Repeat platform acceptance on an NFC-capable Android phone. Neither browser testing nor iPhone testing establishes Android hardware support.

Real hardware observations, formal-release inclusion and deployment require their own completed acceptance and user-designated milestone.

## Dependency and size notes

Only the independent mobile package catalog/lockfile changed. Vite was updated within major version 8 to remove its reported Windows development-server vulnerability. The remaining npm audit findings are three moderate development-tool findings through Capacitor CLI → xcode → uuid; the installed xcode caller uses UUID v4, while the reported buffer issue concerns v3/v5/v6. They remain disclosed and unresolved; no forced major dependency substitution was applied. The bundled business chunk is about 1 MiB before gzip, so native startup and low-memory behavior still require device measurement.

The iOS privacy manifest declares own-app service preferences and filesystem export reasons. Reference: [Apple required reason API guidance](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest). Submission privacy answers must be reviewed against the final backend and distribution configuration.
