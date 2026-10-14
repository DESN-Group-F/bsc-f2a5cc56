import { z } from "zod";
import { identifier } from "./domain.js";
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true });
/** A software capture window, not a calibrated Bluetooth ranging threshold. */
export const LOCATION_CAPTURE_WINDOW_MS = 30_000;
export const LOCATION_HARDWARE_INGESTION = false;
export const SIMULATED_LOCATION_SOURCE = "Simulated phone scan with room beacons";
export const locationBeaconSchema = z.object({
    id: identifier,
    label: z.string().trim().min(1).max(120),
    identifier: z.string().trim().min(1).max(128),
    roomId: identifier,
    roomVersion: version,
    buildingVersion: version,
    active: z.boolean(),
}).strict();
export const locationBeaconRequestSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("create"), requestId: z.string().uuid(), ...locationBeaconSchema.shape }).strict(),
    z.object({ action: z.literal("update"), requestId: z.string().uuid(), ...locationBeaconSchema.shape, expectedVersion: version }).strict(),
]);
export const locationCaptureSchema = z.object({
    requestId: z.string().uuid(),
    source: z.enum(["demo_room_scan", "phone_ble_scan"]),
    batteryId: identifier,
    tagId: z.string().trim().min(1).max(128),
    expectedBatteryVersion: version,
    capturedAt: timestamp,
    candidates: z.array(z.object({
        beaconId: identifier,
        version,
        detectedAt: timestamp,
        rssi: z.number().int().min(-127).max(20).optional(),
    }).strict()).max(16),
}).strict().superRefine((value, context) => {
    if (new Set(value.candidates.map(candidate => candidate.beaconId)).size !== value.candidates.length)
        context.addIssue({ code: "custom", path: ["candidates"], message: "Include each adopted room beacon once." });
    for (const [index, candidate] of value.candidates.entries()) {
        const age = Date.parse(value.capturedAt) - Date.parse(candidate.detectedAt);
        if (age < 0 || age > LOCATION_CAPTURE_WINDOW_MS)
            context.addIssue({ code: "custom", path: ["candidates", index, "detectedAt"], message: "Room evidence must be captured within the 30 seconds before this battery scan." });
    }
});
