import { PLACEHOLDER_ROOMS, REFERENCE_BUILDINGS } from "../../location-catalog";
import { InventoryDatabase } from "./database";

/** Provision reference directories without reading inventory or transaction history. */
export async function ensureInventoryReferenceData(
  database: InventoryDatabase,
) {
  // Reference configuration and explicit account projections are not location evidence.
  // Existing labels are never replaced by these idempotent inserts.
  const ready = await database.first(
    "SELECT ((SELECT COUNT(*) FROM buildings WHERE scope=? AND id IN (SELECT value FROM json_each(?)))=? AND (SELECT COUNT(*) FROM rooms WHERE scope=? AND id IN (SELECT value FROM json_each(?)))=? AND NOT EXISTS(SELECT 1 FROM staff_accounts a WHERE NOT EXISTS(SELECT 1 FROM people p WHERE p.scope=? AND (p.account_id=a.id OR p.id='staff-' || a.id)))) AS ready",
    database.scope,
    JSON.stringify(REFERENCE_BUILDINGS.map((building) => building.id)),
    REFERENCE_BUILDINGS.length,
    database.scope,
    JSON.stringify(PLACEHOLDER_ROOMS.map((room) => room.id)),
    PLACEHOLDER_ROOMS.length,
    database.scope,
  );
  if (ready?.ready === 1) return;
  const writes: D1PreparedStatement[] = [];
  for (const building of REFERENCE_BUILDINGS)
    writes.push(
      database.statement(
        "INSERT INTO buildings(key,scope,id,name) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM buildings WHERE scope=? AND id=?)",
        database.key(building.id),
        database.scope,
        building.id,
        building.name,
        database.scope,
        building.id,
      ),
    );
  for (const room of PLACEHOLDER_ROOMS)
    writes.push(
      database.statement(
        "INSERT INTO rooms(key,scope,id,name,building_key,number,is_placeholder,selectable) SELECT ?,?,?,?,?,?,1,1 WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE scope=? AND id=?)",
        database.key(room.id),
        database.scope,
        room.id,
        room.name,
        database.key(room.buildingId),
        room.number,
        database.scope,
        room.id,
      ),
    );
  writes.push(
    database.statement(
      "INSERT INTO people(key,scope,id,name,reference,role,account_id) SELECT ? || '/staff-' || a.id,?,'staff-' || a.id,a.display_name,'','staff',a.id FROM staff_accounts a WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.scope=? AND (p.account_id=a.id OR p.id='staff-' || a.id))",
      database.scope,
      database.scope,
      database.scope,
    ),
  );
  await database.raw.batch(writes);
}
