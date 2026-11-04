export type NfcHandoff = {
  tagId: string;
  suppliedByLink: boolean;
  blocked: boolean;
  error: string;
};

/** A typed UID stays distinct from writable NDEF content and other tag formats. */
export function normalizeNfcUidIdentifier(value: string): string | null {
  const match = /^nfc:uid:([a-f0-9]{8}|[a-f0-9]{14}|[a-f0-9]{20})$/i.exec(value.trim());
  return match ? `nfc:uid:${match[1].toUpperCase()}` : null;
}

export function parseNfcHandoff(search: string): NfcHandoff {
  const query = new URLSearchParams(search);
  const dataset = query.getAll("dataset"), tags = query.getAll("tagId");
  const refuse = (error: string): NfcHandoff => ({
    tagId: "", suppliedByLink: tags.length > 0, blocked: true, error,
  });
  if (dataset.length > 1 || (dataset.length === 1 && dataset[0] !== "demo"))
    return refuse("This diagnostic page supports only the demonstration inventory. Open a clean test page to continue.");
  if (tags.length > 1)
    return refuse("The link contains more than one identifier. Open a clean test page and supply one identifier.");
  if (!tags.length)
    return { tagId: "", suppliedByLink: false, blocked: false, error: "" };
  const tagId = normalizeNfcUidIdentifier(tags[0]);
  if (!tagId)
    return refuse("The link does not contain a supported NFC UID identifier. Open a clean test page and enter an identifier manually.");
  return { tagId, suppliedByLink: true, blocked: false, error: "" };
}

/** Return only to this local page; query text can never select another inventory. */
export function nfcHandoffReturnPath(tagId: string) {
  const query = new URLSearchParams({ dataset: "demo" });
  const typed = normalizeNfcUidIdentifier(tagId);
  if (typed) query.set("tagId", typed);
  return `/nfc-test?${query.toString()}`;
}

export function nfcHandoffSignInPath(tagId: string) {
  return `/signin?return_to=${encodeURIComponent(nfcHandoffReturnPath(tagId))}`;
}

export class NfcHandoffError extends Error {
  constructor(message: string, public kind: "authentication" | "identifier" | "service" = "service") {
    super(message);
    this.name = "NfcHandoffError";
  }
}

type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Session = { displayName: string } | null;
export type NfcLookup = {
  tagId: string;
  battery: { id: string; name: string; status: "In store" | "In use" | "Scrapped" | "Permanently removed" } | null;
};

async function responseBody(response: Response) {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body))
      return body as Record<string, unknown>;
  } catch {
    // A missing or unreadable response never confirms a lookup.
  }
  throw new NfcHandoffError("The service response could not be read. No lookup result has been confirmed; try again.");
}

export async function checkNfcHandoffSession(transport: Transport = fetch, signal?: AbortSignal): Promise<Session> {
  const response = await transport("/api/session", { credentials: "same-origin", cache: "no-store", signal });
  const body = await responseBody(response);
  if (!response.ok)
    throw new NfcHandoffError(typeof body.error === "string" ? body.error : "Staff access could not be checked. Try again.");
  if (body.user === null) return null;
  const user = body.user as Record<string, unknown> | undefined;
  if (!user || typeof user.id !== "string" || typeof user.displayName !== "string")
    throw new NfcHandoffError("Staff access could not be confirmed. Try again.");
  return { displayName: user.displayName };
}

/** Query only after an explicit user action; this never submits a business change. */
export async function lookupDemoNfcTag(input: string, transport: Transport = fetch): Promise<NfcLookup> {
  let tagId = input.trim();
  if (!tagId || tagId.length > 128)
    throw new NfcHandoffError("Enter one identifier of 1–128 characters.", "identifier");
  if (/^nfc:/i.test(tagId)) {
    const typed = normalizeNfcUidIdentifier(tagId);
    if (!typed) throw new NfcHandoffError("Use nfc:uid: followed by 8, 14 or 20 hexadecimal characters.", "identifier");
    tagId = typed;
  }
  if (!await checkNfcHandoffSession(transport))
    throw new NfcHandoffError("Sign in with an active staff account before looking up a demonstration identifier.", "authentication");
  const response = await transport("/api/inventory", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    // The existing manual source labels a staff-requested identifier query only.
    // No scan, observation, registration or movement evidence is saved here.
    body: JSON.stringify({ dataset: "demo", action: "scan_lookup", payload: { tagIds: [tagId], source: "manual" } }),
  });
  const body = await responseBody(response);
  if (!response.ok)
    throw new NfcHandoffError(typeof body.error === "string" ? body.error : "The identifier lookup failed. Try again.", response.status === 401 ? "authentication" : "service");
  const result = body.result as { source?: unknown; results?: unknown } | undefined;
  if (body.ok !== true || result?.source !== "manual" || !Array.isArray(result.results) || result.results.length !== 1)
    throw new NfcHandoffError("The response did not confirm this identifier. Try again.");
  const entry = result.results[0] as { tagId?: unknown; battery?: unknown } | undefined;
  if (entry?.tagId !== tagId)
    throw new NfcHandoffError("The response identifier did not match your request. No result has been accepted.");
  if (entry.battery === null) return { tagId, battery: null };
  const battery = entry.battery as Record<string, unknown> | undefined;
  if (!battery || battery.tagId !== tagId || typeof battery.id !== "string" || typeof battery.name !== "string" ||
      !["active", "scrapped", "permanently_removed"].includes(String(battery.lifecycleStatus)) ||
      (battery.loanId !== null && typeof battery.loanId !== "string"))
    throw new NfcHandoffError("The battery response could not be confirmed. Try again.");
  const status = battery.lifecycleStatus === "scrapped" ? "Scrapped" :
    battery.lifecycleStatus === "permanently_removed" ? "Permanently removed" :
    battery.loanId === null ? "In store" : "In use";
  return { tagId, battery: { id: battery.id, name: battery.name, status } };
}
