/** Normalize a local return path without allowing an external sign-in redirect. */
export function safeReturnPath(value: string | null) {
    if (!value?.startsWith("/") || value.startsWith("//")) return "/";
    try {
        const url = new URL(value, "https://inventory.local");
        if (url.origin !== "https://inventory.local" || url.pathname === "/signin") return "/";
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return "/";
    }
}
