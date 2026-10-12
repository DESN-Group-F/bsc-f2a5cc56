import type { Dataset } from "./domain";

/** API support for controlled device evidence does not establish physical reader acceptance. */
export function nativeNfcCapability(dataset: Dataset) {
  return {
    version: 1,
    enabled: dataset === "demo",
    enabledDatasets: ["demo"] as const,
    operations: ["scan_lookup", "movement", "intake", "lifecycle", "teaching_checkout"] as const,
    evidenceSource: "device-reported" as const,
    physicalAcceptance: false,
  };
}
