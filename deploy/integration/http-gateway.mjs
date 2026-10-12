import http from "node:http";

const apiRoutes = new Map([
  ["/api/session", 5_000],
  ["/api/accounts", 10_000],
  ["/api/inventory", 250_000],
  ["/api/battery-models", 250_000],
  ["/api/teaching-groups", 250_000],
  ["/api/teaching-checkouts", 250_000],
  ["/api/task-plans", 250_000],
  ["/api/messages", 250_000],
  ["/api/locations", 20_000],
  ["/api/location-observations", 20_000],
  ["/api/export", 15_000],
]);
const postOnlyRoutes = new Set(["/api/location-observations"]);
const privatePaths = new Set([
  "/bootstrap.json", "/deployment.json", "/runtime.mjs",
]);
const requestHeaderNames = new Set([
  "accept", "accept-language", "cookie", "origin", "user-agent",
  "range", "if-range", "if-none-match", "if-modified-since",
  "rsc", "next-router-state-tree", "next-router-prefetch", "next-url", "x-nextjs-data",
]);
const responseHeaderNames = [
  "content-type", "content-disposition", "content-language", "content-range", "accept-ranges",
  "etag", "last-modified", "vary", "content-security-policy", "permissions-policy",
];
const safeHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
};
const unconfirmedMessage = "The inventory service could not confirm this request. Preserve any uncertain operation and retry its exact captured request.";

function fail(status, message) {
  throw Object.assign(new Error(message), { gatewayStatus: status });
}

function reply(request, response, status, error) {
  // Discard rejected input without buffering it or passing it to the Worker.
  request.resume();
  response.writeHead(status, { ...safeHeaders, "Content-Type": "application/json" });
  response.end(request.method === "HEAD" ? undefined : JSON.stringify({ error }));
}

function trustedOrigin(value, allowLoopbackHttp) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Configure one exact trusted public origin."); }
  const localHttp = allowLoopbackHttp && url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port;
  if (typeof value !== "string" || value !== url.origin || url.username || url.password || !(url.protocol === "https:" || localHttp))
    throw new Error("Configure an exact HTTPS origin, or explicitly allow an isolated 127.0.0.1 HTTP origin with a port.");
  return url;
}

function requestUrl(request, publicUrl) {
  const raw = request.url;
  if (typeof raw !== "string" || raw.length > 24_000 || !raw.startsWith("/") || raw.startsWith("//") || /[\\#\x00-\x20\x7f]/.test(raw))
    fail(400, "Use an inventory path and query only.");
  const path = raw.split("?")[0];
  if (/%(?:2f|5c)/i.test(path)) fail(400, "Use an unambiguous inventory path.");
  const url = new URL(raw, publicUrl);
  if (url.origin !== publicUrl.origin || url.pathname !== path)
    fail(400, "Use an unambiguous inventory path.");
  return url;
}

function originPolicy(request, publicUrl, url) {
  for (const name of ["host", "origin", "cookie", "content-type", "content-length", "transfer-encoding", "sec-fetch-site"]) {
    if ((request.headersDistinct[name]?.length ?? 0) > 1)
      fail(403, "Ambiguous request headers are not allowed.");
  }
  if (request.headers.host !== publicUrl.host) fail(403, "This inventory host is not allowed.");
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== publicUrl.origin)
    fail(403, "Cross-origin requests are not allowed.");
  const fetchSite = request.headers["sec-fetch-site"];
  const documentEntry = request.method === "GET" && !url.pathname.startsWith("/api/") && url.pathname !== "/api"
    && origin === undefined && request.headers["sec-fetch-mode"] === "navigate" && request.headers["sec-fetch-dest"] === "document"
    && ["cross-site", "same-site"].includes(fetchSite);
  if (fetchSite !== undefined && !["same-origin", "none"].includes(fetchSite) && !documentEntry)
    fail(403, "Cross-origin browser requests are not allowed.");
  const browser = Object.keys(request.headers).some(name => name.startsWith("sec-fetch-"));
  if (origin === undefined && browser && (request.method === "POST" || fetchSite === undefined))
    fail(403, "A same-origin browser request is required.");
  // Native absence is not proof of an App. The unchanged Worker remains the
  // authority for account authentication, permissions and every business write.
}

function sessionCookie(request) {
  const raw = request.headers.cookie;
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length > 8192 || !/^[\x20-\x7e]*$/.test(raw))
    fail(400, "The inventory session cookie is invalid.");
  const sessions = raw.split(";").map(part => part.trim()).filter(part => part.split("=")[0] === "inventory_session");
  if (!sessions.length) return undefined;
  if (sessions.length !== 1 || !/^inventory_session=[a-f0-9]{64}$/.test(sessions[0]))
    fail(400, "Use one valid inventory session cookie.");
  return sessions[0];
}

