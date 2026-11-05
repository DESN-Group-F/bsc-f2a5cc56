# Storage in E10 and G17 (5 November 2026)

Deployment `2026-11-05-locations-1.0.0`. Application version remains 1.0.0. GitHub release `battery-inventory-v1.0.0-locations-20261105`.

## What changes for staff

- Batteries can be registered and stored in E10 (Hilmer Building) and G17 (Electrical Engineering Building) as well as J18. In E10 and G17 the room is "Room not specified": rooms can still be added only in J18 (a database rule; a later update with a migration can lift it).
- In the management console, the storage cell and "Set a field" choose the building and room together, and the filters include the storage building.
- The phone apps are unchanged: they still register in J18 and list J18 rooms. Register pilot batteries in the web console; check out and return with the phones as before.

## What does not change

Permissions, the 25 migrations, the schema and stored data, the Teams tab and the gateway. No migration is appended; the update serves an independent verified copy of the current database and leaves the Teams embedding data unchanged.

## Details

`docs/storage-buildings.md` and `deploy/openbayes/2026-11-05-locations/README.md` (cutover, rollback and resume). Predecessor: `2026-11-05-teams-embedding-1.0.0` (`02189d1`).

## Going back

`cutover.py revert` while nothing was written; afterwards `cutover.py rollback` serves the current data through the Teams embedding application (E10/G17 storage stays readable but shows as unavailable; saving any change to such a battery there moves it to J18, so leave them unedited until `cutover.py restore`).
