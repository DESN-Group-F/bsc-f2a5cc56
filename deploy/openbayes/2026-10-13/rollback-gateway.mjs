const message = "Maintenance rollback is active. Existing records and complete JSON evidence remain available. Business changes are disabled; preserve any unresolved request for recovery after the current release is restored.";
const readRoutes = new Set(["/api/session", "/api/accounts", "/api/inventory", "/api/battery-models", "/api/teaching-groups", "/api/locations"]);
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Battery Inventory maintenance</title><body><main><h1>Battery Inventory maintenance</h1><p>${message}</p><p>The previous application reads the current database. Earlier database copies are retained as backups and are not used as current stock.</p><p>Native staff credentials and existing sessions remain valid. Sign-in and sign-out use the existing session API. The earlier interface and human export formats are withheld because their native evidence labels and original-request handling were not qualified for this rollback.</p><p><a href="/api/inventory?dataset=live">Working inventory JSON</a> · <a href="/api/inventory?dataset=demo">Demonstration inventory JSON</a> · <a href="/api/session">Session status</a></p></main></body></html>`;

/** Disable business mutations without replacing the authoritative database or normal account rules. */
export function maintenanceRollbackDispatch(dispatchFetch) {
  return async (url, init) => {
    const target = new URL(url), method = init.method ?? "GET", read = method === "GET" || method === "HEAD";
    if (read && target.pathname === "/") return new Response(method === "HEAD" ? null : html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (read && readRoutes.has(target.pathname)) return dispatchFetch(url, init);
    const jsonExport = target.pathname === "/api/export" && (!target.searchParams.has("format") && method === "POST" || target.searchParams.get("format") === "json" && ["GET", "POST"].includes(method));
    const teachingJson = target.pathname === "/api/teaching-checkouts" && read && (!target.searchParams.has("format") || target.searchParams.get("format") === "json");
    if (jsonExport || teachingJson) return dispatchFetch(url, init);
    if (method === "POST" && target.pathname === "/api/session") {
      let action;
      try { action = JSON.parse(Buffer.from(init.body ?? "").toString("utf8")).action; } catch {}
      if (action === "signin" || action === "signout") return dispatchFetch(url, init);
    }
    return Response.json({ error: message, code: "maintenance_read_only" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  };
}
