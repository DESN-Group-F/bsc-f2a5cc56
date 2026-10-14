# Mobile NFC development and first physical test

The current full business App iteration is Test `0.2.0`: see [scope, actual checks and remaining acceptance](mobile-app-test-0.2.md). The sections below retain the original diagnostic Test `0.1.0` preparation and signing context; they are not the current feature list.

This is local development, outside the frozen hosted release. The first target is an iPhone 13 with a user-reported iOS version of 26.6 and NTAG213 stickers. Apple Developer Program identity review is pending. Android is also a target; no Android phone has been tested yet.

The user approved the current prototype on 4 October 2026 for functional testing only. Its independent test version `0.1.0` is excluded from the formal release sequence and does not advance the main application's version. This is approval of the prototype's scope, not evidence of Apple review completion, physical NFC acceptance or authorization to publish/deploy.

`0.1.0` is an internal diagnostic build identifier. Keep this prototype and its diagnostic handoff out of formal release artifacts unless the user separately approves their inclusion. Future reuse of validated adapter code in the complete mobile application can be reviewed as part of that later milestone.

## What is being prepared

`mobile/` is an independent React and Capacitor application with its own dependency lockfile. It packages the local interface with a small native, read-only NFC adapter. It does not package the existing server inside the phone.

The diagnostic workflow starts one explicit read, collects the tag UID and raw NDEF records, displays decoded text/URI records when supported, and retains successes, failures, cancellation and interrupted attempts locally. Device model, sticker label and mounting surface are operator declarations, not facts inferred from a tag. A blank NDEF message is a valid test result; UID reading does not require writing a URL onto a sticker. The application never writes, locks or password-protects a tag.

The optional **Open inventory lookup** action uses a separately configured HTTPS inventory origin and a canonical identifier such as `nfc:uid:040012AB34CD56`. It always opens the demonstration lookup page. It never follows an arbitrary URL found on a tag. The web page uses its own authenticated browser session and performs an explicit, read-only lookup. URL parameters are unverified input; they are not proof of a physical scan. Unknown tags remain unknown and are not automatically registered.

Native account login, first-time registration and reviewed checkout/return inside the phone application are subsequent work. The existing web movement workflow remains the reference: stage 1–100 records, review, explicitly confirm, guard versions/tag bindings/loan IDs, and preserve uncertain requests for exact retries. A scan alone must never change a loan or recorded location.

## Local commands

Use Node.js 22.13 or newer. From the repository root:

```powershell
cd mobile
npm ci
npm test
npm run test:plugin
npm run build
node ../scripts/prepare-mobile-native.mjs --all
npm run dev
```

Open `http://127.0.0.1:5180/` for the interface preview. A desktop browser cannot perform this native NFC read. Preview mode explicitly reports NFC as unavailable and does not create successful or simulated reads.

Preparation can be limited to `--ios` or `--android`. `--check` checks both prepared native projects without modifying them. Preparation checks native package bindings, iOS NFC purpose and entitlements, and native application identifiers. These checks do not compile Swift/Java, verify a signing profile, or prove a phone can read a sticker. After changing web code, rebuild and sync before producing a new installable package.

The current application identifier is provisionally `com.batteryinventory.mobile`. Confirm ownership and availability before creating the Apple App ID. If changed, review `capacitor.config.ts`, both native identifiers and `codemagic.yaml` together. Do not silently reuse an unrelated existing application identity.

## Windows to signed iPhone package

Windows can host this conversation and perform the web development. The iOS compiler runs on macOS, either on a local Mac or on an authorized cloud build service. Connecting an iPhone to this Windows computer does not provide Xcode or make the unsigned prototype installable.

Follow the separate checkpoints in [Codemagic setup from Windows](mobile-codemagic-setup.md). Apple's free Personal Team does not support the required NFC Tag Reading capability; a successful free-account login does not make this app signable with NFC enabled. An unsigned cloud compile check can proceed before paid membership activation.

The development workspace's `codemagic.yaml` contains three manually started workflows and no push triggers. The standalone source export activates only the two unsigned verification/debug workflows; its signed workflow is stored separately in `templates/testflight-workflow.yaml`:

| Workflow | Purpose | External effect if started |
| --- | --- | --- |
| `mobile-ios-verify` | Compile the native iOS project without signing | Uses cloud build resources; produces an unsigned artifact that cannot be installed on the phone |
| `mobile-ios-testflight` | Sign and upload the beta | Uploads a build to App Store Connect and requests TestFlight processing; does not submit a public App Store release |
| `mobile-android-debug` | Produce an Android debug APK | Uses cloud build resources; does not publish to Google Play |

At the initial local preparation checkpoint, no workflow had been run. The user subsequently authorized test-source publication into the existing project's `codex/nfc-functional-test` branch. That public branch is connected to Codemagic, and the first unsigned iOS compile check has passed. See the dated [actual validation record](mobile-nfc-validation.md). Test distribution still requires its own authorization and signing preparation. Do not upload local databases, `work/`, `.env` files, account credentials or signing material.

After Apple membership becomes active, prepare:

