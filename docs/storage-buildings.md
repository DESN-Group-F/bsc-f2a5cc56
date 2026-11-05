# Storage buildings: J18, E10 and G17

Status: implemented on 5 November 2026 for the pilot in the E10 and G17 makerspaces. Deployment `2026-11-05-locations-1.0.0` (code only, no migration).

## Why

Until 5 November only J18 (Willis Annexe) could hold registered storage. The pilot runs in two makerspaces outside J18: **E10 G19 MCIC Makerspace** and **G17 120 Electrical Engineering Makerspace**. Both buildings were already reference rows in every inventory (`E10 - Hilmer Building`, `G17 - Electrical Engineering Building`) but were disabled. Location is chosen by hand; there is no reader hardware.

## Rule

`lib/location-catalog.ts` holds two lists:

- `SUPPORTED_BUILDING_IDS = ["J18", "E10", "G17"]`: buildings that may hold registered storage. `DEFAULT_BUILDING_ID = "J18"` for new records and the demonstration inventory.
- `ROOM_BUILDING_IDS = ["J18"]`: buildings that may hold selectable rooms. Database triggers from migrations 0007 (`rooms_availability_*`) and 0021 (room beacons) keep selectable rooms and beacons in J18, and this update is code only, so E10 and G17 hold storage **without a room**. Each pilot makerspace is the only one in its building, so the building identifies the makerspace.

Consequences:

- Registration, intake, CSV import, saved-record edits and group storage changes accept J18, E10 or G17. A room stays optional; when given, it must be selectable and belong to the chosen building. Every server guard checks that binding at commit time, and the database hierarchy triggers still apply.
- Rooms can be registered, edited and imported only in J18; the server refuses E10/G17 rooms with a clear message instead of reaching the trigger.
- Return rooms, room beacons, storage-area tasks and demonstration observations already require a selectable room, so in practice they stay in J18. Their server checks were widened to the supported list so that a later migration only has to replace the triggers.
- A building an administrator registers outside the list stays a reference row: it shows as Not available.

Permissions do not change: only administrators manage buildings and rooms, and only administrators edit saved storage (`docs/permissions.md`).

## Clients

- **Web application and management console.** Storage pickers list J18, E10 and G17. The console edits storage as one building-and-room choice per battery (`J18 · Room not specified`, `J18 · 101 · Store`, `E10 · Room not specified`, …), including "Set a field" for a selection, filters by registered storage building, and the review dialog states when the registered building changes. Mapping keeps J18 (the only building with rooms); E10 and G17 are listed as "no rooms yet".
- **Native iOS and Android.** Unchanged. They register new batteries in J18 and list only J18 rooms for returns. Their requests (`homeBuildingId: "J18"`) and every earlier request fingerprint and receipt stay valid; batteries stored in E10 or G17 show their building code. For the pilot, register batteries in the web console and use the phones for checkout and return.

## Compatibility

No migration and no data change. Request schemas widened from `"J18"` to the supported list, so old J18 payloads parse, fingerprint and replay exactly as before. The console's reviewed CSV import (`operator_import`) keeps one storage building per batch, bound by the existing `buildingVersion`.

Rolling back to the Teams embedding release keeps every record readable; that release shows E10/G17 storage as unavailable and accepts only J18 for storage, so saving any change to an E10/G17 battery from it moves the battery to J18. Leave those batteries unedited until the update is restored.

## Later (needs a migration)

Rooms in E10 and G17 (G19, 120) by replacing the 0007/0021 triggers; floors; archiving or disabling rooms and buildings; an administrator switch for which buildings are supported. Discussed with the owner on 5 November.
