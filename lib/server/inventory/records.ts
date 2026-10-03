import { DomainError } from "../../domain";
import type { InventoryDatabase, Row } from "./database";

export async function getBattery(database: InventoryDatabase, id: string) {
  const battery = await database.first(
    "SELECT * FROM batteries WHERE scope=? AND id=?",
    database.scope,
    id,
  );
  if (!battery)
    throw new DomainError(404, "Battery not found in this inventory.");
  return battery;
}

export function requireActiveBattery(battery: Row) {
  if (battery.lifecycle_status !== "active") {
    throw new DomainError(
      409,
      "This battery has been scrapped or permanently removed. Its saved record and history are read-only.",
      "battery_inactive",
    );
  }
}

export function editVersion(
  before: Row | null,
  expectedVersion: number | undefined,
) {
  if (!before) return 1;
  if (
    expectedVersion === undefined ||
    expectedVersion !== Number(before.version)
  ) {
    throw new DomainError(
      409,
      "This record changed since you opened it. Your edits were not saved. Load the latest record and review your input before saving.",
      "record_conflict",
    );
  }
  return expectedVersion + 1;
}
