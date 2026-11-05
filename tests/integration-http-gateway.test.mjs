import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createInventoryHttpServer, embeddingHosts } from "../deploy/integration/http-gateway.mjs";

const publicOrigin = "https://inventory.example.invalid";
const token = "a".repeat(64);
const signin = { action: "signin", payload: { username: "fictional-staff", password: "fictional-test-password" } };
const framePolicy = "frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft";
const noFraming = "frame-ancestors 'none'";

async function fixture(t, options = {}) {
  const requests = [];
  const server = createInventoryHttpServer({
    publicOrigin,
    dispatchFetch: async (url, init) => {
      requests.push({ url, ...init, headers: Object.fromEntries(init.headers) });
      return options.result?.(url, init) ?? Response.json({ ok: true });
    },
    ...options.gateway,
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  const request = ({ method = "GET", path = "/api/session", headers = {}, body, chunks, omitEnd = false, rawHeaders } = {}) => new Promise((resolve, reject) => {
    let socketPort;
    const client = http.request({
      hostname: "127.0.0.1", port: server.address().port, method, path,
      agent, headers: rawHeaders ?? { Host: new URL(options.gateway?.publicOrigin ?? publicOrigin).host, ...headers },
    }, response => {
      const bytes = [];
      response.on("data", chunk => bytes.push(chunk));
      response.once("error", reject);
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(bytes).toString("utf8"), socketPort }));
    });
    client.on("socket", socket => {
      if (socket.connecting) socket.once("connect", () => { socketPort = socket.localPort; });
      else socketPort = socket.localPort;
    });
    client.once("error", reject);
    if (chunks) for (const chunk of chunks) client.write(chunk);
    if (!omitEnd) client.end(body);
  });
  const post = (headers = {}, body = JSON.stringify(signin), path = "/api/session") => request({
    method: "POST", path, headers: { "Content-Type": "application/json", Accept: "application/json", ...headers }, body,
  });
  return { request, post, requests };
}

test("public identity requires exact HTTPS, with explicit isolated loopback HTTP exception", () => {
  const dispatchFetch = async () => Response.json({});
  for (const publicOrigin of [undefined, "https://inventory.invalid/", "https://inventory.invalid/path", "https://u:p@inventory.invalid", "http://inventory.invalid", "http://127.0.0.1:50000"]) {
    assert.throws(() => createInventoryHttpServer({ publicOrigin, dispatchFetch }));
  }
  assert.throws(() => createInventoryHttpServer({ publicOrigin: "http://localhost:50000", dispatchFetch, allowLoopbackHttp: true }));
  assert.throws(() => createInventoryHttpServer({ publicOrigin: "http://127.0.0.1", dispatchFetch, allowLoopbackHttp: true }));
  createInventoryHttpServer({ publicOrigin: "http://127.0.0.1:50000", dispatchFetch, allowLoopbackHttp: true }).close();
});

test("native signin reaches the canonical Worker without Origin or browser metadata", async t => {
  const { post, requests } = await fixture(t);
  assert.equal((await post()).status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, publicOrigin + "/api/session");
  assert.equal(requests[0].redirect, "manual");
  assert.equal(requests[0].headers.origin, undefined);
  assert.deepEqual(JSON.parse(requests[0].body.toString("utf8")), signin);
  assert.equal(requests[0].headers["content-type"], "application/json");
});

