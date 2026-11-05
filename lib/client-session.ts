import { reloadSessionPage } from "./client-utils";
import { isEmbeddedPage } from "./embedded-page";

export async function signOut() {
    const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "signout", embedded: isEmbeddedPage() }) });
    if (!response.ok) throw new Error("Sign-out could not complete. Try again.");
    reloadSessionPage("/signin");
}
