import { reloadSessionPage } from "../client-utils";

/** Keep transport errors separate from a domain's receipt verification. */
export async function inventoryResponse<T = unknown>(
  response: Response,
): Promise<T> {
  let body: T & { error?: string; code?: string };
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "The server response was interrupted. Retry with your existing input.",
    );
  }
  if (response.status === 401) reloadSessionPage("/signin");
  if (!response.ok) {
    throw Object.assign(
      new Error(
        body.error || "The inventory could not complete this operation.",
      ),
      { status: response.status, code: body.code },
    );
  }
  return body;
}