test("same-origin browser writes and ordinary Origin-less browser reads are supported", async t => {
  const { post, request, requests } = await fixture(t);
  assert.equal((await post({ Origin: publicOrigin, "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors" })).status, 200);
  assert.equal((await request({ headers: { "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors" } })).status, 200);
  assert.equal((await request({ path: "/", headers: { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate" } })).status, 200);
  assert.equal(requests[0].headers.origin, publicOrigin);
  assert.equal(requests.length, 3);
});

test("browser metadata without write Origin and cross-site requests never dispatch", async t => {
  const { post, request, requests } = await fixture(t);
  for (const headers of [
    { "Sec-Fetch-Site": "same-origin" },
    { "Sec-Fetch-Mode": "cors" },
    { Origin: publicOrigin, "Sec-Fetch-Site": "cross-site" },
    { Origin: publicOrigin, "Sec-Fetch-Site": "same-site" },
  ]) assert.equal((await post(headers)).status, 403);
  assert.equal((await request({ headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await request({ headers: { "Sec-Fetch-Mode": "cors" } })).status, 403);
  assert.equal(requests.length, 0);
});

test("foreign, null, duplicate and ambiguous public origin or host are denied", async t => {
  const { post, request, requests } = await fixture(t);
  for (const origin of ["null", "https://foreign.invalid", "https://inventory.example.invalid/", `${publicOrigin}, ${publicOrigin}`, [publicOrigin, publicOrigin]])
    assert.equal((await post({ Origin: origin })).status, 403);
  assert.equal((await post({ Host: "foreign.invalid" })).status, 403);
  assert.equal((await request({ rawHeaders: ["Host", "inventory.example.invalid", "Host", "inventory.example.invalid"] })).status, 403);
  assert.equal(requests.length, 0);
});

test("unsupported API methods, unknown routes and private runtime files never dispatch", async t => {
  const { request, post, requests } = await fixture(t);
  for (const path of ["/api/unknown", "/api", "/bootstrap.json", "/deployment.json", "/runtime.mjs"])
    assert.equal((await request({ path })).status, 404);
  for (const method of ["DELETE", "PUT", "OPTIONS"])
    assert.equal((await request({ method })).status, 405);
  assert.equal((await post({}, "{}", "/")).status, 405);
  assert.equal((await request({ path: "/api/location-observations" })).status, 405);
  assert.equal(requests.length, 0);
});

test("absolute, normalized and encoded ambiguous paths are denied", async t => {
  const { request, requests } = await fixture(t);
  for (const path of [publicOrigin + "/api/session", "//inventory.example.invalid/api/session", "/api/../api/session", "/api/%2e%2e/api/session", "/api%2fsession", "/api%5csession", "/api/session#fragment"])
    assert.equal((await request({ path })).status, 400, path);
  assert.equal(requests.length, 0);
});

test("JSON media type, object shape, valid UTF-8 and read-body boundaries precede dispatch", async t => {
  const { post, request, requests } = await fixture(t);
  for (const contentType of ["text/plain", "application/jsonp", "application/json; charset=utf-16"])
    assert.equal((await post({ "Content-Type": contentType })).status, 415);
  assert.equal((await post({ "Content-Encoding": "gzip" })).status, 415);
  for (const body of ["{", "null", "[]", "true", Buffer.from([0x7b, 0xc3, 0x28, 0x7d])])
    assert.equal((await post({}, body)).status, 400);
  assert.equal((await request({ headers: { "Content-Length": "2" }, body: "{}" })).status, 400);
  assert.equal(requests.length, 0);
  assert.equal((await post({ "Content-Type": "application/json; charset=utf-8" })).status, 200);
});

test("declared and chunked bodies cannot exceed accepted per-route limits", async t => {
  const { post, request, requests } = await fixture(t);
  assert.equal((await post({}, JSON.stringify({ padding: "x".repeat(5000) }))).status, 413);
  assert.equal((await request({ method: "POST", headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" }, chunks: ["{\"padding\":\"", "x".repeat(5000), "\"}"] })).status, 413);
  assert.equal((await post({}, JSON.stringify({ padding: "x".repeat(15000) }), "/api/export")).status, 413);
  assert.equal(requests.length, 0);
  assert.equal((await post({}, JSON.stringify({ padding: "x".repeat(5000) }), "/api/inventory")).status, 200);
});

test("authentication stays with the Worker and only a valid session cookie is forwarded", async t => {
  const { post, request, requests } = await fixture(t, { result: () => Response.json({ error: "Sign in with an active staff account." }, { status: 401 }) });
  const denied = await post();
  assert.equal(denied.status, 401);
  assert.match(denied.text, /active staff/);
  assert.equal((await post({ Cookie: `unrelated=value; inventory_session=${token}; another=ignored` })).status, 401);
  assert.equal(requests[1].headers.cookie, `inventory_session=${token}`);
  for (const cookie of [`inventory_session=${token}; inventory_session=${token}`, "inventory_session=bad"])
    assert.equal((await post({ Cookie: cookie })).status, 400);
  assert.equal((await request({ rawHeaders: ["Host", "inventory.example.invalid", "Cookie", `inventory_session=${token}`, "Cookie", `inventory_session=${token}`] })).status, 403);
  assert.equal(requests.length, 2);
});

test("spoofed protocol, provider auth and hop headers cannot reach the Worker", async t => {
  const { post, requests } = await fixture(t);
  assert.equal((await post({
    Cookie: `inventory_session=${token}`, Origin: publicOrigin,
    Authorization: "Bearer fictional", Forwarded: "proto=http;host=foreign.invalid",
    "X-Forwarded-Proto": "http", "X-Forwarded-Host": "foreign.invalid",
    "Cf-Access-Jwt-Assertion": "fictional", "Oai-Authenticated-User-Id": "fictional",
    "X-Miniflare-Secret": "fictional", "X-Vinext-Prerender": "fictional",
    Connection: "keep-alive, X-Test-Hop, Cookie", "X-Test-Hop": "fictional",
  })).status, 200);
  assert.equal(requests[0].url, publicOrigin + "/api/session");
  assert.deepEqual(requests[0].headers, { accept: "application/json", "content-type": "application/json", origin: publicOrigin });
});

test("all accepted APIs preserve query, dataset, action and business payload", async t => {
  const { post, request, requests } = await fixture(t);
  const command = { dataset: "live", action: "movement", payload: { requestId: "fictional-request", batteryIds: ["BAT-001"], mode: "checkout" } };
  assert.equal((await post({}, JSON.stringify(command), "/api/inventory")).status, 200);
  assert.deepEqual(JSON.parse(requests[0].body.toString()), command);
  for (const path of ["battery-models", "teaching-groups", "teaching-checkouts", "task-plans", "messages", "locations", "accounts", "export"])
    assert.equal((await request({ path: `/api/${path}?dataset=live&scope=selected` })).status, 200);
  assert.equal(requests.at(-1).url, publicOrigin + "/api/export?dataset=live&scope=selected");
});

test("static GET and HEAD retain useful web headers without cross-origin or hop response headers", async t => {
  const { request, requests } = await fixture(t, { result: () => new Response("script bytes", { headers: {
    "Content-Type": "text/javascript", "Content-Encoding": "gzip", "Content-Length": "12",
    "Access-Control-Allow-Origin": "*", "X-Forwarded-Proto": "http", "Content-Security-Policy": "default-src 'self'",
  } }) });
  const response = await request({ path: "/assets/app.js", headers: { Accept: "*/*", "If-None-Match": "asset-version" } });
  assert.equal(response.status, 200);
  assert.equal(response.text, "script bytes");
  assert.equal(response.headers["content-type"], "text/javascript");
  assert.equal(response.headers["content-encoding"], undefined);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.headers["x-forwarded-proto"], undefined);
  assert.equal(response.headers["cache-control"], "no-store");
  // The Worker's policy is kept and the gateway's frame-ancestors policy is added; browsers enforce both.
  assert.equal(response.headers["content-security-policy"], "default-src 'self', " + noFraming);
  assert.equal(response.headers["x-frame-options"], undefined);
  assert.equal(requests[0].headers["if-none-match"], "asset-version");
  assert.equal((await request({ method: "HEAD", path: "/assets/app.js" })).text, "");
});

test("valid signin and signout session cookies remain host-only HttpOnly Strict and Secure on HTTPS", async t => {
  let clearing = false;
  const { post } = await fixture(t, { result: () => Response.json({ ok: true }, { headers: {
    "Set-Cookie": `inventory_session=${clearing ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clearing ? 0 : 28800}; Secure`,
  } }) });
  const signin = await post();
  assert.deepEqual(signin.headers["set-cookie"], [`inventory_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure`]);
  clearing = true;
  assert.deepEqual((await post()).headers["set-cookie"], ["inventory_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure"]);
});

test("explicit loopback HTTP does not invent a Secure cookie", async t => {
  const { post } = await fixture(t, {
    gateway: { publicOrigin: "http://127.0.0.1:50000", allowLoopbackHttp: true },
    result: () => Response.json({}, { headers: { "Set-Cookie": `inventory_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800` } }),
  });
  assert.equal((await post()).headers["set-cookie"][0].includes("Secure"), false);
});

test("conflicting or weakened response cookies fail closed", async t => {
  let cookie;
  const { post } = await fixture(t, { result: () => {
    const headers = new Headers();
    for (const value of Array.isArray(cookie) ? cookie : [cookie]) headers.append("Set-Cookie", value);
    return Response.json({}, { headers });
  } });
  const valid = `inventory_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure`;
  for (cookie of [
    [valid, valid], valid + "; Domain=inventory.example.invalid", valid.replace("; HttpOnly", ""),
    valid.replace("Strict", "Lax"), valid.replace("28800", "28801"), valid + "; Path=/", valid.replace(token, "bad"),
    valid.replace("inventory_session", "unexpected_cookie"),
    valid.replace("; Secure", ""),
  ]) {
    const result = await post();
    assert.equal(result.status, 503);
    assert.equal(result.headers["set-cookie"], undefined);
  }
});

test("redirects are never relayed and unexpected exceptions disclose no upstream detail", async t => {
  let result = () => new Response(null, { status: 302, headers: { Location: "https://foreign.invalid/", "Set-Cookie": `inventory_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800` } });
  const { post, requests } = await fixture(t, { result: (...args) => result(...args) });
  const redirect = await post();
  assert.equal(redirect.status, 503);
  assert.equal(redirect.headers.location, undefined);
  assert.equal(redirect.headers["set-cookie"], undefined);
  result = () => { throw new Error("private upstream credential details"); };
  const failed = await post();
  assert.equal(failed.status, 503);
  assert.match(failed.text, /exact captured request/);
  assert.doesNotMatch(failed.text, /private upstream/);
  assert.equal(requests.length, 2);
});

test("response stream and declared sizes are bounded before sending headers or cookies", async t => {
  let oversized = true;
  const { post } = await fixture(t, { gateway: { responseLimitBytes: 16 }, result: () => new Response("x".repeat(oversized ? 17 : 2), {
    headers: oversized ? {} : { "Content-Length": "17" },
  }) });
  assert.equal((await post()).status, 503);
  oversized = false;
  assert.equal((await post()).status, 503);
});

test("bounded dispatch timeout remains safe even if the Worker ignores cancellation", async t => {
  const { post } = await fixture(t, { gateway: { requestTimeoutMs: 50 }, result: () => new Promise(() => {}) });
  const result = await post();
  assert.equal(result.status, 503);
  assert.match(result.text, /exact captured request/);
});

test("external top-level document entry preserves normal web navigation, without API cross-site access", async t => {
  const { request, requests } = await fixture(t, { result: () => new Response(null, { status: 302, headers: { Location: "/signin" } }) });
  const headers = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" };
  const entry = await request({ path: "/", headers });
  assert.equal(entry.status, 302);
  assert.equal(entry.headers.location, publicOrigin + "/signin");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].redirect, "manual");
  assert.equal((await request({ headers })).status, 403);
  assert.equal((await request({ path: "/assets/app.js", headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "script" } })).status, 403);
  assert.equal(requests.length, 1);
});

test("foreign or malformed web navigation redirects fail closed", async t => {
  let location;
  const { request } = await fixture(t, { result: () => new Response(null, { status: 302, headers: { Location: location } }) });
  for (location of ["https://foreign.invalid/signin", "//foreign.invalid/signin", "https://u:p@inventory.example.invalid/signin", "javascript:alert(1)", "/sign in"]) {
    const response = await request({ path: "/" });
    assert.equal(response.status, 503);
    assert.equal(response.headers.location, undefined);
  }
});

test("a rejected declared body is drained and the same connection remains usable", async t => {
  const { post, requests } = await fixture(t);
  const denied = await post({ "Content-Length": "5002" }, "x".repeat(5002));
  assert.equal(denied.status, 413);
  const accepted = await post();
  assert.equal(accepted.status, 200);
  assert.equal(accepted.socketPort, denied.socketPort);
  assert.equal(requests.length, 1);
});

test("an unfinished request body and a stalled response stream are bounded", async t => {
  const { request, post, requests } = await fixture(t, { gateway: { requestTimeoutMs: 50 }, result: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("partial")); } })) });
  const unfinished = await request({ method: "POST", headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" }, chunks: ["{\"action\":"], omitEnd: true });
  assert.equal(unfinished.status, 503);
  assert.equal(requests.length, 0);
  const response = await post();
  assert.equal(response.status, 503);
  assert.equal(requests.length, 1);
});

