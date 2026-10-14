# Mobile NFC validation

## iOS TestFlight preparation — 14 October 2026

The current React/Capacitor client **0.5.2 (5)** has been signed and uploaded to App Store Connect. Apple processed it and shows **Testing** in the **Owner Internal Testing** group. The user subsequently reported opening the installed app, then supplied an iPhone screenshot showing **Saved work needs attention**. Installation and rendering are user-reported/visible evidence; successful initialization, sign-in and physical NFC have not passed. The exact installed build has not been independently read back from the phone.

- Published source: `codex/ios-functional-test-052`, commit `d31bedbdfa12f5913dc43542140a61a2736260ec`; 486 manifest entries plus the manifest verified against Git blobs.
- External isolated Windows validation: **742 mobile tests and 9 plugin checks passed, zero failures/skips**; clean installation and frontend build passed. Dependency/exporter regression checks: **32/32**.
- [Signed Codemagic build](https://codemagic.io/app/6ac2188a6a40dee54624182a/build/6acecdb3546ce6236cee5805): **688 passed, zero failures, 43 optional browser/CSS skips**, plus **9/9 plugin checks**. The skipped checks passed in the local isolated run. Archive, signed IPA export and Apple upload succeeded.
- Downloaded IPA: SHA-256 `985d942300045d3f0a3d2fca128cae8c3d3d7689012af66f4b9d2a61f049b3fe`. Version/build, bundled frontend, disabled iOS bridge logging and the embedded signed NFC profile were checked. IPA, logs, dSYMs, hashes and inspection evidence are retained under ignored `work/ios-testflight-052-build5/`.
- Earlier failures are retained: the initial cloud run lacked `esbuild` and did not stop on test failure; local isolation exposed Windows junction behavior and inherited JSX test settings. The final source declares its dependencies, configures JSX explicitly and stops all cloud script blocks on failed commands. See [the full setup and evidence record](mobile-codemagic-setup.md).

The expanded error supplied by the user is **Business recovery data could not be read. Existing files were preserved; do not replace pending work.** This maps to the native iOS `BusinessDataStore.load()` failure before the sign-in screen. The published implementation recognizes only one Foundation missing-file error when opening a new scope; the precise native failure remains to be reproduced. Earlier JavaScript and compilation checks did not execute this native first-install path.

The user now prioritizes service-independent NFC testing before software design. Repair the startup blocker, then use **Device diagnostics → NFC field test** without signing in or configuring a service. Validate read/cancel/repeat, background return and report export first. Sign-in and inventory qualification are deferred. Reviewed business operations require an explicitly authorized test inventory. Working native NFC remains disabled. This preparation did not mutate hosted inventory data, submit for external beta review or publish to the public App Store.

## Historical diagnostic prototype — 4 October 2026

For the subsequent full business App Test `0.2.0` results, see [the separate 5 October 2026 record](mobile-app-test-0.2.md). Historical Test `0.1.0` results below remain unchanged and do not establish native acceptance of the new App.

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

At the initial local preparation checkpoint, no physical tag read, native Swift/Android SDK build, code signing, cloud build, TestFlight upload or hosted deployment had been completed. The later unsigned iOS cloud result is recorded below. Browser success does not prove an iPhone installation, NFC radio behavior or native sharing. Mobile preparation did not change the main dependency catalog or lockfile; mobile dependencies have their own lockfile.

Codemagic was observed authenticated through GitHub on 4 October 2026. Personal onboarding and the GitHub source option were initially selected. At that initial checkpoint the page was waiting at repository authorization; source publication and cloud builds were still pending. See the later publication record below and [Codemagic setup](mobile-codemagic-setup.md).

## Standalone source preparation

The local source archive `work/mobile-test-snapshots/nfc-functional-test-20261004-b.zip` was prepared on 4 October 2026. It contains 110 files including its source manifest, with 109 source-file hashes and sizes checked individually. Its SHA-256 is `e53a24b59f7522007d10a32885d312fea6ab3bd4a8e54a76e6ab48de6455e30d`. The archive excludes the main backend, business data, original Git history, installed dependencies, build outputs and signing files. Required native configuration and third-party notices were retained. Secret-pattern checks are limited safeguards, not a guarantee for every credential format.

In a separate copy of that source, a clean dependency installation, 11 mobile tests, 3 plugin tests (including 55 controlled Java lifecycle assertions), web build, two-platform sync and native declaration/privacy checks all passed. The original source files and ZIP remained unchanged after verification. Nineteen local documentation links resolved. At this archive-preparation checkpoint, native compilation, signing, installation, cloud execution and physical NFC were still unperformed.

The active archive YAML includes only manual unsigned iOS verification and Android debug workflows. The TestFlight workflow remains an inactive template. Detailed actual records are under `work/mobile-test-validation/nfc-functional-test-20261004-b/`: `standalone-checks.json` and `source-verification.json`. The archive's copied validation document is the earlier preparation record; this later archive-validation result is retained separately here.

## Authorized test-source publication

The user approved source upload and then directed use of the existing project repository instead of creating a new private repository. The reviewed source snapshot was published to [the NFC functional-test branch](https://github.com/DESN-Group-F/bsc-f2a5cc56/tree/codex/nfc-functional-test) on 4 October 2026. The existing repository is public, so the test branch is public too.

The published commit is `1b753fc6bbc72df391ec15b368e6b5001d866e94`, with author and committer `admin <admin@inventory.local>` and message `Prepare NFC functional test 0.1.0`. It is a fresh source-only root commit. All 109 manifest source-file hashes matched their committed blobs, 110 files were tracked including the manifest, and the remote branch hash matched the local commit. The publication used a separate scratch Git checkout; no existing branch was overwritten. The exact record is retained at `work/mobile-test-publication/publication-record.json`.

Codemagic accepted the public Git URL and created an Ionic/Capacitor test application without an additional GitHub repository installation/permission step. Its Personal billing page showed 0 of 500 free macOS minutes used before the first run and an **Enable subscription** button; no paid subscription was enabled. The `codex/nfc-functional-test` branch and its root YAML were selected. Source publication alone does not establish native compilation, signing, TestFlight distribution or physical NFC acceptance.

## First unsigned iOS cloud build

[Codemagic build 1](https://codemagic.io/app/6ac2188a6a40dee54624182a/build/6ac219b87394575b200aedcb) completed successfully on 4 October 2026. Its overview identified **Mobile iOS compile check**, **Mac mini M2**, branch `codex/nfc-functional-test`, commit `1b753fc`, and duration **1 minute 13 seconds**. The Xcode log explicitly ended with `** BUILD SUCCEEDED **`.

The job installed the independent mobile package, completed its test/web-build/preparation step, resolved Swift packages and compiled/linked the App and NFC plugin for arm64 iPhoneOS. The log identifies Xcode 26.6, iPhoneOS SDK 26.5 and Swift 5 mode. The workflow used `CODE_SIGNING_ALLOWED=NO`. The artifact panel listed `App.app.zip` (669.29 KB) and the build-log archive (4.68 KB). These are unsigned diagnostic artifacts, not an installable iPhone beta.

No signing certificate, provisioning profile, App Store Connect integration or TestFlight upload was used. At this build checkpoint no physical NFC read, native sharing check or Android SDK compilation had been completed. The original local source archive remains the reviewed `-b` snapshot; the cloud result is separate evidence. A screenshot and actual build record are retained under `work/mobile-test-publication/`.

## Local Shortcuts gateway preparation, 5 October 2026

The user supplied one successful external-reader screenshot reporting an NTAG213 UID and confirmed that Safari could open the computer's LAN test page. This is external-reader evidence, not a physical result from this project's native plugin. Actual UID declarations and the screenshot remain under ignored `work/nfc-shortcut-test/`; mounting surface and reader timestamp remain unconfirmed.

The local gateway uses a new disposable D1, temporary pairing and a fixed staff fixture. An explicitly prepared fictional demo asset allows read-only lookup of the declared UID. Configured-link arrivals use source `configured-link-unverified`; manually opening the same link produces the same type of diagnostic receipt. The server cannot attest that Shortcuts scanned a sticker. Business movement and registration endpoints are not exposed through this gateway.

| Check | Actual result |
| --- | --- |
| Current main production build | Passed; isolated launch applied all 17 migrations |
| Gateway unit/HTTP tests | 5 passed, covering UID evidence, exact retry, persistence errors, pairing/origin guards, fixed demo lookup and active-request shutdown |
| Scoped ESLint and frontend syntax | Passed |
| Browser pairing and saved binding | Passed at the LAN origin |
| Actual isolated backend lookup | Matched the deliberately prepared fictional demo asset, with recorded status In store |
| Manual browser link visit | One confirmed unverified receipt; this is browser QA, not a phone NFC trial |
| Browser layout at requested 390 × 844 viewport | No horizontal overflow; content width matched client width |
| Controlled browser-storage recovery | Passed explicit retry, new-tab preservation, instance separation and matching-only cleanup; physical Safari persistence remains unverified |
| Current shortcut-page JSON download | Not confirmed: browser automation timed out waiting for a download event; server export semantics passed the HTTP test, physical Safari download remains unverified |

The current run's evidence is retained under `work/qa/api-l6qf7h/shortcut-evidence/`, and the browser screenshot under `work/nfc-shortcut-test/phone-page.png`. No hosted inventory, formal release or source publication was changed by this gateway preparation. Actual phone pairing, NFC automation execution, repeated trials and report download are the next device checkpoints.

Later on 5 October, the user reported automatic webpage launch during the NFC Shortcut trial. The gateway first received a generic connection visit, then a new Test tag 01 binding visit. The user confirmed that the phone's explicit demo lookup showed the intended fictional battery and In store status. This completes the first operator-reported Shortcuts-to-web-to-demo-lookup trial. The original receipt remains an unverified configured-link visit; the server cannot distinguish a physical Shortcut trigger from manual navigation. Separate evidence is retained in `work/nfc-shortcut-test/first-shortcut-launch.json` and `first-bound-demo-lookup.json`. Repeated trials, physical Safari report export and native-plugin reading remain pending; no stock movement was enabled or performed.

The user then reported ten successful deliberate repeat scans and confirmed that the JSON report was saved and could be reopened. The gateway independently retained ten distinct new binding receipts after the first phone trial, all with the declared identifier. Its total of thirteen historical visits also includes the earlier desktop QA, generic connection and first phone binding; those three are excluded from the repeat-trial count. The inspected server records confirm link receipt and identifier consistency, while physical NFC triggering remains operator-reported. The downloaded file contents were not supplied for independent inspection. Evidence and a complete server-state snapshot are retained in `work/nfc-shortcut-test/shortcut-repeat-trials-01.json` and `shortcut-evidence-snapshot-01.json`.

This closes the first-sticker Shortcuts/web functional trial and operator-confirmed Safari export checkpoint. It does not establish a general success rate, physical sticker authenticity, Android compatibility, final battery mounting, tracking or native-plugin acceptance. Surface and case conditions remain unconfirmed. A distinct second sticker and an unconfigured-sticker control are proposed next; reviewed, explicitly confirmed demo checkout/return still require implementation and separate validation.

The subsequent unconfigured-sticker/original-sticker control also matched the proposed behavior according to the user: the unconfigured sticker did not open Test tag 01, and the original sticker did. The server added exactly one new binding receipt for the original configured identifier, consistent with that account. This cannot independently prove the negative physical scan; both control outcomes retain user-report attribution. The two controls remain separate from the ten repeat trials. Evidence is retained in `work/nfc-shortcut-test/shortcut-control-comparison-01.json`, with the complete fourteen-visit state in `shortcut-evidence-snapshot-02.json`. The first-sticker Shortcuts/web feasibility checkpoint is complete; native acceptance and guarded business workflows remain separate pending work.

## Pending checks

- Compile Android against its real SDK. The first unsigned Swift build has passed; recompile subsequent native changes before producing an installable package.
- Confirm the Apple team's NFC capability, matching provisioning profile and signature.
- Run the [physical NFC protocol](mobile-nfc-test-protocol.md), retain actual attempt reports and compare raw identifiers across readers/platforms.
- Verify persistence, cancellation, interrupted-session recovery and native JSON sharing on the physical phone.
- Validate the final mounting surface, selected hardware output and any reader-to-room mapping before enabling working-inventory hardware ingestion.
- Implement and review native authentication plus the existing guarded, explicitly confirmed registration/checkout/return workflows before treating this as a complete staff application.

There are currently no measured read-success rates, native-plugin physical UID samples, location observations or timing results. The single external-reader sample above does not replace these missing results with native acceptance or measured reliability.
