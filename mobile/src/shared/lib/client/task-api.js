import { reloadSessionPage } from "../client-utils.js";
export async function taskRequest(url, options) {
    const response = await fetch(url, { cache: "no-store", ...options });
    if (response.status === 401)
        reloadSessionPage("/signin");
    let body;
    try {
        body = await response.json();
    }
    catch {
        throw Object.assign(new Error("The response was interrupted. Your input is preserved; review the saved records before retrying."), { status: response.status });
    }
    if (!response.ok)
        throw Object.assign(new Error(body.error || "The task operation could not be completed."), { status: response.status, code: body.code });
    return body;
}
