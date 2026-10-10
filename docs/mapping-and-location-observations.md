# Mapping and location observations

Status: local development for version 1.0.0. This work has not been published or deployed. The Bluetooth hardware and native phone reader are not implemented or accepted by this change.

## Evidence boundaries

Registered storage is an asset's intended home. A location observation is separately dated evidence. An active loan records a checkout. None of these fields is inferred from either of the others.

A room beacon identifies a candidate room for a phone scan; it does not directly detect the battery. A battery observation requires its own reviewed battery/tag binding. Opening a record, exporting data, editing metadata or selecting a remote batch does not establish the physical presence of those batteries.

The available demonstration action explicitly simulates one tagged battery scan. It is restricted to administrators in the demonstration inventory. Its source is always `Simulated phone scan with room beacons`. The working inventory cannot accept that action. Existing manual return confirmations and their sources remain unchanged.

## Mapping workspace

Mapping uses application tabs similar to browser tabs. The permanent **Overview** tab shows schematic room cards and an explicit **Unknown** bucket. The drawings do not represent a surveyed floor plan, beacon coverage or live positions.

Selecting a room card opens only its summary beside the map. The summary shows active battery counts, loan status and up to three latest evidence previews. Selecting that card again, closing the summary or using **Reset view** clears the room selection. It does not open, close or reset a room detail tab.

**View details** opens a room tab, or focuses the existing tab for that room without duplicating it. Each open room tab has its own inventory filters, ordering, page, expanded records and selected batteries. Switching tabs, returning to Overview or using **Back to mapping** preserves those states while the tabs remain open. A room tab can be closed individually; closing it discards that tab's local view state and selects an adjacent tab or Overview. Overview cannot be closed. Tabs and their local view state are not a durable browser-session restore feature; changing the account or inventory also creates a new Mapping workspace.

Overview's **Filter** control contains the building choices. J18 Willis Annexe is the supported selection. E10 Hilmer Building and G17 Electrical Engineering Building appear as unavailable reference choices. **Clear filters** returns to the supported J18 overview and closes this filter disclosure; it does not clear the selected room summary or any room tab's filters and selected batteries.

Room detail tabs reuse the ordinary inventory table. The room identity is a fixed `mappingRoom` query boundary. Search, ordinary filters, lifecycle criteria, sorting, status counts, pagination and downloads compose with that boundary; **Clear filters** retains it and the chosen batteries. Summary and selected-detail exports retain the room boundary, including exports opened from battery details. A selection whose latest observation moves outside its tab is identified as outside scope rather than silently treated as belonging to the old room.

Overview counts and previews include active assets only. Scrapped and permanently removed assets are excluded. A new room tab also defaults to active assets; staff can explicitly use its ordinary lifecycle filter to review retired records within the same observation scope. Consequently an explicitly changed lifecycle filter may produce a different count from the active-only Overview card.

### Last-observation and Unknown semantics

`lib/inventory-mapping.ts` groups the server's latest observation projection by stable room identity. A battery appears in at most one room bucket. An earlier observation in a mapped room does not override a later observation elsewhere. Registered storage, ownership and loan status never fill a missing observation. In store and In use counts describe recorded loan state, not physical presence.

| Latest evidence | Mapping bucket |
| --- | --- |
| Valid observation time and stable identity of a currently selectable J18 room | That room |
| No observation recorded | Unknown |
| Observation time or stable room identity unavailable | Unknown |
| Last observed room outside the selectable J18 map, including a no-longer-available room | Unknown |

Unknown therefore means **without a usable mapped last observation**, not proof that a battery has no location or that its earlier evidence was erased. Known evidence outside this map remains in history. A missing historical room label is also preserved as unavailable; it is not replaced with the current directory label or registered home. A usable stable room identity can still place the asset in its room bucket. Placeholder rooms remain labelled as placeholders and do not become verified physical locations merely because they have observations.

## Reused data and new configuration

The existing `observations` table stores accepted room observations, including observed time, server receipt time, source and saved room/building labels. The existing inventory query, last-observed-room filters, battery details and complete-history exports consume those records.

Migration `0021_location_beacons.sql` adds only `location_beacons`, an inventory-scoped configuration directory. It references existing room identities and records versioned mappings, active status and the last native administrator. It does not introduce another battery-position table. Deactivation preserves configuration history; deletion is unavailable.

Mapping changes are recorded in the existing shared audit. Capture evidence and exact-request receipts use the existing `audit_events` and `operations` tables. A `requestId` identifies one adopted capture event. Retrying a network request reuses that ID and its original payload; a genuinely new scan receives a new ID.

## Directory API

`GET /api/locations?dataset=demo|live` requires an active native account. It idempotently provisions the existing reference directories and staff projections before reading the beacon directory. It does not create beacon mappings or battery observations.

The response is `LocationDirectorySnapshot` from `lib/location-observations.ts`:

```json
{
  "dataset": "demo",
  "beacons": [],
  "capabilities": {
    "hardwareIngestion": false,
    "demoSimulation": true,
    "manageBeacons": true
  }
}
```

