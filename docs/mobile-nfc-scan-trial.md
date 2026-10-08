# Native NFC scan checkout and return trial

This guide covers the existing **Test 0.2.0** functional-test App, using the reviewed 5 October source. It does not introduce an App redesign or change the formal release version. The trial uses disposable demonstration inventory and fictional accounts. The current hosted inventory and its business data are outside this trial.

## Dated readiness and source scope

On 8 October 2026, the operator initially reported that Apple Developer Program membership had become active and that App Store Connect was not yet enabled. The authenticated Apple account page later inspected that day instead displayed pending membership and a purchase/processing notice. The Certificates, Identifiers & Profiles page then reported that it could not find a team to which the signed-in account belonged and directed the account holder to Apple Developer Program Support. The operator subsequently confirmed that this observed Apple login is the account approved for the membership application. The exact billing or provisioning cause of the remaining pending status and team-access error is unknown; an account mismatch is no longer an unresolved trial hypothesis. Paid membership activation and signing access are therefore not confirmed, and both signing routes remain blocked for that observed account. Codemagic Personal was signed in, but no signing certificates were listed and certificate generation/profile fetching was disabled without a configured integration. Its billing page showed 1 of 500 monthly minutes used (499 remaining) and subscription not enabled. These are dated account-page observations, not evidence that a new cloud run or signing operation has occurred. No private account name, email or Team ID is retained in this source.

