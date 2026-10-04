# Mobile NFC validation

This record concerns the local diagnostic prototype prepared on 4 October 2026. It is separate from the hosted release and from physical measurements. The reported target hardware is iPhone 13, iOS 26.6 and NTAG213 stickers. Apple identity review is pending.

User review approved the current prototype for functional testing only on 4 October 2026. The independent `0.1.0` test version is excluded from formal releases and does not change the main application's version. This approval does not resolve any pending native, signing or physical-device checks below.

## Actual results

The following checks passed at the local NFC preparation checkpoint. The full inventory regression suite also covers earlier unpublished development; its total is not a count of newly added NFC tests or a validation of subsequent independent main-application changes.

| Check | Actual result |
| --- | --- |
| Main application's TypeScript and ESLint | Passed |
| Main application's production build | Passed, including `/nfc-test`; existing bundle-size/performance warnings remain |
| Main application's domain and UI-contract suite | 538 tests passed |
| Existing isolated D1/HTTP suite | 102 checks passed against a disposable local Worker |
| NFC handoff against an isolated production Worker | 14 checks passed; a deliberately registered fictional canonical-UID fixture matched, an unknown UID remained absent, anonymous/cross-origin requests were rejected and lookup did not change battery/event snapshots |
| Mobile UID/NDEF/storage/export logic | 11 tests passed |
| Shipped plugin tests | 3 tests passed, including 55 controlled assertions against the actual Android Java control flow using API doubles; this is not Android SDK linking |
| Mobile web production build | Passed |
| iOS and Android project preparation | Passed; four plugin bindings found on each platform, iOS NFC purpose/TAG entitlement/privacy resource declarations present |
| Preparation repeatability and configuration syntax | Repeated preparation left the Xcode project unchanged; plist XML and three manually started YAML workflows parsed |
| Browser interface at 390 × 844 | No horizontal overflow or console warnings/errors; NFC reading disabled, no attempts fabricated, settings survived reload, HTTP origin rejected and HTTPS origin accepted |
| Browser report export | A real JSON download completed with an empty reports array; no hardware results were invented |

HTTP reports are local scratch records under ignored `work/qa/`: `api-iWmQqn/results.json` and `api-rGc7YV/nfc-handoff-results.json`. The latter explicitly records `matchedFixtureChecked: true`. Both isolated Workers were stopped after testing. Fixture registration is setup evidence in a disposable database, not a physical sticker read or normal business data.

No physical tag read has been performed by this application. No native Swift/Android SDK build, code signing, cloud build, TestFlight upload or hosted deployment has been completed in this preparation. Browser success does not prove an iPhone installation, NFC radio behavior or native sharing. Mobile preparation did not change the main dependency catalog or lockfile; mobile dependencies have their own lockfile.

Codemagic was observed authenticated through GitHub on 4 October 2026. Personal onboarding and the GitHub source option were selected. The page remains at repository authorization; repository access, source upload and cloud builds have not been completed. This is account setup evidence only. See [Codemagic setup](mobile-codemagic-setup.md).

## Pending checks

- Compile Swift and Java against the real platform toolchains, and correct diagnostics before producing an installable package.
- Confirm the Apple team's NFC capability, matching provisioning profile and signature.
- Run the [physical NFC protocol](mobile-nfc-test-protocol.md), retain actual attempt reports and compare raw identifiers across readers/platforms.
- Verify persistence, cancellation, interrupted-session recovery and native JSON sharing on the physical phone.
- Validate the final mounting surface, selected hardware output and any reader-to-room mapping before enabling working-inventory hardware ingestion.
- Implement and review native authentication plus the existing guarded, explicitly confirmed registration/checkout/return workflows before treating this as a complete staff application.

There are currently no measured read-success rates, physical UID samples, location observations or timing results. Do not replace these missing results with simulated values.
