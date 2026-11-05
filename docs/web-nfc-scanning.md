# Web client wrap-up and NFC scanning in the browser

Date: 4 November 2026 (Australia/Sydney). Owner: server and web workstream. Status: live since 5 November 2026 (deployment `2026-11-05-web-console-wrapup-1.0.0`); all handset checks passed (see the end).

> **Corrected 5 November 2026.** NFC scanning is not a demonstration feature: it is the project's core input in both inventories, and the browser scan panels now appear in Working inventory too (Chrome on Android, top-level page). The 4 November decision below came from a relay error: what the owner had cut for budget reasons was **scan-zone location tracking** (fixed readers proving where a scan happened), not scanning tags. Locations stay manual; the Mapping simulator stays a Demonstration tool. Browser batch intake is still Demonstration-only for now; in Working inventory, register by tag with the phone apps or by hand with Register battery. See `docs/working-inventory-nfc.md`.

## Owner decisions

- The web client is wrapped up: test and simulation features that went stale are removed. Manual entry stays manual entry (typed registered tag, manual selection, Register battery); scanning is scanning.
- ~~Scanning in the browser is a demonstration feature, like Mapping~~ (superseded 5 Nov: scanning works in both inventories; only scan-zone location tracking was cut). Original text: Scanning in the browser is a **demonstration feature, like Mapping**. There is no budget for tags and readers on the real stock, so it appears only in the Demonstration inventory and is labelled as a demonstration. Working inventory shows no scan interface at all.
- Where the device or browser cannot scan, the page says so. The Teams/SharePoint management console (`/console`) never offers scanning.
- Mapping and its location tools stay, including the administrator's demonstration simulator in the Demonstration inventory (owner, 4 Nov).

## What was removed

| Item | Why | Notes |
| --- | --- | --- |
| `/nfc-test` "NFC test station" (`app/nfc-test/`, `lib/nfc-handoff.ts`), the iOS Shortcuts gateway (`scripts/nfc-shortcut-gateway.mjs`, `scripts/start-nfc-shortcut-test.mjs`, `scripts/test-nfc-handoff.mjs`) and their tests | Test page from before the native apps; superseded by Look up in iOS 1.1.1 and Android | The paused Capacitor app's NFC diagnostics link to `/nfc-test` will return 404 once this is deployed. `mobile/` is untouched. |
| Simulated intake controls ("Simulate this tag", "Simulate next new battery", `DEMO-INTAKE-` tags) | Simulation, not intake | Drafts, batches and unresolved requests saved by the simulated intake still recover and can be confirmed or removed. The server still accepts `simulated_intake` for them. |
| "Process as teaching group" on Scan checkout and Scan return | The 1.0 group-tagged ordinary movement; iOS and Android stopped sending it; whole-group checkout and return use teaching group checkouts (runs) in Teaching groups | A session saved with a group still shows it, read-only, and finishes as before; "Continue without the group" while nothing is queued or completed. Server support unchanged. |
| "Hardware tag reading is unavailable in this browser" banners | Replaced by the scan panel (Demonstration) or by plain manual-entry text (Working) | |

Server code, API contracts, migrations and stored data are unchanged.

## NFC scanning in the browser

- **Where it works:** Chrome on Android with NFC switched on, in a visible top-level page over HTTPS (`NDEFReader`, Web NFC). Not on iPhone (any browser), desktop browsers, Firefox or Safari, and never inside an iframe. Phones without it get: "NFC scanning isn't supported on this device or browser."
- **Gate:** the same rule as the phone apps and the server: `nativeNfcCapability(dataset).enabled`. Since 5 Nov 2026 this is true for both inventories; the panel still renders nothing in an embedded page.
- **Where it appears:** Scan checkout and Scan return (reads join the review list), First-time intake (each read becomes a draft), Retire or remove ("NFC scan" source), and the teaching checkout review ("NFC scan" input, through the existing bridge interface).
- **Identifiers:** Chrome's `serialNumber` (`04:a1:b2:…`) becomes `nfc:uid:04A1B2…`, the same form the phone apps send; only 4-, 7- or 10-byte UIDs are accepted.
- **Evidence:** each read is device-reported evidence in the existing `native_nfc` shape (`lib/teaching-nfc.ts`): platform `android`, technology `Web NFC (Chrome on Android)`, NDEF status `unknown`, no records and no capacity (the browser does not expose raw NDEF bytes, so none are claimed). Requests are recorded with source `native_nfc`, exactly like a phone read, and keep exact-request recovery.
- **Behaviour:** Start NFC scanning (a tap, which also lets Chrome ask for permission) starts one continuous scan that lasts until Stop, leaving the page, or the workspace locking (an unresolved request, storage failure, room confirmation). Keeping one scan open means Android does not hand a tap to another app between reads, and a tag held against the phone is reported once (a repeat within two seconds is ignored). Reads are adopted and handed over in order; a read is dropped if scanning stopped or the workspace locked meanwhile. A tag that cannot be read shows a message and listening continues; refused permission, NFC switched off or no reader ends listening with the reason. One input source per review list still applies.
- **Where it is offered:** `useNfcScanOffered(dataset)` (an inventory with NFC enabled, now both, and a top-level page) decides every entry point: the scan panels, the "NFC scan" source buttons in Retire or remove and the teaching checkout review, and the explanatory text. `TeachingNfcInput` offers a reader only when its caller allows it.
- **Code:** `lib/web-nfc.ts` (support, UID conversion, error mapping, browser bridge with `read()` and continuous `listen()`), `lib/teaching-nfc.ts` (`teachingNfcBridge()`: a native bridge if a mobile runtime installed one, otherwise the cached browser bridge), `components/inventory/nfc-scan-panel.tsx` (the panel and `useNfcScanOffered`).

## Not verified

Checklist for an Android phone in Chrome (first run on 5 November, see below):

1. Permission prompt on first Start; refusal shows the reason; allowing it later in site settings works.
2. A registered demonstration tag joins the checkout list; the same tag read again is ignored as a duplicate; Confirm records source "NFC scan".
3. The same tag gives the same `nfc:uid:` identifier as the iOS and Android apps (compare with Look up).
4. An unregistered tag offers Register battery.
5. NFC switched off in Android settings gives the "switched off" message.
6. Tag types the browser cannot read (for example MIFARE Classic) give the "could not read" message.
7. Intake: several new tags become drafts; confirm one; Change common details between scans.
8. Retire or remove with the NFC scan source.
9. (Updated 5 Nov: Working inventory now offers scanning too.) `/console` shows no scanning; an iPhone shows the not-supported notice.

## Handset results (5 November 2026)

Owner, moto g04 (Android 14), Chrome, real tags, against the local fictional development server reached through `adb reverse` (`http://127.0.0.1:5190` is a secure context, so Web NFC behaves as over HTTPS): the permission prompt and reads worked, an unregistered tag offered Register battery, and the owner reported the remaining checks as passed. Item 3 was checked afterwards on the hosted service (owner, 5 November, after the deployment): the same tag read in the hosted Demonstration inventory by the web page and by Look up in a phone app gave the same identifier.