function forwardedHeaders(request, body) {
  const connection = new Set(String(request.headers.connection ?? "").split(",").map(name => name.trim().toLowerCase()));
  const headers = new Headers();
  for (const name of requestHeaderNames) {
    if (connection.has(name) || name === "cookie") continue;
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  const cookie = sessionCookie(request);
  if (cookie && !connection.has("cookie")) headers.set("Cookie", cookie);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return headers;
}

async function boundedBody(request, limit, signal) {
  const declared = request.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit))
    fail(413, "The request exceeds this API's size limit. Nothing was forwarded.");
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      request.removeListener("data", data);
      request.removeListener("end", end);
      request.removeListener("error", broken);
      request.removeListener("aborted", interrupted);
      signal.removeEventListener("abort", interrupted);
    };
    const broken = error => { cleanup(); reject(error); };
    const interrupted = () => broken(new Error("The request was interrupted."));
    const data = chunk => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        cleanup();
        request.resume();
        reject(Object.assign(new Error("The request exceeds this API's size limit. Nothing was forwarded."), { gatewayStatus: 413 }));
      } else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    request.on("data", data);
    request.once("end", end);
    request.once("error", broken);
    request.once("aborted", interrupted);
    signal.addEventListener("abort", interrupted, { once: true });
    if (signal.aborted) interrupted();
  });
}

