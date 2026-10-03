import { z } from "zod";
import { getD1Database } from "@/db";
import { AccountStore } from "./accounts";
import { sessionToken } from "./credentials";
import { DomainError } from "./domain";
export function apiJson(
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}
export function apiError(
  error: unknown,
  fallback: { logMessage: string; message: string } = {
    logMessage: "Application request failed",
    message:
      "The service is unavailable. Your input has been preserved; please try again.",
  },
) {
  if (error instanceof DomainError)
    return apiJson(
      { error: error.message, ...(error.code ? { code: error.code } : {}) },
      error.status,
    );
  if (error instanceof z.ZodError)
    return apiJson(
      {
        error: error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      },
      400,
    );
  console.error(fallback.logMessage, error);
  return apiJson({ error: fallback.message }, 503);
}

async function discardRejectedBody(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) return;
  const cancel = () => reader.cancel().catch(() => {});
  // Complete small rejected requests so the local Worker transport can reuse
  // its connection. Discard chunks without buffering or accepting their data.
  const timeout = setTimeout(() => void cancel(), 1000);
  try {
    let received = 0;
    while (received < Math.min(maxBytes, 250_000)) {
      const { done, value } = await reader.read();
      if (done) return;
      received += value.byteLength;
    }
    void cancel();
  } catch {
    // A broken rejected body must not replace the original denial response.
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

export async function requestJson(
  request: Request,
  max = 250_000,
  tooLargeMessage = "This request is too large.",
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    await discardRejectedBody(request, max);
    throw new DomainError(403, "Cross-origin changes are not allowed.");
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    await discardRejectedBody(request, max);
    throw new DomainError(415, "Send changes as JSON.");
  }
  const text = await request.text();
  if (text.length > max) throw new DomainError(413, tooLargeMessage);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainError(400, "The request is not valid JSON.");
  }
}
export async function requestUser(request: Request) {
  const user = await new AccountStore(getD1Database()).authenticate(
    sessionToken(request.headers.get("cookie")),
  );
  if (!user)
    throw new DomainError(401, "Sign in with an active staff account.");
  return user;
}
