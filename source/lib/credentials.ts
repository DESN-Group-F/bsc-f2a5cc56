export const PASSWORD_ITERATIONS = 600_000;
export const SESSION_SECONDS = 8 * 60 * 60;
export const SESSION_COOKIE = "inventory_session";
const encoder = new TextEncoder();

export function hex(bytes: Uint8Array) {
    return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}
export function randomToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
export async function digest(value: string) {
    return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
export async function passwordHash(password: string, salt: string, iterations = PASSWORD_ITERATIONS) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations, hash: "SHA-256" }, key, 256);
    return hex(new Uint8Array(bits));
}
export function constantEqual(a: string, b: string) {
    let difference = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return difference === 0;
}
export function sessionCookie(token: string, secure: boolean, clear = false) {
    return `${SESSION_COOKIE}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}
export function sessionToken(cookie: string | null) {
    const values = (cookie ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(`${SESSION_COOKIE}=`));
    if (values.length !== 1) return null;
    const token = values[0].slice(SESSION_COOKIE.length + 1);
    return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