test("only the console and its sign-in page may be framed, only by Microsoft Teams hosts; everything else forbids framing", async t => {
  assert.deepEqual([...embeddingHosts], ["https://teams.microsoft.com", "https://*.teams.microsoft.com", "https://*.cloud.microsoft"]);
  const { request, post } = await fixture(t, { result: () => new Response("<!doctype html><title>Page</title>", { headers: { "Content-Type": "text/html" } }) });
  for (const response of [await request({ path: "/console" }), await request({ path: "/console?area=batteries" }), await request({ path: "/signin?return_to=%2Fconsole" }), await request({ path: "/console", headers: { Origin: "https://foreign.invalid" } })]) {
    assert.equal(response.headers["content-security-policy"], framePolicy);
    assert.equal(response.headers["x-frame-options"], undefined);
  }
  for (const response of [await request({ path: "/" }), await request({ path: "/assets/app.js" }), await post(), await request({ path: "/api/unknown" }), await request({ path: "/", headers: { Origin: "https://foreign.invalid" } }), await request({ path: "//foreign.invalid/console" })]) {
    assert.equal(response.headers["content-security-policy"], noFraming);
    assert.equal(response.headers["x-frame-options"], undefined);
  }
  const dispatchFetch = async () => Response.json({});
  for (const frameAncestors of [["*"], ["https://*"], ["http://teams.microsoft.com"], ["https://teams.microsoft.com/path"], ["https://a.*.example.invalid"], ["https://teams.microsoft.com 'unsafe-inline'"], ["http://127.0.0.1:5191"], "https://teams.microsoft.com", Array(17).fill("https://a.example.invalid")]) {
    assert.throws(() => createInventoryHttpServer({ publicOrigin, dispatchFetch, frameAncestors }));
  }
  createInventoryHttpServer({ publicOrigin: "http://127.0.0.1:50000", dispatchFetch, allowLoopbackHttp: true, frameAncestors: ["http://localhost:5191"] }).close();
});

