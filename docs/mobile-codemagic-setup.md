# Codemagic setup from Windows

## Current iOS preparation — 14 October 2026

The user chose to continue iOS development with Codemagic from Windows. Active Apple Developer Program membership, the NFC App ID, the App Store Connect app record and the protected Codemagic API integration are confirmed. A distribution certificate, its matching private key and the NFC App Store provisioning profile are configured. The signed **0.5.2 (5)** build reached the owner's TestFlight group. The user subsequently opened the installed app, but its local recovery-file initialization failed before sign-in. Repair this blocker and complete service-independent NFC testing before software design, as the user requested.

Continue the existing React/Capacitor mobile application and shared service. The current local mobile candidate is **0.5.2 / 0.5.2-phone.20261013**. The repaired signed cloud build passed its configured checks; the earlier unsigned run's seven missing-dependency failures remain historical evidence below. Compilation and JavaScript checks did not qualify the native first-install storage path. The Android package's acceptance and device results do not qualify iOS.

Local preparation has rebuilt the phone frontend and synchronized the iOS project to marketing version **0.5.2**. The local build number remains **1**; the signed workflow assigns its own build number, which must exceed any existing upload for this version. NFC, Service, Browser, Filesystem and Share are linked through SPM. The NFC entitlement and privacy resources pass the existing source checks. iOS bridge payload logging is now disabled, matching Android, and the NFC permission text describes identification and reviewed inventory workflows. None of these checks constitutes Swift compilation or device acceptance.

### First installable iPhone checkpoint

