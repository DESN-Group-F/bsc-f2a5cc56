export interface NfcAvailability {
  available: boolean;
  enabled: boolean;
  platform: 'ios' | 'android' | 'web';
  /** Availability does not verify signing entitlements, tag compatibility or reception. */
  reason?: string;
}

export interface NfcRecord {
  tnf: number;
  typeHex: string;
  idHex: string;
  payloadHex: string;
}

export interface NfcReadResult {
  /** Uppercase bytes in native reader order, including every leading zero. */
  uidHex: string;
  technology: string;
  ndefStatus: 'readWrite' | 'readOnly' | 'notSupported' | 'unknown';
  /** Reported NDEF capacity, not total chip memory or the length of the UID. */
  capacityBytes: number | null;
  records: NfcRecord[];
  /** A UID can be read even when the later NDEF operation fails. */
  ndefError?: string;
  /** Device-clock observation timestamp in ISO 8601 UTC. */
  observedAt: string;
}

export interface BatteryNfcPlugin {
  getAvailability(): Promise<NfcAvailability>;
  /** Starts one explicit read. Default 20 s; integer bounds 1–60 s. */
  read(options?: { timeoutMs?: number }): Promise<NfcReadResult>;
  /** Stops this plugin's pending session. Idempotent when no session is running. */
  cancel(): Promise<void>;
}

export declare const BatteryNfc: BatteryNfcPlugin;