test("a Teams tab may load the console or its sign-in page in a cross-site frame; nothing else enters a frame", async t => {
  const { request, post, requests } = await fixture(t, { result: () => new Response(null, { status: 307, headers: { Location: "/signin?return_to=%2Fconsole" } }) });
  const frame = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe" };
  const entry = await request({ path: "/console", headers: frame });
  assert.equal(entry.status, 307);
  assert.equal(entry.headers.location, publicOrigin + "/signin?return_to=%2Fconsole");
  assert.equal((await request({ path: "/signin?return_to=%2Fconsole", headers: frame })).status, 307);
  assert.equal(requests.length, 2);
  for (const path of ["/", "/console/extra", "/consoles"]) assert.equal((await request({ path, headers: frame })).status, 403);
  assert.equal((await request({ path: "/console", headers: { ...frame, "Sec-Fetch-Site": "same-site" } })).status, 403);
  assert.equal((await request({ headers: frame })).status, 403);
  assert.equal((await request({ path: "/assets/app.js", headers: { ...frame, "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "script" } })).status, 403);
  assert.equal((await request({ path: "/console", headers: { ...frame, "Sec-Fetch-Dest": "embed" } })).status, 403);
  assert.equal((await request({ path: "/console", headers: { ...frame, Origin: "https://teams.microsoft.com" } })).status, 403);
  assert.equal((await post({ "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty", Origin: "https://teams.microsoft.com" })).status, 403);
  assert.equal(requests.length, 2);
});

test("the embedded session cookie is accepted only as SameSite=None, Secure and Partitioned", async t => {
  let cookie;
  const { post } = await fixture(t, { result: () => Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } }) });
  const embedded = `inventory_session=${token}; Path=/; HttpOnly; SameSite=None; Max-Age=28800; Secure; Partitioned`;
  for (cookie of [embedded, "inventory_session=; Path=/; HttpOnly; SameSite=None; Max-Age=0; Secure; Partitioned"]) {
    assert.deepEqual((await post()).headers["set-cookie"], [cookie]);
  }
  for (cookie of [
    embedded.replace("; Partitioned", ""), embedded.replace("; Secure", ""), embedded.replace("None", "Lax"),
    embedded.replace("None", "Strict"), embedded.replace("; Partitioned", "; Partitioned=1"), embedded + "; Partitioned",
    embedded.replace("; HttpOnly", ""), embedded + "; Domain=inventory.example.invalid",
  ]) {
    const result = await post();
    assert.equal(result.status, 503, cookie);
    assert.equal(result.headers["set-cookie"], undefined);
  }
});

test("an embedded session cookie keeps Secure on loopback HTTP, where the ordinary one does not", async t => {
  const embedded = `inventory_session=${token}; Path=/; HttpOnly; SameSite=None; Max-Age=28800; Secure; Partitioned`;
  const { post, request } = await fixture(t, {
    gateway: { publicOrigin: "http://127.0.0.1:50000", allowLoopbackHttp: true, frameAncestors: ["http://localhost:5191"] },
    result: () => Response.json({}, { headers: { "Set-Cookie": embedded } }),
  });
  const result = await post();
  assert.deepEqual(result.headers["set-cookie"], [embedded]);
  assert.equal(result.headers["content-security-policy"], noFraming);
  assert.equal((await request({ path: "/console" })).headers["content-security-policy"], "frame-ancestors http://localhost:5191");
});
