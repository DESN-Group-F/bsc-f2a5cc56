/** True inside a frame, such as the Teams website tab. A cross-origin parent throws on access. */
export function isEmbeddedPage(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.self !== window.top; } catch { return true; }
}
