import type { TeachingNfcBridge, TeachingNfcProposal } from "./teaching-nfc";

/**
 * Web NFC (NDEFReader) in the browser. Chrome on Android is the only browser that offers it,
 * and only to a visible top-level page served over HTTPS. Embedded pages (for example the
 * Microsoft Teams tab) never scan. A browser read is device-reported evidence like a phone
 * app read: it identifies a tag by its UID and never confirms a battery by itself.
 */
export type WebNfcSupport = "available" | "unsupported" | "embedded";
export type WebNfcErrorKind = "cancelled" | "unreadable" | "permission" | "unavailable" | "identifier";

type NdefReaderLike = EventTarget & { scan(options?: { signal?: AbortSignal }): Promise<void> };
type NdefReaderConstructor = new () => NdefReaderLike;
type WebNfcWindow = Window & { NDEFReader?: NdefReaderConstructor };

export const WEB_NFC_TECHNOLOGY = "Web NFC (Chrome on Android)";

export class WebNfcError extends Error {
    readonly kind: WebNfcErrorKind;
    constructor(message: string, kind: WebNfcErrorKind) { super(message); this.name = "WebNfcError"; this.kind = kind; }
}

export function isEmbeddedPage(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.self !== window.top; } catch { return true; }
}

export function webNfcSupport(): WebNfcSupport {
    if (typeof window === "undefined") return "unsupported";
    if (isEmbeddedPage()) return "embedded";
    return window.isSecureContext === true && typeof (window as WebNfcWindow).NDEFReader === "function" ? "available" : "unsupported";
}

/** Chrome reports the UID as colon-separated hexadecimal bytes in the reader's byte order. */
export function webNfcTagId(serialNumber: unknown): { uidHex: string; tagId: string } {
    const value = typeof serialNumber === "string" ? serialNumber.trim() : "";
    if (!/^[0-9a-f]{2}(?::[0-9a-f]{2})*$/i.test(value)) throw new WebNfcError("This tag did not report a usable identifier. Try again, or use manual entry.", "identifier");
    const uidHex = value.replace(/:/g, "").toUpperCase();
    if (![8, 14, 20].includes(uidHex.length)) throw new WebNfcError("This tag's identifier is not a 4-, 7- or 10-byte NFC UID, so it can't identify a battery.", "identifier");
    return { uidHex, tagId: `nfc:uid:${uidHex}` };
}

export function webNfcScanError(error: unknown): WebNfcError {
    if (error instanceof WebNfcError) return error;
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    if (name === "AbortError") return new WebNfcError("NFC scanning stopped.", "cancelled");
    if (name === "NotAllowedError") return new WebNfcError("NFC permission was not granted. Allow NFC for this site in Chrome's site settings, or use manual entry.", "permission");
    if (name === "NotReadableError") return new WebNfcError("NFC is switched off or in use. Turn on NFC in the phone's settings, close other NFC apps, then try again.", "unavailable");
    if (name === "NotSupportedError") return new WebNfcError("This device has no NFC reader that the browser can use. Use manual entry.", "unavailable");
    return new WebNfcError("NFC scanning could not start. Try again, or use manual entry.", "unavailable");
}

export function webNfcProposal(serialNumber: unknown, attemptId: string, startedAt: string, observedAt = new Date().toISOString()): TeachingNfcProposal {
    const { uidHex, tagId } = webNfcTagId(serialNumber);
    return {
        attemptId, source: "native-nfc-reader", platform: "android", startedAt, endedAt: observedAt, tagId,
        // The browser does not expose raw NDEF bytes or tag capacity, so none are claimed.
        result: { uidHex, technology: WEB_NFC_TECHNOLOGY, ndefStatus: "unknown", capacityBytes: null, records: [], observedAt },
    };
}

/**
 * read(): one read per call; cancel() stops a pending read or a listening session.
 * listen(): one continuous scan for a listening session, so the page keeps the tag taps (Android
 * would otherwise hand a tap between reads to another app) and a held tag is reported once.
 * Returns null where the browser cannot scan.
 */
export function createWebNfcBridge(): TeachingNfcBridge | null {
    if (webNfcSupport() !== "available") return null;
    const Reader = (window as WebNfcWindow).NDEFReader as NdefReaderConstructor;
    let active: AbortController | null = null;
    const stop = () => { const controller = active; active = null; controller?.abort(); };
    return {
        async getAvailability() {
            const support = webNfcSupport();
            return support === "available" ? { available: true, enabled: true, platform: "android" } : { available: false, enabled: false, platform: "web", reason: support === "embedded" ? "NFC scanning is not offered inside an embedded page." : "NFC scanning isn't supported in this browser." };
        },
        read() {
            stop();
            const controller = new AbortController();
            active = controller;
            const attemptId = crypto.randomUUID(), startedAt = new Date().toISOString();
            return new Promise<TeachingNfcProposal>((resolve, reject) => {
                const finish = () => { if (active === controller) active = null; controller.abort(); };
                controller.signal.addEventListener("abort", () => reject(new WebNfcError("NFC scanning stopped.", "cancelled")), { once: true });
                const reader = new Reader();
                reader.addEventListener("reading", event => {
                    try { resolve(webNfcProposal((event as Event & { serialNumber?: unknown }).serialNumber, attemptId, startedAt)); }
                    catch (error) { reject(webNfcScanError(error)); }
                    finally { finish(); }
                }, { once: true });
                reader.addEventListener("readingerror", () => {
                    reject(new WebNfcError("A tag was detected but the browser could not read it. Hold it still against the back of the phone and try again. Some tag types can't be read in a browser; use a phone app or manual entry for those.", "unreadable"));
                    finish();
                }, { once: true });
                reader.scan({ signal: controller.signal }).catch(error => { reject(webNfcScanError(error)); finish(); });
            });
        },
        listen(onProposal, onFailure) {
            stop();
            const controller = new AbortController();
            active = controller;
            const startedAt = new Date().toISOString();
            const reader = new Reader();
            reader.addEventListener("reading", event => {
                if (controller.signal.aborted) return;
                try { onProposal(webNfcProposal((event as Event & { serialNumber?: unknown }).serialNumber, crypto.randomUUID(), startedAt)); }
                catch (error) { onFailure(webNfcScanError(error)); }
            });
            reader.addEventListener("readingerror", () => {
                if (!controller.signal.aborted) onFailure(new WebNfcError("A tag was detected but the browser could not read it. Hold it still against the back of the phone and try again. Some tag types can't be read in a browser; use a phone app or manual entry for those.", "unreadable"));
            });
            reader.scan({ signal: controller.signal }).catch(error => { if (!controller.signal.aborted) { if (active === controller) active = null; controller.abort(); onFailure(webNfcScanError(error)); } });
            return () => { if (active === controller) active = null; controller.abort(); };
        },
        async cancel() { stop(); },
        async adopt(proposal) { return { ...proposal, adoptedAt: new Date().toISOString() }; },
    };
}