1. An Apple team identifier and confirmed application bundle ID. Enable **NFC Tag Reading** on that explicit App ID and obtain a matching App Store distribution profile with the NFC entitlement.
2. An App Store Connect application record for the bundle ID and its Apple application ID. This is separate from membership activation.
3. A cloud build account and an App Store Connect integration named `battery-inventory`. Enter API credentials and signing material directly into the service's protected configuration, never into this repository or the conversation. In **Code Signing Identities**, provide an Apple distribution certificate and a regenerated App Store profile that includes NFC Tag Reading. The API integration alone does not create or select a valid profile; `environment.ios_signing` selects matching signing files already configured in the service.
4. A reviewed, authorized source snapshot accessible to the service. Start the unsigned compile check first, correct any native diagnostics, then start the TestFlight workflow after explicit test-distribution approval.
5. TestFlight installed on the iPhone and the correct tester invitation. Build processing and any required beta review can take additional time. Membership approval is not a promise of same-day installation.

Codemagic's environment and account limits may change. Confirm Xcode 26.6 availability and the account's remaining build allowance before starting a run. The project uses Swift Package Manager for iOS, avoiding a CocoaPods installation step. It still requires Apple's macOS toolchain.

Public App Store publication is a later milestone requiring product metadata, screenshots, privacy declarations, support details and Apple review. The diagnostic prototype is not represented as ready for public release. Its iOS resource bundle includes the filesystem plugin's required file-timestamp privacy reason for local report export; final App Store privacy answers must be reviewed again when account login, telemetry or server-side submissions are added.

## First physical test

For an iPhone-only setup while native signing is pending, use the separate [NFC Tools and Shortcuts trial guide](mobile-nfc-without-signing.md). It tests physical sticker reading and system automation without installing this project's native app. Its results must remain separately attributed.

Until our own signed app is installed, an existing NFC reader utility can establish whether the phone reads the sticker. Keep those results separately attributed to that utility; do not present them as this application's results. No Apple identity workaround is needed for that preliminary sticker test.

Use the full [physical test protocol and blank evidence tables](mobile-nfc-test-protocol.md) for two stickers, ten deliberate attempts per sticker, separate recovery controls and export verification. The outline below is a quick reference; do not overwrite a failed attempt with its retry.

For the first test of this application:

1. Place one NTAG213 sticker on paper or plastic, away from metal and batteries. Label it `Test tag 01`. Leave the sticker writable; do not lock it or change its password.
2. Record the phone model, actual iOS version, sticker packaging label and mounting surface in **Test setup**. Start with the application in the foreground and the iPhone unlocked.
3. Tap **Start NFC read**, bring the upper part of the iPhone near the sticker, and hold it still until the result or an error appears. The native session has a bounded timeout. Record cancellation and timeout as separate outcomes.
4. Repeat ten attempts on the same labeled sticker and surface. Compare the complete UID including leading zeros. Separate UID success, NDEF support/content, errors and time taken; do not turn an empty NDEF message into a failure.
5. Test a second sticker to check that its UID is distinct. Cancel one session, close/reopen the app, and verify saved attempts and interrupted reads are retained truthfully.
6. Export the JSON report before reinstalling or clearing application storage. There is no application backup or automatic inventory sync for local reports. Compare an independent reader result if a UID or NDEF discrepancy appears.
7. After UID normalization is verified, use an explicitly registered demonstration record with the matching canonical tag ID for the authenticated lookup. Test a known tag, an unknown tag and a signed-out session. Confirm no loan, location or asset is created by lookup.

Ten attempts are an engineering trial, not a certified reliability threshold. Record the actual counts and decide acceptance criteria from the intended workflow. Test performance on the real battery mounting surface separately; ordinary stickers often fail near metal. Do not assume a successful paper test validates battery-mounted operation, room mapping or automatic tracking.

## Upgrade boundary

The asset's permanent battery ID must remain separate from its tag binding. The diagnostic NFC identifier records the UID bytes; it does not assert a serial number, secure identity, asset ownership or location.

A combined NFC/UHF label can occupy one physical sticker, but its two radio interfaces may expose different identifiers. UHF still needs a suitable reader; the iPhone's NFC reader does not gain UHF capability. BLE or other active tracking adds its own gateways, events and power considerations. Keep each future identifier's technology and source explicit, and map validated bindings to the same battery record.

Changing sticker technology or mounting requires another focused physical feasibility test: identifier stability, read distance, interference, duplicate behavior and reader output. The core inventory, responsibility and loan model should remain reusable, while the reader adapter and identifier-binding/event-ingestion layer may need extension. This prototype does not promise compatibility with an unselected tracking product or implement continuous tracking.

## References

- [Capacitor iOS Swift Package Manager](https://capacitorjs.com/docs/ios/spm)
- [Apple supported iOS capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios/)
- [Apple identity verification](https://developer.apple.com/help/account/membership/identity-verification/)
- [Codemagic Capacitor builds](https://docs.codemagic.io/yaml-quick-start/building-an-ionic-app/)
- [Codemagic iOS signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/)

The references support the platform preparation steps. Actual local validation and outstanding native/device checks are recorded separately in [Mobile NFC validation](mobile-nfc-validation.md).
