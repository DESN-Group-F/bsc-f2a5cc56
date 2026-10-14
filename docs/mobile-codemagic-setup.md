# Codemagic setup from Windows

## Current iOS preparation — 14 October 2026

The user reported approval of Apple Developer Program membership and chose to continue with Codemagic from Windows. The later account setup below independently confirms the membership, App ID and cloud allowance. Signing and installation remain unverified.

Continue the existing React/Capacitor mobile application and shared service. The current local mobile candidate is **0.5.2 / 0.5.2-phone.20261013**. The successful 4 October cloud compilation covered only the earlier **0.1.0** diagnostic snapshot; it is not compilation evidence for the current business application or its Swift service adapter. The Android package's acceptance and device results do not qualify iOS.

Local preparation has rebuilt the phone frontend and synchronized the iOS project to marketing version **0.5.2**. The local build number remains **1**; the signed workflow assigns its own build number, which must exceed any existing upload for this version. NFC, Service, Browser, Filesystem and Share are linked through SPM. The NFC entitlement and privacy resources pass the existing source checks. iOS bridge payload logging is now disabled, matching Android, and the NFC permission text describes identification and reviewed inventory workflows. None of these checks constitutes Swift compilation or device acceptance.

### First installable iPhone checkpoint

1. Confirm the active Apple team and ownership/availability of the provisional `com.batteryinventory.mobile` identifier. Register an explicit App ID with **NFC Tag Reading** and a matching App Store Connect app record. If the identifier cannot be used, change Capacitor, the Xcode target and the signing workflow together before building. See [Apple's App ID guide](https://developer.apple.com/help/account/identifiers/register-an-app-id/).
2. Configure the protected Codemagic App Store Connect integration named **battery-inventory**, an Apple Distribution certificate with its private key, and a matching App Store provisioning profile containing NFC Tag Reading. An API key alone does not supply the certificate/profile. Keep private keys, passwords and authentication codes out of source and chat. See [Codemagic signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/).
3. Review a fresh source-only mobile snapshot, with the current generated frontend and native sources. The existing public test branch is historical; do not assume it contains this local preparation. Record the exact source manifest and commit for the next build. Publishing that snapshot and running cloud work remain separate from local preparation.
4. Run the manual **mobile-ios-verify** workflow against that exact reviewed source when cloud execution is authorized. Check current availability of its pinned Xcode image. This produces unsigned native compilation evidence. The cloud command does not currently configure the optional Playwright runtime, so report browser-test skips separately from native compilation.
5. After signing inputs and test-distribution authorization are in place, enable the snapshot's inactive **templates/testflight-workflow.yaml** and run **mobile-ios-testflight**. The current template uploads to App Store Connect but has **submit_to_testflight: false** and **submit_to_app_store: false**. Codemagic defines the former flag as automatic TestFlight beta-review submission, not the upload itself. For the owner's first test, assign the processed build to an internal group in App Store Connect. See [Codemagic publishing](https://docs.codemagic.io/yaml-publishing/app-store-connect/) and [Apple internal testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).
6. Install through TestFlight and first validate service-independent NFC reads, cancel, timeout, background return, repeated sessions and raw identifier consistency. Then qualify sign-in, secure session restart, original-request recovery, exports and reviewed business workflows in an explicitly authorized test inventory. The existing physical protocol remains the starting point; retain actual iOS reports.

### iOS-specific work still requiring evidence

- The shared scanner currently closes each successful Core NFC session and requests another read after a short delay. Apple's system NFC sheet, cancellation/restart timing and the resulting continuous-scan experience require physical iPhone validation before deciding whether to adapt that interaction.
- Native launch-to-first-content handoff and application-triggered haptics currently have Android implementations. iOS startup, keyboard, safe-area, landscape, background return and sharing need platform-specific work and acceptance. Existing neutral iOS artwork is present.
- Current Swift service, Keychain persistence, durable recovery after termination and physical business NFC have not been compiled or tested on an iPhone at this checkpoint. Working-inventory native NFC remains disabled.
- The privacy resource check is limited to required API declarations. Final App Store Connect privacy answers, entitlement/profile contents and signing must be reviewed against the actual app and account.

No source publication, cloud build, signing operation, TestFlight upload or hosted business-data write was performed by this local preparation.

### Actual local validation — 14 October 2026

| Check | Result and scope |
| --- | --- |
| Mobile suite with the existing Playwright runtime and Edge, serial test files | 740 passed, 0 failed, 1 skipped; the remaining test requires the built CSS path |
| Previously skipped built-CSS check with `MOBILE_PRESENTATION_CSS` set to the freshly built asset | 1 passed, 0 failed, 0 skipped; this was a separate targeted run, not another whole-suite run |
| Native plugin controlled/source checks | 9 passed, 0 failed, 0 skipped; not Swift compilation or radio evidence |
| Source snapshot exporter checks | 11 passed, 0 failed, 0 skipped |
| Web production build | Passed; existing large-chunk and ineffective-dynamic-import warnings remain |
| iOS sync and native declaration checks | Passed; five plugin bindings, current marketing version, NFC entitlement, privacy resources and disabled iOS payload logging verified |
| Current Swift build, signing, installation and physical reads | Not performed; require the cloud Mac/signing setup and physical iPhone |

The initial default test invocation had 686 passes, one FIFO test failure and 43 browser-test skips. A subsequent incomplete browser configuration lacked the bundled Chromium executable; the final run used the existing Edge installation. Keep these attempts in the evidence record rather than replacing them with the later result.

The FIFO failure occurred at a helper that waits only 100 `setImmediate` iterations for real asynchronous compression. The test passed in 21 isolated runs and its complete file passed 11/11. A controlled worker-load probe exhausted those iterations in about 0.97 ms, then completed compression and all FIFO/acknowledgement checks about 23.15 ms after starting. This supports a fragile test checkpoint; it does not establish the exact cause of the original suite failure. The helper remains unchanged and can still be timing-sensitive. This compressed path is Android-specific; iOS retains the plain storage API.

Local logs and diagnostic evidence are retained under ignored `work/ios-preparation-20261014-*`. Browser/controlled checks do not establish WKWebView behavior or native device reliability.

### Subsequent account setup and standalone-source audit

The user authorized continuing preparation and testing before later design discussions. The Apple Developer account now shows an active individual membership, renewing on 14 October 2027. The explicit **Battery Inventory / com.batteryinventory.mobile** App ID was registered with **NFC Tag Reading**. App Store Connect Terms of Service were accepted after the user's explicit confirmation; a page reload confirmed access to its API permission screen. API access and the protected Codemagic integration remain pending at this recording point.

The existing Codemagic Personal account is signed in and its Billing page shows **2 / 500** free macOS minutes used, with subscription activation still available. This is a dated account observation, not a future allowance guarantee. No paid subscription was enabled. Account credentials and signing secrets are outside project sources and source snapshots.

Independent standalone validation found that **ios-preparation-052-20261014** is incomplete despite all 470 recorded file hashes matching: its exporter omitted seven canonical TSX test inputs, four root CSV fixtures and four mobile CSV import templates. Two test files reproduced five missing-file failures; the mobile templates are also application resources. Retain that archive as historical evidence, and do not publish or build it as the current candidate.

The exporter now includes precisely those 15 required inputs and keeps backend, business data and `app/inventory-app.tsx` excluded. Its 30 regression checks passed with zero failures/skips, including real standalone helper execution, missing-input rejection and manifest integrity. A new snapshot must pass its own clean installation, tests, build and iOS sync before publication. This repair does not change the app's business behavior or design.

## Historical onboarding and first compile — 4 October 2026

The original guide prepared the standalone NFC diagnostic prototype for a reported iPhone 13 and NTAG213 stickers. The computer ran Windows, and Apple Developer Program identity review was pending at that time. Account login, repository connection, cloud compilation and test distribution were separate checkpoints.

Account and pricing information was checked against the official documentation on 4 October 2026. GitHub authentication and Personal onboarding completed. The user chose to publish the reviewed mobile source into the existing project's `codex/nfc-functional-test` branch instead of creating a private repository. This repository is public. It was connected through **Add URL manually → Public repository**, without an additional GitHub repository permission step. The first unsigned iOS cloud build has passed; signing, installation and TestFlight submission remain pending.

## Checkpoint 1 — Sign in and select Personal onboarding

1. Open [Codemagic signup](https://codemagic.io/signup).
2. Choose GitHub if that is where the test repository will be held, or use email. GitHub signup authenticates your identity; repository access is configured separately. Email signup sends an authentication code to your inbox. Enter it directly on Codemagic.
3. Complete any password, authentication-code and legal-agreement steps directly and choose **Individual** under Personal Account.
4. Select GitHub as the code provider. If onboarding opens the source-connection form before the dashboard, stop before **Next: Authorize Codemagic** until the dedicated test source and repository permissions are reviewed. No Apple API key or signing certificate is needed for this checkpoint.

These signup methods and the separation between GitHub authentication and repository integration are documented in [Codemagic Signup](https://docs.codemagic.io/getting-started/signup/). Keep authentication codes, passwords and private keys out of project files and chat.

At the 4 October checkpoint, the documented individual plan included **500 free build minutes per month on macOS M2**, resetting on the first day of the month; a Codemagic Team did not receive those personal free minutes. The selected workflows use `mac_mini_m2`. Recheck current pricing and the actual account allowance before a run; the historical observation does not establish today's balance. See [Codemagic pricing](https://docs.codemagic.io/billing/pricing/).

**Done means:** the account is signed in and Personal onboarding is selected. A source-connection form is an acceptable checkpoint; it does not mean source code has been uploaded or an iPhone app is ready.

## Checkpoint 2 — Connect the separate source snapshot

The reviewed mobile source is on [the existing project's functional-test branch](https://github.com/DESN-Group-F/bsc-f2a5cc56/tree/codex/nfc-functional-test). That branch contains the mobile prototype only, with a fresh neutral source commit:

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

A local ZIP is a transfer/archive artifact, not a Codemagic source connection. Codemagic builds from a Git repository it can access. For this public source, use **Add URL manually**, clone URL `https://github.com/DESN-Group-F/bsc-f2a5cc56.git`, and **Public repository**. Select **Ionic** manually for the Capacitor application, then choose branch **codex/nfc-functional-test** in application settings. Its root `codemagic.yaml` contains the two active workflows. The default `main` branch does not contain this test configuration. See [Adding apps to Codemagic](https://docs.codemagic.io/getting-started/adding-apps/).

Future private-source integration requires separately reviewed repository access. GitHub app access is configured at repository scope, not limited to one branch. The public URL route used here grants no additional GitHub repository permission.

**Done means:** the existing repository, exact test branch and its YAML workflows are visible in the Personal account. Builds are started manually.

## Checkpoint 3 — Run the unsigned compile check

Once the cloud run is authorized, choose **`mobile-ios-verify`**, select the reviewed branch/commit and start it manually. The current YAML installs the independent mobile package, runs its tests, builds the interface, prepares the iOS project and calls Xcode with `CODE_SIGNING_ALLOWED=NO`.

This job can run while Apple membership is pending. It needs neither a distribution certificate nor App Store Connect credentials. It is a native compilation check, not a physical NFC test. Its unsigned `.app` artifact cannot be installed on the iPhone. Real-device installation requires signing; see [Codemagic iOS signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/).

**Actual result:** the first run passed on 4 October 2026 for commit `1b753fc`, on Mac mini M2, in 1 minute 13 seconds. Its log ended with `BUILD SUCCEEDED`; see [the actual validation record](mobile-nfc-validation.md). This compile check does not establish a physical NFC read.

## Checkpoint 4 — Sign after Apple membership becomes active

A Codemagic **Personal account** and an Apple **Personal Team** are different things. The former is a cloud build account type. Apple's free Personal Team does not provide this app's NFC Tag Reading capability; the Apple Developer Program membership and a suitable profile are still required. See [Apple's supported iOS capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios/).

After membership activation:

1. Confirm ownership of the provisional bundle ID `com.batteryinventory.mobile`. Enable **NFC Tag Reading** on the explicit Apple App ID and create the matching App Store Connect app record.
2. Configure an App Store Connect integration named `battery-inventory`, matching the YAML. Enter the API key directly into Codemagic's protected integration settings.
3. Add or generate the distribution certificate and obtain a matching App Store provisioning profile that includes NFC Tag Reading. Configure these in **Code signing identities**; the API integration alone is not a valid signing profile. Confirm the account owning the app and its billing before moving anything into a Codemagic Team. See [Codemagic iOS signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/).
4. In a reviewed later source update, merge `templates/testflight-workflow.yaml` into the root workflow mapping after its integration and signing inputs are configured. After explicit beta-distribution approval, manually run **`mobile-ios-testflight`**. Use the 14 October internal-testing configuration above: upload to App Store Connect without automatic external beta review or public App Store submission. See [Codemagic App Store Connect publishing](https://docs.codemagic.io/yaml-publishing/app-store-connect/).
5. For the first owner test, use App Store Connect's **TestFlight → Internal Testing**: create a test group, add the account holder as an eligible internal tester, and manually add the processed build. Complete any requested test/export-compliance information. The YAML does not configure `beta_groups`; an upload alone does not guarantee an invitation. External testers require a separate external group and any required beta review. See [Apple's internal tester guide](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).
6. Accept the available tester invitation and install through TestFlight. Then run the [physical NFC protocol](mobile-nfc-test-protocol.md).

Membership activation, successful compilation, completed signing, TestFlight availability and a real tag read are separate results. None guarantees same-day completion of the next step.

## Status to report

| Checkpoint | Evidence to keep | Current evidence in this guide |
| --- | --- | --- |
| Personal account | Signed-in page and Personal onboarding | Confirmed on 4 October 2026; 0/500 free minutes used before the first run, subscription not enabled |
| Source connection | Exact test branch and reviewed commit | Public project branch connected, commit `1b753fc` |
| Unsigned native build | Successful `mobile-ios-verify` log | First run passed, Xcode `BUILD SUCCEEDED`, 1 minute 13 seconds |
| Apple signing | Active membership, App ID and matching profile | Membership approved according to the user on 14 October; team, App ID, certificate and profile not independently verified |
| TestFlight installation | Processed build installed on the iPhone | Not yet completed |
| Physical NFC test | Exported app diagnostic report from real stickers | Not yet completed |

Keep actual test results in [Mobile NFC validation](mobile-nfc-validation.md). This guide does not convert planned steps into completed evidence.
