# NFC in the Working inventory

Date: 5 November 2026 (Australia/Sydney). Owner: server and web workstream; the iOS and Android workstreams own their clients.

## Decision (owner, 5 Nov 2026)

- NFC is the project's core input. In the **Working** inventory, staff look up, check out, return, register and retire batteries by NFC tag, with manual entry and manual selection always available beside it. Demonstration inventory was only ever meant to rehearse these same workflows before real use.
- What was cut for budget reasons is **scan-zone location tracking**: fixed readers in each storage area that would have proved where a scan happened. That is why locations are entered by hand and why Mapping, its beacons and its simulator stay Demonstration tools. Scanning tags with a phone was never cut.

## How the restriction arose

- Release R3 (before 2 Nov) shipped with native NFC accepted only in Demonstration, "until physical workflow acceptance is approved". It was a temporary gate.
- On 3 Nov the native iOS API contract recorded it as project policy, and the iOS and Android clients hard-coded it.
- On 4 Nov the owner said the "scan area" was a demonstration feature like Mapping because of budget. That referred to scan zones for location tracking, but it was recorded as "NFC scanning is a demonstration feature", and the browser scanner was built to that rule. The QR label plan of the same day was partly a workaround for it.
- On 5 Nov real tags passed on the owner's phone (browser and app read identical UIDs), which met the original acceptance condition, and the QR labels were dropped; neither change reopened the gate. The owner found the problem while preparing the 6 Nov pilot.

## What changed

Server (code only, no migration; the database never restricted NFC):

- `lib/native-nfc-capability.ts`: `enabled` for both inventories, `enabledDatasets: ["demo", "live"]`, `physicalAcceptance: true`. The shape is unchanged.
- Removed the Working-inventory gates on `source: "native_nfc"` in tag lookup (`queries.ts`), checkout and return (`movements.ts`), teaching checkout runs (`teaching-checkouts.ts`), retirement and removal (`lifecycle.ts`) and intake by tag (`intake-store.ts`). The same evidence validation, exact-request replay and receipts apply as in Demonstration.
- Still Demonstration-only: any `simulated` source, simulated intake (`DEMO-INTAKE-…` tags), `mobile_register` (an operator-entered registration test), room observations, Bluetooth location capture and the Mapping simulator. Working returns still need a verified room or "Room not specified".

Web:

- The NFC scan panels and the "NFC scan" sources in checkout and return, Retire or remove, and teaching checkout review follow the capability, so they now appear in Working inventory (Chrome on Android, top-level page; never inside the Teams tab).
- The browser's native removal draft and removal recovery accept Working inventory (`lib/removal-draft.ts`, `lib/lifecycle-session.ts`).
- Browser batch intake stays Demonstration-only for now (owner, 5 Nov); its Working-inventory text points to registering by tag in the phone apps or by hand with Register battery.
- Wording that called NFC a demonstration feature is gone from the interface.

Clients (their own workstreams; task card given to the owner on 5 Nov):

- iOS hard-coded `allowsNFCWrites { self == .demo }`; 1.1.4 is to read `capabilities.nativeNfc` instead.
- Android 0.3.0 hard-coded Demonstration too; the 0.3.1 source reads the capability.
- Older builds keep NFC hidden in Working inventory and keep working with manual selection.

## Tests

Server, store and HTTP checks that asserted the Working gate now assert the Working flows instead: native lookup, checkout, exact retry and return; native intake with exact retry; native retirement; native teaching checkout, continuation and hand-back; simulated sources still rejected in Working. UI tests now treat the scan panel as offered in both inventories.
