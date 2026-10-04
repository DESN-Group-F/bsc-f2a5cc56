# Codemagic setup from Windows

This guide prepares the standalone NFC diagnostic prototype for an iPhone 13 and NTAG213 stickers. The computer runs Windows. Apple Developer Program identity review is still pending. Account login, repository connection, cloud compilation and test distribution are separate checkpoints.

Account and pricing information was checked against the official documentation on 4 October 2026. GitHub authentication was visibly complete, Personal onboarding was selected and GitHub was selected as the source provider. The page is waiting at **Next: Authorize Codemagic**. No repository permission, source upload, cloud build or TestFlight submission has been completed.

## Checkpoint 1 — Sign in and select Personal onboarding

1. Open [Codemagic signup](https://codemagic.io/signup).
2. Choose GitHub if that is where the test repository will be held, or use email. GitHub signup authenticates your identity; repository access is configured separately. Email signup sends an authentication code to your inbox. Enter it directly on Codemagic.
3. Complete any password, authentication-code and legal-agreement steps directly and choose **Individual** under Personal Account.
4. Select GitHub as the code provider. If onboarding opens the source-connection form before the dashboard, stop before **Next: Authorize Codemagic** until the dedicated test source and repository permissions are reviewed. No Apple API key or signing certificate is needed for this checkpoint.

These signup methods and the separation between GitHub authentication and repository integration are documented in [Codemagic Signup](https://docs.codemagic.io/getting-started/signup/). Keep authentication codes, passwords and private keys out of project files and chat.

The current individual plan includes **500 free build minutes per month on macOS M2**, resetting on the first day of the month. A Codemagic Team does not receive those personal free minutes. The selected workflows use `mac_mini_m2`; check the actual account allowance before a run. Registering a Personal account does not require enabling paid build usage for this plan. See [Codemagic pricing](https://docs.codemagic.io/billing/pricing/).

**Done means:** the account is signed in and Personal onboarding is selected. A source-connection form is an acceptable checkpoint; it does not mean source code has been uploaded or an iPhone app is ready.

## Checkpoint 2 — Connect the separate source snapshot

The intended source is a new, reviewed Git repository containing the mobile prototype only:

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

A local ZIP is a transfer/archive artifact, not a Codemagic source connection. Codemagic builds from a Git repository it can access. After source publication is authorized, use **Add application**, connect the Git provider and select the dedicated snapshot repository. For GitHub, grant the Codemagic app access to that repository only. Keep `codemagic.yaml` at the Git repository root and use YAML configuration; this project is not a Flutter workflow. See [Adding apps to Codemagic](https://docs.codemagic.io/getting-started/adding-apps/).

**Done means:** the dedicated repository and its YAML workflows are visible in the Personal account. No build needs to start automatically.

## Checkpoint 3 — Run the unsigned compile check

Once the cloud run is authorized, choose **`mobile-ios-verify`**, select the reviewed branch/commit and start it manually. The current YAML installs the independent mobile package, runs its tests, builds the interface, prepares the iOS project and calls Xcode with `CODE_SIGNING_ALLOWED=NO`.

This job can run while Apple membership is pending. It needs neither a distribution certificate nor App Store Connect credentials. It is a native compilation check, not a physical NFC test. Its unsigned `.app` artifact cannot be installed on the iPhone. Real-device installation requires signing; see [Codemagic iOS signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/).

**Done means:** the Xcode build passed and its logs identify the tested commit. Record any failure as a compile result and fix it before preparing a signed package.

## Checkpoint 4 — Sign after Apple membership becomes active

A Codemagic **Personal account** and an Apple **Personal Team** are different things. The former is a cloud build account type. Apple's free Personal Team does not provide this app's NFC Tag Reading capability; the Apple Developer Program membership and a suitable profile are still required. See [Apple's supported iOS capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios/).

After membership activation:

1. Confirm ownership of the provisional bundle ID `com.batteryinventory.mobile`. Enable **NFC Tag Reading** on the explicit Apple App ID and create the matching App Store Connect app record.
2. Configure an App Store Connect integration named `battery-inventory`, matching the YAML. Enter the API key directly into Codemagic's protected integration settings.
3. Add or generate the distribution certificate and obtain a matching App Store provisioning profile that includes NFC Tag Reading. Configure these in **Code signing identities**; the API integration alone is not a valid signing profile. Confirm the account owning the app and its billing before moving anything into a Codemagic Team. See [Codemagic iOS signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/).
4. In a reviewed later source update, merge `templates/testflight-workflow.yaml` into the root workflow mapping after its integration and signing inputs are configured. After explicit beta-distribution approval, manually run **`mobile-ios-testflight`**. That workflow uploads to App Store Connect and requests TestFlight processing; it does not submit a public App Store release. See [Codemagic App Store Connect publishing](https://docs.codemagic.io/yaml-publishing/app-store-connect/).
5. For the first owner test, use App Store Connect's **TestFlight → Internal Testing**: create a test group, add the account holder as an eligible internal tester, and manually add the processed build. Complete any requested test/export-compliance information. The YAML does not configure `beta_groups`; an upload alone does not guarantee an invitation. External testers require a separate external group and any required beta review. See [Apple's internal tester guide](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).
6. Accept the available tester invitation and install through TestFlight. Then run the [physical NFC protocol](mobile-nfc-test-protocol.md).

Membership activation, successful compilation, completed signing, TestFlight availability and a real tag read are separate results. None guarantees same-day completion of the next step.

## Status to report

| Checkpoint | Evidence to keep | Current evidence in this guide |
| --- | --- | --- |
| Personal account | Signed-in page and Personal onboarding | Observed on 4 October 2026; GitHub source option selected, authorization pending |
| Source connection | Dedicated repository and reviewed commit | Not yet connected |
| Unsigned native build | Successful `mobile-ios-verify` log | Not yet run |
| Apple signing | Active membership, App ID and matching profile | Membership review pending |
| TestFlight installation | Processed build installed on the iPhone | Not yet completed |
| Physical NFC test | Exported app diagnostic report from real stickers | Not yet completed |

Keep actual test results in [Mobile NFC validation](mobile-nfc-validation.md). This guide does not convert planned steps into completed evidence.
