# Battery Inventory NFC

Independent local NFC diagnostic application for iOS and Android. It reads one physical tag after an explicit action, retains raw UID/NDEF evidence locally and exports JSON reports. Browser preview reports NFC as unavailable. No sample hardware successes are seeded.

Approved by the user on 4 October 2026 for functional testing only. Test version `0.1.0` belongs to this independent prototype and is excluded from the main application's formal release sequence. It does not advance the main application's version or establish physical NFC acceptance. Prototype review approval does not establish Apple membership activation or authorize publication/deployment.

```powershell
npm ci
npm test
npm run test:plugin
npm run build
node ../scripts/prepare-mobile-native.mjs --all
npm run dev
```

Preview: `http://127.0.0.1:5180/`. Run these commands from this directory. Java control-flow tests use a JDK when available; they do not link an Android SDK. iOS compilation requires macOS. A successful web build or native-project preparation does not produce a signed iPhone installation.

The first physical target is iPhone 13 with NTAG213 stickers. Device/chip labels are operator declarations. Read-only demonstration inventory handoff uses a configured HTTPS origin; arbitrary NDEF URLs are not opened. Native login, battery registration, checkout/return and tracking are not implemented in this diagnostic application.

See the [development/signing guide](../docs/mobile-nfc-development.md), [physical test protocol and blank records](../docs/mobile-nfc-test-protocol.md), [Codemagic setup](../docs/mobile-codemagic-setup.md), [actual validation record](../docs/mobile-nfc-validation.md) and [native adapter](plugins/battery-nfc/README.md). The application bundle ID is provisional until the Apple team confirms it. Apple membership activation, native compilation, signing, TestFlight processing and physical reads remain separate steps. Nothing has been published or deployed by these local commands.
