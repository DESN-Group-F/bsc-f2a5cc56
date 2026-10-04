export const STORAGE_KEY = 'battery-inventory-nfc:diagnostics:v1';
export const APP_VERSION = '0.1.0';
export const DEFAULT_SETTINGS = Object.freeze({
  deviceModel: 'iPhone 13', chipLabel: 'NTAG213', tagLabel: 'Test tag 01', surface: 'paper', inventoryOrigin: '',
});
export const SURFACES = ['paper', 'plastic', 'metal', 'anti-metal'];
const outcomes = ['pending', 'read', 'failed', 'cancelled', 'interrupted'];

export function normalizeUid(value) {
  if (typeof value !== 'string' || !/^[0-9a-fA-F:\s-]+$/.test(value)) throw new Error('The reader returned an invalid tag UID.');
  const uid = value.replace(/[:\s-]/g, '').toUpperCase();
  if (![8, 14, 20].includes(uid.length)) throw new Error('An ISO 14443 NFC UID must contain 4, 7 or 10 bytes.');
  return uid;
}

export function canonicalTagId(uid) { return `nfc:uid:${normalizeUid(uid)}`; }

export function inventoryLookupUrl(configuredOrigin, uid) {
  const url = new URL(configuredOrigin.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Enter an HTTPS origin only, without a path, login details, query or fragment.');
  }
  const result = new URL('/nfc-test', url.origin);
  result.searchParams.set('tagId', canonicalTagId(uid));
  result.searchParams.set('dataset', 'demo');
  return result.href;
}

function bytesFromHex(hex) {
  if (typeof hex !== 'string' || hex.length % 2 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error('Invalid hexadecimal data');
  return Uint8Array.from(hex.match(/.{2}/g) || [], (part) => parseInt(part, 16));
}
function decodeBytes(bytes, encoding = 'utf-8') { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
const uriPrefixes = ['', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://', 'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:'];

export function decodeRecord(record) {
  try {
    const type = bytesFromHex(record.typeHex);
    const payload = bytesFromHex(record.payloadHex);
    bytesFromHex(record.idHex);
    if (record.tnf === 1 && type.length === 1 && type[0] === 0x55) {
      if (!payload.length || payload[0] >= uriPrefixes.length) throw new Error('Invalid URI prefix');
      return { kind: 'URI', value: uriPrefixes[payload[0]] + decodeBytes(payload.slice(1)) };
    }
    if (record.tnf === 1 && type.length === 1 && type[0] === 0x54) {
      if (!payload.length || payload[0] & 0x40) throw new Error('Invalid text status');
      const languageLength = payload[0] & 0x3f;
      if (payload.length < 1 + languageLength) throw new Error('Truncated language code');
      const languageBytes = payload.slice(1, 1 + languageLength);
      if (languageBytes.some((byte) => byte > 0x7f)) throw new Error('Invalid language code');
      const language = decodeBytes(languageBytes);
      let textBytes = payload.slice(1 + languageLength);
      let encoding = 'utf-8';
      if (payload[0] & 0x80) {
        encoding = 'utf-16be';
        if (textBytes.length % 2) throw new Error('Truncated UTF-16 text');
        if (textBytes[0] === 0xff && textBytes[1] === 0xfe) { encoding = 'utf-16le'; textBytes = textBytes.slice(2); }
        else if (textBytes[0] === 0xfe && textBytes[1] === 0xff) textBytes = textBytes.slice(2);
      }
      return { kind: 'Text', value: decodeBytes(textBytes, encoding), language, encoding };
    }
    return { kind: 'Raw record', value: null };
  } catch (error) { return { kind: 'Undecoded record', value: null, warning: error.message }; }
}

export function emptyState() { return { version: 1, settings: { ...DEFAULT_SETTINGS }, reports: [] }; }
export function validateReadResult(result) {
  try {
    normalizeUid(result.uidHex);
    return typeof result.technology === 'string' && ['readWrite', 'readOnly', 'notSupported', 'unknown'].includes(result.ndefStatus)
      && (result.capacityBytes === null || (Number.isInteger(result.capacityBytes) && result.capacityBytes >= 0))
      && typeof result.observedAt === 'string' && Number.isFinite(Date.parse(result.observedAt))
      && (result.ndefError === undefined || typeof result.ndefError === 'string')
      && Array.isArray(result.records) && result.records.every((record) => record && Number.isInteger(record.tnf) && record.tnf >= 0 && record.tnf <= 7
        && ['typeHex', 'idHex', 'payloadHex'].every((key) => typeof record[key] === 'string' && record[key].length % 2 === 0 && /^[a-f0-9]*$/i.test(record[key])));
  } catch { return false; }
}
function validReport(report) {
  return report && typeof report.id === 'string' && typeof report.startedAt === 'string' && Number.isFinite(Date.parse(report.startedAt))
    && outcomes.includes(report.outcome) && report.setup && typeof report.setup.tagLabel === 'string'
    && typeof report.setup.deviceModel === 'string' && typeof report.setup.chipLabel === 'string' && SURFACES.includes(report.setup.surface)
    && typeof report.platform === 'string' && (report.error === null || (report.error && typeof report.error.code === 'string' && typeof report.error.message === 'string'))
    && (report.outcome !== 'read' || validateReadResult(report.result));
}

export function loadState(raw) {
  if (raw === null) return { state: emptyState(), recovered: false, error: null };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !parsed.settings || !Array.isArray(parsed.reports)
      || !Object.keys(DEFAULT_SETTINGS).every((key) => typeof parsed.settings[key] === 'string')
      || !SURFACES.includes(parsed.settings.surface) || !parsed.reports.every(validReport)) throw new Error('Unsupported or damaged saved data');
    let recovered = false;
    const reports = parsed.reports.map((report) => {
      if (report.outcome !== 'pending') return report;
      recovered = true;
      return { ...report, outcome: 'interrupted', endedAt: null, error: { code: 'APP_INTERRUPTED', message: 'The app closed or reloaded before this attempt completed. No read result was recorded.' } };
    });
    return { state: { ...parsed, reports }, recovered, error: null };
  } catch {
    return { state: emptyState(), recovered: false, error: 'Saved test data could not be read. It has been kept unchanged. Export the saved raw data before resetting local storage.' };
  }
}

export function summarizeTrials(reports, settings, limit = 10) {
  const attempts = reports.filter((report) => report.outcome !== 'pending' && report.setup.tagLabel === settings.tagLabel
    && report.setup.surface === settings.surface && report.setup.deviceModel === settings.deviceModel && report.setup.chipLabel === settings.chipLabel).slice(-limit);
  const count = (outcome) => attempts.filter((report) => report.outcome === outcome).length;
  const reads = attempts.filter((report) => report.outcome === 'read');
  return { total: attempts.length, reads: count('read'), failed: count('failed'), cancelled: count('cancelled'), interrupted: count('interrupted'),
    ndefIssues: reads.filter((report) => report.result.ndefError || report.result.ndefStatus === 'notSupported').length,
    distinctUids: [...new Set(reads.map((report) => normalizeUid(report.result.uidHex)))],
  };
}

export function createExport(state, platform, now = new Date().toISOString()) {
  return { schema: 'battery-inventory-nfc-diagnostics', schemaVersion: 1, appVersion: APP_VERSION, exportedAt: now,
    exportingPlatform: platform, releaseChannel: 'functional-test', scope: 'Local NFC read diagnostics only; no registration, loan or location changes.',
    settings: state.settings, reports: state.reports };
}
