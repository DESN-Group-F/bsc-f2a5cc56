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
  /** iOS only: opaque foreground session token for explicitly requested continuous reads. */
  readerSessionId?: string;
}

export interface NfcReadOptions {
  /** Default 20 s; integer bounds 1–60 s, including any wait for tag removal. */
  timeoutMs?: number;
  /**
   * iOS only. Keep Apple's system sheet open after a successful read.
   * The next read still requires an explicit call and the returned session token.
   * Errors, backgrounding, cancellation and system expiry end the session.
   * Other platforms retain their existing single-read behavior.
   */
  keepSessionAlive?: boolean;
  /**
   * iOS only. Continue this exact session; requires keepSessionAlive: true.
   * A closed/stale session rejects and never opens another sheet automatically.
   * Omit only for an explicitly started new session.
   */
  sessionId?: string;
}

export interface NfcReadFailure extends Error {
  code?: string;
  data?: {
    /**
     * iOS only. Already detected UID/NDEF progress from a rejected read.
     * Uses the result fields above, with an explicit ndefError, and never a
     * readerSessionId. Preserve as failed/cancelled evidence, not a proposal.
     */
    partialResult?: Omit<NfcReadResult, 'readerSessionId'> & { ndefError: string };
  };
}

export interface BatteryNfcPlugin {
  getAvailability(): Promise<NfcAvailability>;
  /** Starts one explicit read, or continues a retained iOS session with its exact token. */
  read(options?: NfcReadOptions): Promise<NfcReadResult>;
  /** Stops a pending or idle retained session. Idempotent when no session is running. */
  cancel(): Promise<void>;
}

export declare const BatteryNfc: BatteryNfcPlugin;