Apple states that membership confirmation follows processing of the purchase. If no membership confirmation has arrived within 24 hours of the purchase, contact Apple Developer Support and include the Enrollment ID. Use the existing purchase information for that request; the portal notice alone does not establish that a further purchase is needed. See [Apple program enrollment](https://developer.apple.com/help/account/membership/program-enrollment/).

The phone and sticker were previously declared as iPhone 13 and NTAG213. The actual phone OS version, account permissions, App ID, profiles, cloud SDK image and installed build must be recorded during this trial. Until the intended paid Apple team is available, neither signing route below can be treated as ready.

This candidate derives only from the immutable `mobile-business-test-020-20261005-b.zip` archive (SHA-256 `116968d32ce108bcd0347d27a51842132d8f9e82a224aa363e8191fd10f28b61`). The existing business interface, NFC reader, service adapter and frontend source hashes are retained. Changes are limited to this guide, candidate README instructions, manual distribution configuration and an opaque RGB encoding of the existing App icon. No current main-frontend work, backend, account credentials, business database or Git history is included.

The known sticker's independent NFC Tools output is `04:9F:7C:62:A6:20:90`. Its reviewed canonical value is **`nfc:uid:049F7C62A62090`**. Earlier NFC Tools and Shortcuts/Safari successes are separate evidence. They do not count as reads by this installed App.

## Installation prerequisites and conditional routes

Before either signing route, confirm that the paid Apple team owns the explicit App ID corresponding to the candidate's provisional bundle identifier `com.batteryinventory.mobile`, with **NFC Tag Reading** enabled. Use a matching signing profile that contains the App's `TAG` reader entitlement. Do not invent a Team ID or use another team's profile. Enter private keys, certificate passwords and signing profiles only in protected account settings; do not add them to this source or a test report.

Run `mobile-ios-verify` against this exact reviewed source to compile the new Test 0.2 native service plugin before attempting installation. The earlier successful unsigned Test 0.1 build does not establish that this candidate compiles. The unsigned artifact is not installable on the iPhone. The workflow preserves the existing Xcode 26.6 selection; cloud image availability and actual SDK version remain to be checked.

Choose one legitimate distribution route after the relevant protected settings are ready:

| Route | Manual workflow | Required configuration | Distribution boundary |
| --- | --- | --- | --- |
| Registered-device trial while App Store Connect is unavailable | `mobile-ios-adhoc` | Paid Apple Developer portal access; registered test iPhone UDID; Apple Distribution certificate/private key; matching Ad Hoc profile containing that UDID and NFC capability, uploaded to Codemagic protected signing identities | Produces an Ad Hoc IPA and logs only. There is no App Store Connect integration or publishing block. The compatible Windows/device installation method must be verified separately before claiming the IPA is installable. |
| Owner's internal TestFlight trial after App Store Connect is enabled | `mobile-ios-testflight` | Matching App Store Connect app record; eligible account with app access; protected `battery-inventory` integration; Apple Distribution certificate/private key; matching App Store NFC profile | Uploads to App Store Connect for processing. `submit_to_testflight: false` and `submit_to_app_store: false` skip CI review submissions. The export is marked internal-testing-only. No external tester groups or public release are configured. |

All workflows are manual and have no automatic triggers. Preparing this candidate does not publish source, run a cloud build, enable paid usage, upload an IPA or install it. Those actions remain separate checkpoints. The App Store Connect path does not create an app record, activate the service or configure signing by itself.

For TestFlight, confirm processing and any requested export-compliance answers. Before uploading, inspect existing internal-group automatic-distribution settings and tester membership; the two CI submission flags do not disable Apple's automatic internal distribution. Add the processed internal build to the intended eligible group manually, record **What to Test**, then confirm installation on the actual iPhone. Do not create an external group or submit a public release for this trial.

References: [Codemagic iOS signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/), [Codemagic App Store Connect publishing](https://docs.codemagic.io/yaml-publishing/app-store-connect/), [Apple internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers), [Apple registered devices](https://developer.apple.com/help/account/devices/register-a-single-device), and [Apple NFC reader setup](https://developer.apple.com/documentation/corenfc/building-an-nfc-tag-reader-app).

## Isolated test connection

The native App requires a trusted **HTTPS origin**, a compatible inventory API and a secure host-only `inventory_session` cookie. The old HTTP LAN browser preview is not the native connection. A public HTTPS tunnel alone does not fix the browser preview's Host/Origin checks or its upstream non-Secure cookie. Use the separately prepared, authorized native test gateway or an equivalent compatible isolated HTTPS service. Do not weaken the App's HTTPS or credential rules.

Record the actual gateway/backend run identifier and origin. Use fictional staff credentials provided for that run, and keep the test service available while performing the trial. Enter the origin under **Trusted HTTPS inventory service**, choose **Save service connection**, then sign in. Confirm that the workspace loads. Choose **Demonstration inventory** before opening the checkout/return station; the NFC station button is deliberately disabled for the working inventory in this test.

The snapshot includes no backend. A UI build alone cannot start one. Do not use the existing hosted release as an assumed compatible test endpoint or enter real operational data.

## Trial session record

Complete a separate session record before reading. Test 0.2's exported NFC JSON contains actual attempt IDs, times, UID/NDEF results and outcomes; it does not automatically contain phone model, OS, surface, operator or mounting conditions. Preserve those fields here instead of inventing them in a report.

| Field | Actual value |
| --- | --- |
| Trial label / date and timezone | |
| Source archive SHA-256 / cloud commit | |
| Cloud workflow / build log / SDK version | |
| Signing route / installed Test version and build number | |
| Phone model / actual OS version | |
| Test operator / fictional staff account identity | |
| Backend run identifier / HTTPS origin | |
| Sticker label / package marking / supplier reference | |
| Surface / mounting position / phone-case condition | |
| App NFC export filename / verified saved location | |
| Business history export filename / verified saved location | |

## A. Establish App UID reading

1. After sign-in, open **NFC evidence** and select **Read NFC tag**. Present only the known sticker near the iPhone's top edge. Preserve its current contents; do not write, format, lock or password-protect it.
2. Confirm the raw UID is `049F7C62A62090`, retaining the leading zero and byte order. Keep the actual NDEF status, raw records and any NDEF error. A UID result with incomplete NDEF is not a claim that NDEF reading passed.
3. Move the phone away and explicitly start a new read for each attempt. Perform **ten attempts**, including failures. Do not replace a failed attempt with a retry. Record each attempt ID and outcome in the table below.
4. Verify all successful reads of this sticker have the same complete UID. Investigate any mismatch before binding an asset. This is a declared-condition baseline, not an estimate of general reliability, battery-mounted performance or Android compatibility.
5. Select **Export app NFC evidence**, use the device share/save sheet, and reopen the actual JSON file. Confirm `testVersion: 0.2.0`, `source: native-nfc-reader` and the ten attempt IDs/outcomes match the App. A share sheet opening alone is not proof that the file was saved.

| Attempt | Actual outcome | Complete UID / NDEF finding | App report ID |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
| 8 | | | |
| 9 | | | |
| 10 | | | |

## B. Bind one demonstration asset

If the isolated inventory already has an asset deliberately bound to the known canonical UID, inspect its ID and state instead of registering a duplicate. Otherwise choose **Register**, give the fictional test battery an English name, and use **Read NFC tag**. Select **Use identifier as operator input** to accept the proposal. Confirm the field is exactly `nfc:uid:049F7C62A62090`.

Keep unknown specifications blank. Use the signed-in native staff owner, J18 and **Room unspecified** unless a separate test room is deliberately chosen. Select **Review registration**, inspect the proposed identity and details, then choose **Confirm registration** once. Record the server-confirmed automatic Battery ID and registration time. A queued draft or a physical UID read does not register the battery.

## C. Checkout through the reviewed station

1. In Demonstration inventory, open **Check out** for an in-store registered test asset. Record its current owner, version and absence of an active loan.
2. Choose **Read NFC tag**, present the known sticker, then choose **Use identifier as operator input**. The proposal only fills the tag field. Select **Add tag to review** and confirm that the queue resolves the deliberately bound Battery ID.
3. Check that the queue says **Queued / not committed** and the battery remains in store. Read and add the same sticker again: it must not add a second copy or save a movement. Preserve the duplicate notice and separate NFC attempt evidence.
4. Review the one-item list, then choose **Confirm checkout (1)** and complete its confirmation. Await an authoritative server result; do not count a timeout or an uncertain state as success.
5. Check the completed result and asset detail: state **In use**, holder equals the authenticated staff account, responsible owner is unchanged, and one checkout loan exists. Record the loan ID, movement request ID and server time from the complete history/export.
6. Confirm the station stays open after success. Use **Exit scanning** explicitly to finish it.

## D. Return the same active loan

1. Open a new **Return** station. Select **Room unspecified** for this baseline before adding reads. Registered storage home must not silently become return placement.
2. Read the same sticker, accept **Use identifier as operator input**, then choose **Add tag to review**. Confirm the same Battery ID resolves with the active loan created in section C.
3. Inspect the review list before choosing **Confirm return (1)**. The captured payload must retain that exact Battery ID/loan ID pair; it must not substitute a later loan or another holder's state after review.
4. Await a confirmed result. Verify the asset is **In store**, no active loan remains, the original checkout is retained and one return closes that same loan. Owner and registered home remain distinct from the optional dated return placement.
5. Inspect the complete history/export and save it on the device. Confirm no duplicate loan, automatic room observation or hardware-location claim was created. Leave the station only through **Exit scanning**.

| Business checkpoint | Actual outcome / IDs / evidence |
| --- | --- |
| Registration or existing deliberate binding | |
| Reviewed checkout Battery ID / tag / version | |
| Duplicate read ignored without committing | |
| Confirmed checkout request / loan / holder / time | |
| Reviewed return Battery ID / exact loan ID | |
| Confirmed return request / same loan / time | |
| Owner/home/placement distinction retained | |
| Complete history export saved and reopened | |

## E. Additional controls

These are separate attempts after the baseline, not replacement successful baseline rows.

- **Cancel and timeout:** Start a read with no tag near the phone. Cancel in the system NFC sheet; record the outcome and start a fresh successful read. Repeat with no tag until the requested timeout ends, retaining the actual error and checking a later read can start. Neither control may invent a UID or a movement.
- **Unknown tag:** If a second unbound sticker is available, record its independently read UID and stage it in the station. Lookup must report unregistered; do not create an asset or loan automatically. Without a second sticker, record this control as not performed.
- **Restart with an uncommitted queue:** Stage the known in-store asset in checkout, leave it unconfirmed, close and reopen the App, sign in if required and return to that station. The captured queue must survive and remain uncommitted. Review it and explicitly clear or complete it before switching input method or leaving normally.
- **Interrupted NFC attempt:** Start reading without a nearby tag, then background or terminate the App. Reopen it. The original attempt must remain with its actual failed/cancelled/interrupted outcome and no invented success. Record the actual distinction; an already received background failure must not be relabelled as a different event.
- **Offline/uncertain movement:** On the disposable test asset only, capture a reviewed request and deliberately interrupt connectivity around confirmation. If the App reports uncertainty, retain the original request ID and exact payload. New reads, replacement requests and normal exit must stay blocked. Restore connectivity and choose **Retry same request**; verify one confirmed movement, with no second loan. If the response was confirmed before the interruption, record that fact and do not pretend uncertainty occurred. Response-loss-after-commit needs a separately controlled gateway experiment; the timing of Airplane Mode alone does not prove it.
- **Expired sign-in:** A signed-out or expired session must not save a movement. Preserve any captured pending work and sign back into the intended fictional account before resolving its exact request.

The App saves physical NFC evidence locally before handing its identifier to the operator. The movement source remains manual/operator confirmation; this trial does not enable accepted RFID observations, room mapping, tracking or automatic stock movements.

## Actual local preparation checks on 8 October 2026

- Immutable baseline ZIP CRC/SHA-256 and all 248 archive file entries verified against its artifact/source manifests. All 100 frontend output hashes verified; the candidate retains the exact frontend manifest and bytes.
- Clean standalone dependency installation completed. Mobile logic tests: 29 passed, zero failed/skipped. Controlled native adapter tests: six passed, zero failed/skipped, including 55 Android NFC lifecycle, 95 service policy and 115 bridge assertions. SDK/HTTP/vault doubles are not platform or physical acceptance.
- Standalone web production build passed after bundled frontend manifest verification. The business chunk remains about 1 MiB before gzip; device startup and low-memory behavior are unmeasured. The existing dependency catalog and lockfile are unchanged.
- Existing icon pixels were fully opaque. Re-encoding as RGB PNG removed the alpha channel while retaining identical decoded pixels. Both prepared native projects passed the existing source-declaration, entitlement, plugin-linkage and privacy-resource checks; no SDK compilation is implied.
- No source publication, cloud run, certificate/profile creation, IPA upload, installation or physical App NFC read occurred during local candidate preparation. The old browser and third-party utility results remain separate.

This candidate B is a documentation-only revision of the reviewed candidate A. The guide updates the confirmed account identity, remaining portal limitation, billing checkpoint and official membership follow-up. Application code, dependency catalog/lockfile, workflows, icon pixels and all 100 frontend files remain byte-identical to candidate A. The successful clean installation, 29 mobile logic tests, six controlled adapter tests, production build and native source checks above are inherited from the identical candidate A application source; they were not rerun for this documentation-only revision. Native SDK, signing, installation and device results remain incomplete.

## Actual conclusion

| Question | Recorded result |
| --- | --- |
| This exact candidate SDK compiled / signed / installed | |
| App UID successes / ten baseline attempts | |
| UID agrees with independent known sticker evidence | |
| Actual NDEF findings / unresolved errors | |
| Proposal, review and explicit confirmation verified | |
| One authenticated self-checkout and same-loan return | |
| Cancel/timeout/duplicate/restart/uncertain recovery | |
| NFC JSON and complete business history saved/reopened | |
| Remaining limitations / next focused trial | |

Record actual failures and missing checks directly. A successful iPhone trial does not establish Android acceptance, final battery-surface reliability, continuous tracking or readiness of the future App design.