1. Preserve the confirmed Apple team, explicit `com.batteryinventory.mobile` App ID with **NFC Tag Reading**, and matching App Store Connect app record. Any later identifier change must update Capacitor, the Xcode target and the signing workflow together. See [Apple's App ID guide](https://developer.apple.com/help/account/identifiers/register-an-app-id/).
2. Preserve the configured App Store signing inputs: integration **battery-inventory**, certificate **battery-inventory-distribution** and profile **battery-inventory-app-store-nfc**. The downloaded profile's CMS signature, application identifier, NFC `TAG` entitlement and certificate fingerprint were checked against the local certificate. Keep private keys, passwords and authentication codes out of project sources. See [Codemagic signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/).
3. Retain the reviewed **ios-test-052-20261014-b** snapshot and its exact published commit recorded below. Its checks passed in a standalone source directory beneath the development workspace before the user explicitly authorized publication and cloud compilation. Cloud execution exposed a missing direct test dependency that the parent workspace could supply locally; a repaired snapshot needs validation outside that workspace. The older **codex/nfc-functional-test** branch remains historical.
4. The dependency, JSX harness and fail-fast repairs have passed a fully isolated 742-test local run. The subsequent signed cloud workflow completed all required steps: 688 mobile checks passed, 43 optional browser/CSS checks skipped, and all 9 plugin checks passed. Those optional checks passed in the local isolated run. Preserve the initial failed unsigned run separately as historical evidence.
5. After signing inputs and test-distribution authorization are in place, enable the snapshot's inactive **templates/testflight-workflow.yaml** and run **mobile-ios-testflight**. The current template uploads to App Store Connect but has **submit_to_testflight: false** and **submit_to_app_store: false**. Codemagic defines the former flag as automatic TestFlight beta-review submission, not the upload itself. For the owner's first test, assign the processed build to an internal group in App Store Connect. See [Codemagic publishing](https://docs.codemagic.io/yaml-publishing/app-store-connect/) and [Apple internal testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).
6. Install through TestFlight and first validate service-independent NFC reads, cancel, timeout, background return, repeated sessions and raw identifier consistency. Then qualify sign-in, secure session restart, original-request recovery, exports and reviewed business workflows in an explicitly authorized test inventory. The existing physical protocol remains the starting point; retain actual iOS reports.

### iOS-specific work still requiring evidence

- The shared scanner currently closes each successful Core NFC session and requests another read after a short delay. Apple's system NFC sheet, cancellation/restart timing and the resulting continuous-scan experience require physical iPhone validation before deciding whether to adapt that interaction.
- Native launch-to-first-content handoff and application-triggered haptics currently have Android implementations. iOS startup, keyboard, safe-area, landscape, background return and sharing need platform-specific work and acceptance. Existing neutral iOS artwork is present.
- The current Swift source now compiles in the unsigned cloud build. Keychain persistence, durable recovery after termination and physical business NFC remain untested on an iPhone. Working-inventory native NFC remains disabled.
- The privacy resource check is limited to required API declarations. Final App Store Connect privacy answers, entitlement/profile contents and signing must be reviewed against the actual app and account.

The user explicitly authorized publication of the reviewed test branch and cloud compilation. Source publication, signed TestFlight upload and owner internal-group assignment completed without changing the main branch or deployed web/server release. Installation/opening is now user-reported, but successful startup and physical NFC are not accepted. No hosted business-data write was performed by this preparation.

### Actual validation — 14 October 2026

| Check | Result and scope |
| --- | --- |
| Fresh snapshot dependency installation | Clean `npm ci` passed in **ios-test-052-20261014-b**, under the development workspace; not proof that every test dependency is declared |
| Entire snapshot mobile suite with the existing Playwright runtime, Edge and `MOBILE_PRESENTATION_CSS` set to its built CSS asset, serial test files | 741 passed, 0 failed, 0 skipped; the directory could resolve ancestor dependencies, so this was not a fully isolated dependency check |
| Native plugin controlled/source checks | 9 passed, 0 failed, 0 skipped; not Swift compilation or radio evidence |
| Repaired source snapshot exporter checks | 30 passed, 0 failed, 0 skipped |
| Web production build | Passed; existing large-chunk and ineffective-dynamic-import warnings remain |
| iOS sync and native declaration checks | Passed; five plugin bindings, current marketing version, NFC entitlement, privacy resources and disabled iOS payload logging verified |
| Cloud mobile suite | 695 tests: 687 passed, 7 failed, 1 skipped. All seven failures report missing `esbuild`; the shell continued to subsequent commands |
| Cloud plugin checks | 9 passed, 0 failed, 0 skipped |
| Current Swift build | Unsigned native step passed in 40 seconds, with `** BUILD SUCCEEDED **`; Xcode 26.6, iPhoneOS 26.5 SDK, arm64, deployment target iOS 15. This does not qualify the failed mobile suite |
| Signed build and TestFlight | 0.5.2 (5) archived, exported, uploaded and assigned to the owner internal group; physical installation and reads remain unverified |

Before the fresh snapshot validation, the local suite passed 740 tests with one built-CSS skip, followed by a separate successful targeted built-CSS check. The initial default invocation had 686 passes, one FIFO test failure and 43 browser-test skips. A subsequent incomplete browser configuration lacked the bundled Chromium executable; later runs used the existing Edge installation. Keep these attempts in the evidence record rather than replacing them with the later 741-test result or treating it as fully isolated dependency qualification.

The FIFO failure occurred at a helper that waits only 100 `setImmediate` iterations for real asynchronous compression. The test passed in 21 isolated runs and its complete file passed 11/11. A controlled worker-load probe exhausted those iterations in about 0.97 ms, then completed compression and all FIFO/acknowledgement checks about 23.15 ms after starting. This supports a fragile test checkpoint; it does not establish the exact cause of the original suite failure. The helper remains unchanged and can still be timing-sensitive. This compressed path is Android-specific; iOS retains the plain storage API.

Earlier local logs and diagnostic evidence are retained under ignored `work/ios-preparation-20261014-*`. Fresh standalone logs are `work/ios-standalone-052-install.log`, `work/ios-standalone-052-build.log`, `work/ios-standalone-052-mobile-tests.log` and `work/ios-standalone-052-plugin-tests.log`. Browser/controlled checks do not establish WKWebView behavior or native device reliability.

### Subsequent account setup and standalone-source audit

The user authorized continuing preparation and testing before later design discussions. The Apple Developer account independently shows active individual membership for team **XCMXT6RZVJ**, renewing on 14 October 2027. The explicit **Battery Inventory / com.batteryinventory.mobile** App ID was registered with **NFC Tag Reading**. The matching App Store Connect app record is **Battery Inventory**, app ID **6822520039**, with primary language **English (Australia)**.

App Store Connect Terms of Service and the API-use declaration were accepted after the user's explicit confirmations. API access was approved and the dedicated **battery-inventory** key was created with **App Manager** access. The initial one-time download issue was recovered, and Codemagic accepted the protected integration. The **battery-inventory-distribution** distribution certificate was generated, its matching private key validated, and its expiry recorded as **14 October 2027**. The App Store profile **Battery Inventory App Store NFC**, referenced in Codemagic as **battery-inventory-app-store-nfc**, is now configured. Its signed content matches the app identifier and distribution certificate and contains NFC `TAG`; its expiry is also 14 October 2027. The **Owner Internal Testing** group exists with automatic distribution disabled; the account holder is its sole internal tester, build 0.5.2 (5) is assigned, and Apple shows the tester as Invited and the internal build as Testing. Account passwords, the API private key, and the distribution PKCS#12 file/password are secured outside project sources and snapshots.

Before the current cloud run, the signed-in Codemagic Personal account's Billing page showed **2 / 500** free macOS minutes used, with subscription activation still available. This is a dated account observation, not the post-run balance or a future allowance guarantee. No paid subscription was enabled. Account credentials and signing secrets are outside project sources and source snapshots.

Independent standalone validation found that **ios-preparation-052-20261014** is incomplete despite all 470 recorded file hashes matching: its exporter omitted seven canonical TSX test inputs, four root CSV fixtures and four mobile CSV import templates. Two test files reproduced five missing-file failures; the mobile templates are also application resources. Retain that archive as historical evidence, and do not publish or build it as the current candidate.

The exporter now includes precisely those 15 required inputs and keeps backend, business data and `app/inventory-app.tsx` excluded. Its 30 regression checks passed with zero failures/skips, including real standalone helper execution, missing-input rejection and manifest integrity. This repair does not change the app's business behavior or design.

The replacement snapshot **ios-test-052-20261014-b** passed clean installation, production build, full mobile/plugin suites and `--ios` synchronization in its source directory beneath the development workspace. That location could resolve dependencies from the parent project's `node_modules`; these passing checks did not establish a fully isolated dependency installation. The snapshot contains **485 manifest entries / 486 files including the manifest**. The ZIP at `work/mobile-test-snapshots/ios-test-052-20261014-b.zip` has SHA-256 **10d30b6287bff582bbf4df6e98205d320b09f5f2ff7847e7363ed6c5e9f94ef3**. The historical archive was retained unchanged.

After the user's explicit authorization, the reviewed source was published to [codex/ios-functional-test-052](https://github.com/DESN-Group-F/bsc-f2a5cc56/tree/codex/ios-functional-test-052) in the existing public repository, as fresh root commit **f245d558ca743966fb62555409a19ee3f3753180**. Its committed blobs were checked against all 485 manifest entries, with only the manifest itself additional; author and committer use the neutral publishing identity. This publication excludes the backend, business data, credentials, signing files and original local Git history.

The manual [unsigned iOS verification run](https://codemagic.io/app/6ac2188a6a40dee54624182a/build/6acec999546ce6236cee5733) finished its mobile suite with **687 passed, 7 failed and 1 skipped** out of 695 tests. All seven failures reported missing `esbuild`, including its import from `mobile/tests/battery-detail-actions-dom.test.mjs`. The workflow script lacked fail-fast handling and continued after `npm test` failed. The subsequent plugin checks passed **9/9** and the native step completed in **40 seconds** with `** BUILD SUCCEEDED **`, using Xcode 26.6, the iPhoneOS 26.5 SDK, arm64 and an iOS 15 deployment target. This proves unsigned compilation of the current source; overall verification failed because the mobile suite failed. Dependency declarations and fail-fast execution are being repaired, with fresh validation required outside the development workspace. The snapshot's signed TestFlight workflow remains inactive.

### Isolated dependency and test-harness repair

The mobile package now explicitly declares `esbuild` 0.28.0 and its directly imported `tailwindcss` 4.2.1 dependency. Six DOM test harnesses now explicitly select automatic JSX transformation instead of inheriting the development workspace's TypeScript settings. All eight Codemagic script blocks enable `set -euo pipefail`; the source exporter rejects workflows without that guard. No application or native business behavior changed.

The final validation directory was outside the development workspace, with no ancestor `node_modules` and with `NODE_PATH` / `NODE_OPTIONS` cleared. Only the absolute Playwright runtime path, installed Edge channel and this directory's built CSS were supplied explicitly. Clean installation and production build passed, followed by **742 / 742 mobile tests, zero failures or skips**, and **9 / 9 plugin checks**. The final mobile suite took 119.23 seconds. The dependency/exporter regression checks passed **32 / 32**.

Earlier isolated attempts are retained: the Local AppData directory had a Windows junction-resolution failure reproducible with an ordinary junction; the later Documents directory exposed the missing JSX setting before repair. These attempts did not pass and were not published. Final logs are retained under ignored `work/ios-isolated-documents-tests-repaired-20261014.log` and associated installation, build and plugin logs. The final e/f source exports include the repaired test harnesses; earlier preparation archives `ios-test-052-20261014-c` and `ios-testflight-052-20261014-d` are unqualified local intermediates.
### Signed-source checkpoint

The repaired source was freshly exported as **ios-test-052-20261014-e** and the reviewed manual signing workflow was enabled in the publication copy. The resulting **ios-testflight-052-20261014-f.zip** has SHA-256 **3fe52712a6215d0097e060125af30e9eaa1ef17c396962619ad9a449f324e84a**; its source-manifest SHA-256 is **3335754e69e005e8ea4762e6d888c64a8cd98ffc7ec6c0d63028f454e9dfaa91**. All **486 manifest entries / 487 committed files** were checked against Git blobs. All 72 dependency manifest and test files matched the successful isolated validation copy after LF normalization.

Commit **d31bedbdfa12f5913dc43542140a61a2736260ec** is published on **codex/ios-functional-test-052**. The manual [signed iOS build](https://codemagic.io/app/6ac2188a6a40dee54624182a/build/6acecdb3546ce6236cee5805) completed successfully, including Apple upload and processing. Its test commands run before signing, and failed commands now stop the step. App Store Connect upload is enabled for owner internal testing; automatic external beta review and public App Store submission remain disabled.
### Completed automated and distribution checkpoint

The signed workflow for **d31bedb** passed its mobile suite with **688 passed, 0 failed and 43 skipped** out of 731 tests; all skips explicitly require the optional Playwright runtime or built CSS path, covered by the isolated **742 / 742** local run. Plugin checks passed **9 / 9**. NFC signing profiles were applied, the archive and IPA export succeeded, and Apple returned **UPLOAD SUCCEEDED with no errors**. App Store Connect processed **0.5.2 (5)** and lists it as **Testing** in **Owner Internal Testing**. The account holder is the only tester and its status is **Invited**. No external beta review or public App Store submission was requested.

The downloaded IPA was inspected independently: bundle `com.batteryinventory.mobile`, version **0.5.2**, build **5**, minimum iOS **15.0**, frontend assets present, iOS bridge logging **none**, and `ITSAppUsesNonExemptEncryption` **false**. Its embedded provisioning profile's CMS signature, UUID, application identifier and NFC `TAG` entitlement match the configured profile. Signature resources are present; this Windows inspection is not a substitute for a device launch or a native `codesign` runtime check.

The IPA SHA-256 is **985d942300045d3f0a3d2fca128cae8c3d3d7689012af66f4b9d2a61f049b3fe**. The IPA, raw Xcode logs, three dSYM archives, file hashes and inspection report are retained under ignored `work/ios-testflight-052-build5/`. Source, test and cloud provenance are recorded in `work/ios-signed-source-20261014.json`; Apple and Codemagic screenshots and rendered logs are retained under `work/ios-*20261014*` and `work/ios-codemagic-d31bedb-*`.

The subsequent user report confirms the app can open, while the supplied screenshot shows **Saved work needs attention**. Its expanded error is **Business recovery data could not be read. Existing files were preserved; do not replace pending work.** This identifies a native recovery-file read failure before sign-in. The exact installed build was not independently read back. The user prioritizes NFC testing before software design: fix startup, then open **Device diagnostics → NFC field test** without sign-in or service configuration and verify read/cancel/repeat, background return and export. Inventory qualification is deferred. Keep Working native NFC disabled and preserve the deployed R3 data.
## Historical onboarding and first compile — 4 October 2026

The original guide prepared the standalone NFC diagnostic prototype for a reported iPhone 13 and NTAG213 stickers. The computer ran Windows, and Apple Developer Program identity review was pending at that time. Account login, repository connection, cloud compilation and test distribution were separate checkpoints.

Account and pricing information was checked against the official documentation on 4 October 2026. GitHub authentication and Personal onboarding completed. The user chose to publish the reviewed mobile source into the existing project's `codex/nfc-functional-test` branch instead of creating a private repository. This repository is public. It was connected through **Add URL manually → Public repository**, without an additional GitHub repository permission step. The first unsigned iOS cloud build passed at that historical checkpoint; signing, installation and TestFlight submission were still pending. Use the 14 October record above for the current source and account state.

## Checkpoint 1 — Sign in and select Personal onboarding

1. Open [Codemagic signup](https://codemagic.io/signup).
2. Choose GitHub if that is where the test repository will be held, or use email. GitHub signup authenticates your identity; repository access is configured separately. Email signup sends an authentication code to your inbox. Enter it directly on Codemagic.
3. Complete any password, authentication-code and legal-agreement steps directly and choose **Individual** under Personal Account.
4. Select GitHub as the code provider. If onboarding opens the source-connection form before the dashboard, stop before **Next: Authorize Codemagic** until the dedicated test source and repository permissions are reviewed. No Apple API key or signing certificate is needed for this checkpoint.

These signup methods and the separation between GitHub authentication and repository integration are documented in [Codemagic Signup](https://docs.codemagic.io/getting-started/signup/). Keep authentication codes, passwords and private keys out of project files and chat.

At the 4 October checkpoint, the documented individual plan included **500 free build minutes per month on macOS M2**, resetting on the first day of the month; a Codemagic Team did not receive those personal free minutes. The selected workflows use `mac_mini_m2`. Recheck current pricing and the actual account allowance before a run; the historical observation does not establish today's balance. See [Codemagic pricing](https://docs.codemagic.io/billing/pricing/).

**Done means:** the account is signed in and Personal onboarding is selected. A source-connection form is an acceptable checkpoint; it does not mean source code has been uploaded or an iPhone app is ready.

## Checkpoint 2 — Connect the separate source snapshot

The original diagnostic source remains on [the historical functional-test branch](https://github.com/DESN-Group-F/bsc-f2a5cc56/tree/codex/nfc-functional-test). The current 0.5.2 source is on [codex/ios-functional-test-052](https://github.com/DESN-Group-F/bsc-f2a5cc56/tree/codex/ios-functional-test-052), with its exact commit and validation limits recorded above. The original snapshot had this basic layout; the current manifest additionally enumerates shared client inputs, controlled tests and CSV templates:

```text
codemagic.yaml
mobile/
scripts/prepare-mobile-native.mjs
docs/ (the selected mobile instructions and validation record)
```

The local snapshot preparation supplies the exact file list. It must exclude the main backend and business data, original Git history, dependencies/build outputs, credentials, signing files and local tool state. Preserve required third-party notices. Preserve the prepared native source projects, including the iOS privacy manifest and its Resources binding; these are source configuration, not disposable build outputs. Review the prepared snapshot before any publication.

The initial snapshot's root YAML includes only unsigned iOS verification and Android debug workflows. The signed TestFlight workflow is retained as a separate template for later review. Its App Store Connect integration is not assumed configured in a new account.

From the development workspace root, prepare a new local snapshot with:

```powershell
node scripts/export-mobile-test-source.mjs
```

The command produces a new source directory, ZIP and artifact-hash manifest under ignored `work/mobile-test-snapshots/`. The source directory includes `source-manifest.json`, with each file's SHA-256 hash and byte size. Existing snapshots are never overwritten. Inspect the file list and preserve required third-party notices before approving publication; filename exclusion and secret-pattern checks are safeguards, not proof that every possible embedded secret has been detected.

A local ZIP is a transfer/archive artifact, not a Codemagic source connection. Codemagic builds from a Git repository it can access. For this public source, use **Add URL manually**, clone URL `https://github.com/DESN-Group-F/bsc-f2a5cc56.git`, and **Public repository**. Select **Ionic** manually for the Capacitor application, then choose the exact reviewed test branch in application settings: **codex/ios-functional-test-052** for the current 0.5.2 candidate. Its root `codemagic.yaml` contains the two active workflows. The default `main` branch does not contain this test configuration. See [Adding apps to Codemagic](https://docs.codemagic.io/getting-started/adding-apps/).

Future private-source integration requires separately reviewed repository access. GitHub app access is configured at repository scope, not limited to one branch. The public URL route used here grants no additional GitHub repository permission.

**Done means:** the existing repository, exact test branch and its YAML workflows are visible in the Personal account. Builds are started manually.

## Checkpoint 3 — Run the unsigned compile check

Once the cloud run is authorized, choose **`mobile-ios-verify`**, select the reviewed branch/commit and start it manually. The current YAML installs the independent mobile package, runs its tests, builds the interface, prepares the iOS project and calls Xcode with `CODE_SIGNING_ALLOWED=NO`.

This job can run while Apple membership is pending. It needs neither a distribution certificate nor App Store Connect credentials. It is a native compilation check, not a physical NFC test. Its unsigned `.app` artifact cannot be installed on the iPhone. Real-device installation requires signing; see [Codemagic iOS signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/).

**Historical result:** the first run passed on 4 October 2026 for commit `1b753fc`, on Mac mini M2, in 1 minute 13 seconds. Its log ended with `BUILD SUCCEEDED`; see [the actual validation record](mobile-nfc-validation.md). The 14 October run above compiled the current source but failed its mobile suite. Neither compile check establishes a physical NFC read.

## Checkpoint 4 — Sign after Apple membership becomes active

A Codemagic **Personal account** and an Apple **Personal Team** are different things. The former is a cloud build account type. Apple's free Personal Team does not provide this app's NFC Tag Reading capability; the Apple Developer Program membership and a suitable profile are still required. See [Apple's supported iOS capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios/).

After membership activation:

1. Confirm ownership of bundle ID `com.batteryinventory.mobile`, **NFC Tag Reading** on the explicit Apple App ID, and the matching App Store Connect app record. These account checks were completed on 14 October 2026.
2. Configure an App Store Connect integration named `battery-inventory`, matching the YAML. Enter the API key directly into Codemagic's protected integration settings.
3. Add or generate the distribution certificate and obtain a matching App Store provisioning profile that includes NFC Tag Reading. Configure these in **Code signing identities**; the API integration alone is not a valid signing profile. Confirm the account owning the app and its billing before moving anything into a Codemagic Team. See [Codemagic iOS signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/).
4. In a reviewed later source update, merge `templates/testflight-workflow.yaml` into the root workflow mapping after its integration and signing inputs are configured. After explicit beta-distribution approval, manually run **`mobile-ios-testflight`**. Use the 14 October internal-testing configuration above: upload to App Store Connect without automatic external beta review or public App Store submission. See [Codemagic App Store Connect publishing](https://docs.codemagic.io/yaml-publishing/app-store-connect/).
5. For the first owner test, use App Store Connect's **TestFlight → Internal Testing**: create a test group, add the account holder as an eligible internal tester, and manually add the processed build. Complete any requested test/export-compliance information. The YAML does not configure `beta_groups`; an upload alone does not guarantee an invitation. External testers require a separate external group and any required beta review. See [Apple's internal tester guide](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).
6. Accept the available tester invitation and install through TestFlight. Then run the [physical NFC protocol](mobile-nfc-test-protocol.md).

Membership activation, successful compilation, completed signing, TestFlight availability and a real tag read are separate results. None guarantees same-day completion of the next step.

## Status to report

| Checkpoint | Evidence to keep | Current evidence in this guide |
| --- | --- | --- |
| Personal account | Signed-in page and Personal onboarding | Confirmed on 14 October 2026; 2/500 free macOS minutes used before the current run; no paid subscription enabled |
| Source connection | Exact test branch, reviewed commit and manifest | Published `codex/ios-functional-test-052`, commit `d31bedbdfa12f5913dc43542140a61a2736260ec`; 486 manifest entries plus the manifest verified against committed blobs |
| Current local checks | Exact source, runtime and logs | 742 mobile tests and 9 plugin checks passed in an external isolated directory, zero failures/skips; 32 dependency/exporter regression checks passed |
| Cloud verification | Test output and native compiler outcome recorded separately | Signed d31bedb run: 688 passed, 0 failed, 43 optional browser/CSS skips; plugin checks 9/9. Fail-fast guards active; archive/export and Apple upload succeeded. Earlier failed run retained separately |
| Current unsigned native build | Exact source and successful Xcode log | Commit `f245d558ca743966fb62555409a19ee3f3753180`, native step 40 seconds, Xcode 26.6 / iPhoneOS 26.5 SDK / arm64 / iOS 15 target, `** BUILD SUCCEEDED **`; overall cloud qualification still failed |
| Historical unsigned native build | Successful log and historical source identity | 0.1.0 diagnostic commit `1b753fc`: 4 October, Xcode `BUILD SUCCEEDED`, 1 minute 13 seconds; retained separately from the current client |
| Apple account and API integration | Active membership, NFC App ID, app record and protected integration | Independently confirmed on 14 October; App Manager API integration accepted by Codemagic |
| Apple signing | Certificate/private-key match and matching NFC profile | Certificate/private key and profile validated and stored in Codemagic; both expire 14 October 2027. Signed IPA 0.5.2 (5) produced |
| TestFlight installation | Processed build installed on the iPhone | User reports opening the installed app; screenshot shows failed local storage initialization before sign-in. Exact installed build not independently read back; successful startup not accepted |
| Physical NFC test | Exported app diagnostic report from real stickers | Not yet completed |

Keep actual test results in [Mobile NFC validation](mobile-nfc-validation.md). This guide does not convert planned steps into completed evidence.
