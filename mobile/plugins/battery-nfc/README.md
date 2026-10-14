# Battery Inventory NFC plugin

Local Capacitor 8 plugin for an explicit, read-only, one-tag diagnostic session. It reads the UID and available NDEF metadata/records. It does not write, format, lock, authenticate, register batteries, record location, or change loans. A reported writable state is diagnostic information only.

## API

Import `BatteryNfc` from `@battery-inventory/nfc`. The shipped JavaScript and declarations need no plugin build step. `getAvailability()`, `read({ timeoutMs })`, and `cancel()` are declared in `index.d.ts`. The default timeout is 20 seconds; accepted integers are 1,000–60,000 milliseconds. Start each read from a deliberate user action.

UID, type, identifier and payload fields are uppercase hexadecimal in native reader byte order, including leading zeros. No integer conversion, byte reversal, model inference or payload interpretation is performed. `observedAt` is the phone's UTC clock at tag detection; it is not server time. `capacityBytes` is the platform-reported NDEF capacity, not total chip memory. An initialized blank tag returns an empty records array. A missing NDEF interface reports `notSupported` for this reader; it does not prove that the physical chip cannot be formatted. Formatting is never attempted.

Once a UID has been observed, an NDEF read/connection failure or timeout returns that UID with `ndefError` and the available evidence. Cancellation and leaving the foreground reject the pending read instead. Reject codes include `BUSY`, `CANCELLED`, `TIMEOUT`, `BACKGROUND`, `UNAVAILABLE`, `DISABLED`, `INVALID_ARGUMENT`, `CONFIGURATION`, `UNSUPPORTED_TAG`, and `NFC_SESSION`. The browser reports unavailable and never supplies simulated readings.

Only one session can run. Cancellation is idempotent. iOS callbacks must match the active session object. Android reader callbacks capture their original session, and a stopped session remains busy until its I/O and close operations have exited. This prevents an old callback or delayed close from completing or disabling a replacement read. Native driver failures can still delay resource cleanup; if repeated reads remain busy, close and reopen the app and retain the error for diagnosis.

## iOS integration

The Swift Package Manager product is `BatteryInventoryNfc`, with plugin class `BatteryNfcPlugin` and JavaScript name `BatteryNfc`. It depends on Capacitor Swift PM 8.5.2 or a compatible later 8.x version, and uses Core NFC `NFCTagReaderSession` with ISO 14443 polling. The reader accepts the MIFARE interface used by the intended NTAG213 test tags; support is not inferred solely from the printed tag model.

The app target needs:

- A nonempty `NFCReaderUsageDescription` in `Info.plist`.
- The Near Field Communication Tag Reading capability, with `com.apple.developer.nfc.readersession.formats` containing `TAG`.
- An explicit application identifier and a signed provisioning profile that permits NFC tag reading.
- A compatible physical iPhone, a foreground app and a native build made with a compatible Xcode/macOS environment. The simulator cannot prove NFC operation.

No ISO 7816 application identifiers, FeliCa codes or background NFC entitlement are required for this MIFARE-only path. `readingAvailable` does not validate provisioning or establish a successful hardware read. Pending Apple membership activation and signing must be resolved before the intended iPhone can test this app.

## Android integration

The library's manifest supplies `android.permission.NFC` and an optional NFC hardware feature. Devices without NFC can install the app and receive an unavailable result. Reader mode polls NFC-A only and leaves Android's NDEF check enabled, so an initialized blank tag can still expose the NDEF interface. The app must be foregrounded with NFC enabled. Leaving the foreground cancels the session. NFC I/O and cancellation close operations run off the UI thread.

## Validation boundary

Run `npm test` from this plugin directory after installing the mobile app dependencies. Web adapter tests exercise the shipped JavaScript using Capacitor's web runtime. The Android lifecycle test compiles the actual Java plugin against controlled API doubles and checks cancellation, timeouts, backgrounding, old callbacks, blank NDEF, byte preservation and I/O cleanup. It requires a JDK and explicitly skips when none is available; scratch fixtures stay under ignored `work/`.

These checks cannot establish Android SDK linking, iOS compilation, signing, radio behavior, UID consistency across physical readers or device compatibility. The native implementations require actual iOS and Android builds and physical-device tests. No native or NTAG213 acceptance is claimed by this source package.

References: [Capacitor iOS plugins](https://capacitorjs.com/docs/plugins/ios), [Swift Package Manager](https://capacitorjs.com/docs/ios/spm), [Apple Core NFC](https://developer.apple.com/documentation/corenfc), [Apple NFC entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.nfc.readersession.formats), [Android reader mode](https://developer.android.com/reference/android/nfc/NfcAdapter#enableReaderMode(android.app.Activity,android.nfc.NfcAdapter.ReaderCallback,int,android.os.Bundle)), [Android NDEF](https://developer.android.com/reference/android/nfc/tech/Ndef).
