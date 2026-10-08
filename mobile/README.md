# Battery Inventory mobile application

Test `0.2.0` bundles the existing staff and administrator business interface in a React/Capacitor application for iOS and Android. It includes inventory, personal views, details and history, teaching groups, task plans, messages, model assistance, removal, exports and administrator workspaces. The main application's formal release version remains unchanged.

The internal prototype is for functional testing only. Native compilation, signing, installation and real NFC acceptance remain separate, incomplete checks. Nothing is published or deployed by local preparation.

```powershell
npm ci
npm test
npm run test:plugin
npm run build
node ../scripts/prepare-mobile-native.mjs --all
```

Run these commands from `mobile/` with Node.js 22.13 or newer. Controlled Java tests require a JDK; they do not compile against Android SDKs. Native project preparation verifies declarations and plugin linkage, not platform compilation.

For functional browser testing, run `node scripts/start-mobile-app-test.mjs` from the full project root after the mobile build. It starts a fresh isolated D1-backed service at `http://127.0.0.1:5182/`. Fictional credentials are shown only on the computer's `/mobile-preview` page. To use an iPhone on the same LAN, add `--phone-address <this-computer-private-IPv4>`. A browser never reports native NFC availability.

In a source-only mobile snapshot, the backend is not included. Use a separately prepared compatible HTTPS test backend. The existing hosted release is not assumed to expose new registration actions.

The frontend snapshot is synchronized from the main application's runtime client graph. Server modules and business databases are excluded. If the main source is absent, the bundled snapshot is verified by its manifest before building.

Native service requests are pinned to an explicitly configured HTTPS origin. Session cookies stay in Keychain on iOS or Keystore-encrypted storage on Android, never JavaScript storage. Business recovery files are separate and scoped to the service. Every POST waits for pending recovery saves; unreadable data blocks new operations and remains available for review. Offline writes are not reported as successful.

New recoverable operator registration is demonstration-only, with automatic permanent IDs, authoritative server time, optional canonical tag binding, J18 storage and unknown specifications kept null. Checkout/return use existing reviewed queues, account/version/tag/loan guards and original-request recovery. NFC reads preserve independent device evidence and propose identifiers for explicit operator confirmation; they never change inventory by themselves.

For the current signed-device experiment, use [the 8 October native NFC scan trial](../docs/mobile-nfc-scan-trial.md). It reuses this interface without redesign, keeps checkout/return in the demonstration inventory, and distinguishes Ad Hoc packaging from internal TestFlight. The operator confirmed that the observed Apple login is the account used for the approved application; the portal still showed pending membership and denied team access. Paid team activation and the exact billing or provisioning cause remain unresolved. Use that guide for the latest dated account checkpoint; neither signing route is ready for the observed account.

See [Test 0.2.0 scope and acceptance](../docs/mobile-app-test-0.2.md), [historical validation](../docs/mobile-nfc-validation.md), [NFC adapter](plugins/battery-nfc/README.md) and [secure service adapter](plugins/battery-service/README.md). The bundle ID is provisional until the Apple team confirms it. Real tracking and verified reader-to-room observations remain outside this test.