Each beacon includes its ID, operator label, configured broadcast identifier, room ID and saved current label, building ID/name, mapping version, room version, building version, room placeholder/selectable flags, active flag, timestamps and `hardwareValidated: false`.

`POST /api/locations` accepts an outer `dataset`, `action` (`create` or `update`) and `payload`. The payload contains:

| Field | Requirement |
| --- | --- |
| `requestId` | UUID retained for exact retries |
| `id`, `label`, `identifier` | Beacon management ID, display label and configured identifier |
| `roomId`, `roomVersion`, `buildingVersion` | The reviewed existing J18 directory binding |
| `active` | Boolean; use false to deactivate |
| `expectedVersion` | Required when updating a saved mapping |

Do not repeat `action` inside the HTTP payload. The shared `LocationBeaconRequest` type includes it for local state, and the route inserts the outer action before validation.

Only administrators may save mappings. The selected room must be selectable and belong to J18; working-inventory mappings additionally require a non-placeholder room. Adding or editing a mapping does not validate hardware or enable ingestion. No request property can turn hardware ingestion on.

## Capture API

`POST /api/location-observations` accepts `{ dataset, payload }`. The shared `LocationCapture` contract contains:

```json
{
  "requestId": "a-unique-UUID-for-this-adopted-event",
  "source": "demo_room_scan",
  "batteryId": "BAT-007",
  "tagId": "the-reviewed-registered-tag",
  "expectedBatteryVersion": 1,
  "capturedAt": "2026-10-10T00:00:00.000Z",
  "candidates": [
    {
      "beaconId": "A01",
      "version": 1,
      "detectedAt": "2026-10-10T00:00:00.000Z",
      "rssi": -60
    }
  ]
}
```

The example UUID placeholder must be replaced with a real UUID. The evidence values are illustrative, not recorded hardware measurements.

Candidates are a distinct list of up to 16 configured beacons. Their samples must fall within 30 seconds before the adopted battery scan. This is a software capture-binding rule for the prototype, not a measured Bluetooth room-selection or ranging threshold. RSSI is optional evidence and never selects the strongest beacon automatically.

All candidates must still match their reviewed mapping version and an active, selectable J18 mapping. Stale, disabled, missing or cross-inventory bindings are rejected. Candidates resolving to one room produce one observation. Candidates resolving to multiple rooms return `ambiguous`; an empty list returns `unresolved`. Both latter outcomes are attributed audit records with exact receipts, but do not overwrite the last definite observation.

The battery must remain active and match its exact ID, tag and reviewed version. Room samples alone, manual inventory selection and unregistered intake drafts cannot create this observation.

The server accepts the syntactic future source `phone_ble_scan` only to return HTTP 501 with `location_hardware_unavailable`. There is no active hardware ingestion path, background listener, beacon authentication, native Bluetooth scanner or calibrated room-confidence algorithm in this release.

## Receipts, time and atomicity

`LocationCaptureReceipt` identifies the request, dataset, native actor and battery. It contains `outcome`, nullable `observationId` and room, explicit simulation source, canonical UTC `capturedAt`, server `receivedAt` and `replayed`. Directory writes return the same identity fields plus the saved beacon.

An accepted observation retains device-reported scan time separately from receipt time. Future scan times are rejected. Older uploads can append history without replacing a chronologically newer location. Existing latest-observation ordering uses observation time, then receipt time. Device time is not a server or hardware attestation; trustworthy offline ordering and historical acceptance of changed room mappings require further device validation. Changed mapping versions require a new reviewed capture rather than silently using today's mapping for an older event.

The operation receipt, account authorization guard, reviewed battery/mapping/room guards, observation and audit commit in one D1 batch. A concurrent mapping or account change cannot leave an orphan success event. Replaying an identical successful request returns its original result, even if the mapping later changes. Reusing an ID for different payload or actor returns `idempotency_conflict`.

Terminal validated business rejections reserve the original request ID and return `location_rejected_final`. Transport/server uncertainty preserves the original payload and ID. A client may only release an unresolved request after validating the matching authoritative receipt or handling a definitive rejection. It must not regenerate scan time, choose another room or replace the payload during retry.

Location capture does not borrow or return batteries, change responsible ownership, replace registered storage, mark an inspection completed or register an intake draft. Those workflows retain their existing confirmations and transaction boundaries.

## Location setup and demonstration use

Open **Location setup** from Mapping Overview to view the room beacon directory and server-returned capabilities. All active staff can read the directory. Administrator controls appear only when the server reports `manageBeacons`; the single-scan simulator also requires `demoSimulation` and the demonstration inventory. Hardware ingestion always displays **Disabled**. There is no hardware enable switch.

An administrator configures a beacon's display label, broadcast identifier and existing J18 room, then saves the mapping. The client allocates the management ID for a new mapping. Editing captures the loaded mapping, room and building versions. Deactivation marks the mapping inactive without deleting history. Working-inventory mappings require a verified, non-placeholder room on the server. Configuration does not install, discover, calibrate or validate a beacon.