function jsonObject(bytes) {
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail(400, "The request is not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "Send a JSON object.");
}

function responseCookies(headers, secure) {
  const cookies = headers.getSetCookie();
  if (!cookies.length) return undefined;
  if (cookies.length !== 1) fail(503, unconfirmedMessage);
  const raw = cookies[0];
  if (raw.length > 512 || !/^[\x20-\x7e]+$/.test(raw)) fail(503, unconfirmedMessage);
  const parts = raw.split(";").map(part => part.trim());
  if (!parts[0].startsWith("inventory_session=")) fail(503, unconfirmedMessage);
  const token = parts[0].slice("inventory_session=".length), attributes = new Map();
  for (const part of parts.slice(1)) {
    const separator = part.indexOf("="), key = (separator < 0 ? part : part.slice(0, separator)).toLowerCase();
    const value = separator < 0 ? "" : part.slice(separator + 1);
    if (!key || attributes.has(key) || !["path", "httponly", "samesite", "max-age", "secure"].includes(key))
      fail(503, unconfirmedMessage);
    attributes.set(key, value);
  }
  const age = attributes.get("max-age");
  if (attributes.get("path") !== "/" || attributes.get("httponly") !== "" || attributes.get("samesite")?.toLowerCase() !== "strict"
      || !/^(?:0|[1-9]\d{0,4})$/.test(age ?? "") || Number(age) > 28_800
      || attributes.has("secure") && attributes.get("secure") !== "" || secure && !attributes.has("secure")
      || !(token === "" && Number(age) === 0 || /^[a-f0-9]{64}$/.test(token) && Number(age) > 0))
    fail(503, unconfirmedMessage);
  return [raw];
}

function webRedirect(response, request, url, publicUrl) {
  if (request.method !== "GET" && request.method !== "HEAD" || url.pathname.startsWith("/api/") || url.pathname === "/api")
    fail(503, unconfirmedMessage);
  const location = response.headers.get("location");
  if (!location || location.length > 2048 || /[\\\r\n\x00-\x20\x7f]/.test(location)) fail(503, unconfirmedMessage);
  let target;
  try { target = new URL(location, url); } catch { fail(503, unconfirmedMessage); }
  if (target.origin !== publicUrl.origin || target.username || target.password) fail(503, unconfirmedMessage);
  return target.href;
}

async function boundedResponse(response, limit, signal) {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) fail(503, unconfirmedMessage);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return Buffer.concat(chunks);
      size += value.byteLength;
      if (size > limit) fail(503, unconfirmedMessage);
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * A transport boundary around the accepted Worker, with no account or business
 * implementation. The caller owns listening/TLS, dispatchFetch and shutdown.
 * Public identity comes solely from publicOrigin, never forwarded headers.
 */
export function createInventoryHttpServer({
  publicOrigin, dispatchFetch, allowLoopbackHttp = false,
  requestTimeoutMs = 30_000, responseLimitBytes = 32 * 1024 * 1024,
} = {}) {
  const publicUrl = trustedOrigin(publicOrigin, allowLoopbackHttp);
  if (typeof dispatchFetch !== "function") throw new Error("Supply the owned Worker dispatchFetch function.");
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120_000
      || !Number.isInteger(responseLimitBytes) || responseLimitBytes < 1 || responseLimitBytes > 128 * 1024 * 1024)
    throw new Error("Use bounded gateway time and response limits.");
  const server = http.createServer({ maxHeaderSize: 16_384 }, async (request, response) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    timer.unref();
    const disconnected = () => { if (!response.writableFinished) controller.abort(); };
    response.once("close", disconnected);
    let upstreamResponse;
    try {
      const url = requestUrl(request, publicUrl);
      originPolicy(request, publicUrl, url);
      const isApi = url.pathname.startsWith("/api/") || url.pathname === "/api";
      if (privatePaths.has(url.pathname) || isApi && !apiRoutes.has(url.pathname)) fail(404, "Not found.");
      const allowed = apiRoutes.has(url.pathname)
        ? (postOnlyRoutes.has(url.pathname) ? ["POST"] : ["GET", "POST"])
        : ["GET", "HEAD"];
      if (!allowed.includes(request.method)) fail(405, "Method not allowed.");
      let body;
      if (request.method === "POST") {
        if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")
            || request.headers["content-encoding"] && request.headers["content-encoding"] !== "identity")
          fail(415, "Send changes as JSON.");
        body = await boundedBody(request, apiRoutes.get(url.pathname), controller.signal);
        jsonObject(body);
      } else if (request.headers["transfer-encoding"] || Number(request.headers["content-length"] ?? 0) !== 0) {
        fail(400, "Read requests cannot contain a body.");
      }
      const headers = forwardedHeaders(request, body);
      const dispatched = Promise.resolve(dispatchFetch(url.href, {
        method: request.method, headers, body, redirect: "manual", signal: controller.signal,
      }));
      // A runtime may finish after a transport timeout despite the AbortSignal.
      void dispatched.then(result => {
        if (controller.signal.aborted && result !== upstreamResponse) void result.body?.cancel().catch(() => {});
      }, () => {});
      const aborted = new Promise((_, reject) => {
        const stop = () => reject(new Error("The Worker request was interrupted."));
        controller.signal.addEventListener("abort", stop, { once: true });
        if (controller.signal.aborted) stop();
      });
      upstreamResponse = await Promise.race([dispatched, aborted]);
      // Miniflare owns its Fetch classes; they need not be Node's global class.
      if (!Number.isInteger(upstreamResponse?.status) || upstreamResponse.status < 200 || upstreamResponse.status > 599
          || typeof upstreamResponse.headers?.get !== "function" || typeof upstreamResponse.headers.getSetCookie !== "function")
        fail(503, unconfirmedMessage);
      const outgoing = { ...safeHeaders };
      if (upstreamResponse.status >= 300 && upstreamResponse.status < 400 && upstreamResponse.status !== 304)
        outgoing.Location = webRedirect(upstreamResponse, request, url, publicUrl);
      for (const name of responseHeaderNames) {
        const value = upstreamResponse.headers.get(name);
        if (value && (value.length > 8192 || /[\r\n]/.test(value))) fail(503, unconfirmedMessage);
        if (value) outgoing[name] = value;
      }
      const cookies = responseCookies(upstreamResponse.headers, publicUrl.protocol === "https:");
      if (cookies) outgoing["Set-Cookie"] = cookies;
      const bytes = request.method === "HEAD" ? Buffer.alloc(0)
        : await boundedResponse(upstreamResponse, responseLimitBytes, controller.signal);
      controller.signal.throwIfAborted();
      response.writeHead(upstreamResponse.status, outgoing);
      response.end(bytes);
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) response.destroy();
      else {
        if (controller.signal.aborted && !request.complete) response.setHeader("Connection", "close");
        reply(request, response, error.gatewayStatus ?? 503, error.gatewayStatus ? error.message : unconfirmedMessage);
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
      response.removeListener("close", disconnected);
      await upstreamResponse?.body?.cancel().catch(() => {});
    }
  });
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.min(requestTimeoutMs, 10_000);
  server.maxHeadersCount = 64;
  return server;
}
