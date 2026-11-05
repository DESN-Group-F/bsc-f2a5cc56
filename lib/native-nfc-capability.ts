import type { Dataset } from "./domain";

const NFC_DATASETS = ["demo", "live"] as const;

/**
 * Native NFC (the phone apps and browser NFC on Android Chrome) is a business input in both
 * inventories; the owner accepted it with real tags on 5 November 2026. Simulated sources,
 * room observations and scan-zone location tracking stay Demonstration-only and are not part
 * of this capability. Clients read `enabledDatasets` from the snapshot instead of assuming one.
 */
export function nativeNfcCapability(dataset: Dataset) {
  return {
    version: 1,
    enabled: (NFC_DATASETS as readonly Dataset[]).includes(dataset),
    enabledDatasets: NFC_DATASETS,
    operations: ["scan_lookup", "movement", "intake", "lifecycle", "teaching_checkout"] as const,
    evidenceSource: "device-reported" as const,
    physicalAcceptance: true,
  };
}