For a demonstration event:

1. Choose one active battery with a registered tag. The panel displays its captured ID, tag and version.
2. Select up to 16 configured active room beacons, or choose **Use no room evidence**. The preview distinguishes one room, multiple rooms and Unknown before submission. A directory refresh keeps previously selected versions visible; changed selections must be removed and chosen again.
3. Select **Submit one simulated scan**. The client captures the device time at that action, uses it for the simulated candidate times and allocates one request ID. It does not invent RSSI measurements.
4. Read the confirmed result. A recorded result shows **Last observed location**, its simulation source, device capture time and server receipt time. Ambiguous and unresolved results explicitly state that no Last observed location was recorded; only the test outcome and audit receipt were retained. Existing definite evidence is not replaced with an invented room.

The panel does not add a location step to ordinary staff checkout or return. The simulator is a separate administrator demonstration tool, not a phone or hardware reader.

### Durable request recovery and browser limits

Before a write is sent, `lib/client/location-request.ts` validates and clones its complete request into account-and-inventory-scoped `localStorage`, then reads it back to verify persistence. The retained request includes its original request ID, battery/tag and version guards, beacon versions, source and evidence times. Uncertain network or server results, unrecognized errors and `idempotency_conflict` keep that original request. Refreshing or reopening the application does not automatically submit it; the application exposes **Resume location request** and the panel offers **Retry the same request**.

Only a matching authoritative receipt releases a successful request. Receipt checks include native account, inventory and request identity; captures also check battery, equivalent UTC capture time, explicit simulation source and the outcome's nullable evidence fields. Mapping receipts guard the saved mapping and reviewed room/building versions. A `location_rejected_final` result remains visible until the operator acknowledges its reserved rejection. Retry never changes the captured time or adopts newer directory or battery versions.

The panel uses an origin-scoped Web Lock for the account/inventory request key across persistence, submission and receipt handling. Another tab cannot start that write sequence while the lock is held; it is told to resolve the request in the other tab. Storage also rejects replacement or removal of a different retained original request. This protects cooperating application tabs; it is not a cross-device lock or a substitute for server idempotency and D1 guards.

Writes require an available browser Web Locks API and functioning `localStorage`. If either is unavailable or storage verification fails, the panel reports the limitation and does not send a new write. An unreadable or mismatched saved record is retained for **Export recovery record** and review rather than silently discarded. The sticky Close controls explain why exit is blocked during an in-flight request or unresolved recovery. A failed inventory refresh after a confirmed result is labelled separately and blocks another change until refresh succeeds.

Browser persistence is local to that origin, browser profile and device. It does not promise survival after browser data is cleared, storage is evicted or a private session ends, and it does not transfer a pending request to another device. The supported-browser check is capability based; no particular browser version or native-phone platform has been accepted by this implementation.

## History, exports and permanent deletion

Observation room/building labels are snapshotted when the server accepts the record. Later directory renames do not backfill the saved evidence. Existing observation sources remain valid and are not recategorized.

Capture snapshots have explicit battery identities in the existing audit and operation payloads. The existing authorized scrapped-asset purge therefore clears their observations and related structured snapshots, hashes the reserved request fingerprint and prevents delayed replay. The independent beacon directory and its mapping history remain intact. No extra asset snapshot table needs a separate purge pathway.

## Recorded validation

On 2026-10-10, the new `tests/location-observations-store.test.mjs` suite passed all 12 tests against an isolated, non-persistent Miniflare D1 database. Coverage includes directory and demo permissions, hardware denial, reviewed mapping/room versions, exact and concurrent retries, same-room candidate aggregation, ambiguous/missing evidence, chronological late uploads, immutable saved labels, terminal rejection reservations, mapping and account races, database replacement/cross-inventory guards, export evidence and authorized purge cleanup. Foreign-key checks passed in the guarded database and purge scenarios.

Targeted ESLint passed for the new service/contracts/routes/tests and the schema. HTTP checks are integrated into `tests/api/locations.mjs` and the existing isolated API smoke runner. Their integrated execution and the final application build are reported separately by the overall release validation; this document does not claim those checks have run merely because the tests exist.

The client recovery suite `tests/location-request.test.mjs` separately passed **8/8** tests on 2026-10-10 after compiling the library with `node scripts/test-domain.mjs --compile-only`. It covers immutable captured payloads and native context, persistence readback failure, replacement/removal guards, retention of unreadable records, final versus uncertain rejection handling, mismatched authoritative receipts, equivalent UTC capture times, empty/ambiguous outcome fields and reviewed mapping/directory versions. Targeted ESLint passed for `components/inventory/location-tools-panel.tsx` and `lib/client/location-request.ts`. These results do not establish browser interaction, storage recovery across real browser sessions or multi-tab lock acceptance; those checks and the full application regression result are recorded separately by the overall validation.

No normal or hosted business data was modified during these D1 tests. The software test results do not establish physical NFC or Bluetooth acceptance.
