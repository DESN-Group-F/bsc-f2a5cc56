# Battery Inventory Service

Native HTTPS transport for the bundled React/Capacitor application. It reuses the existing server's `inventory_session` cookie without making its value available to JavaScript. This plugin does not create accounts, bypass server authorization or establish hardware acceptance.

## Contract

```ts
await BatteryService.getConfiguration(); // { origin: string | null }
await BatteryService.configure({ origin: 'https://trusted-inventory.example' });
await BatteryService.request({
  path: '/api/inventory?dataset=demo',
  method: 'GET',
  headers: { accept: 'application/json' },
}); // { status, headers, body, encoding: 'utf8' | 'base64' }
await BatteryService.clearSession(); // explicit local credential reset only
await BatteryService.loadBusinessData(); // { data: string | null }
await BatteryService.saveBusinessData({ data: JSON.stringify(businessEnvelope) });
```

The origin is an exact HTTPS origin without credentials, a path, query or fragment. A sole trailing slash and default port 443 are normalized. The nonsecret origin survives application restart. Changing it while an unexpired native session exists is rejected. Configuration inspection does not open credential storage; it still works when credentials are inaccessible.

Only GET and POST to these exact paths are accepted: `/api/session`, `/api/inventory`, `/api/accounts`, `/api/battery-models`, `/api/teaching-groups`, `/api/task-plans`, `/api/messages` and `/api/export`. Query strings are retained; absolute URLs, authority replacements, fragments, encoded path aliases and unknown routes are rejected. Headers accept only case-insensitive `Content-Type` and `Accept`; credential, Origin and custom headers cannot be injected by JavaScript. Request bodies are JSON strings. GET bodies are rejected.

The server determines account, role and inventory authority on every request. No bearer authentication or CORS exception is introduced. The browser adapter explicitly reports native transport unavailable; a browser preview must use its own same-origin API integration.

## Credential handling

- iOS stores the opaque credential and origin binding in Keychain with `WhenUnlockedThisDeviceOnly` accessibility.
- Android encrypts the credential record with AES-GCM using a non-exportable Android Keystore key, storing only ciphertext and IV in private preferences. A restored ciphertext without its device key fails closed; it does not fall back to plaintext.
- The server still holds only the session token hash and enforces its normal account/revocation rules. Client expiry is capped at eight hours and does not extend server expiry.
- Each request adds the host-bound Cookie inside native code. Cookie jars and response caches are disabled; redirects are never followed. Responses expose only `content-type` and `content-disposition`, never Set-Cookie or the token.
- Session expiry, a clearing server cookie, a successful signout or HTTP 401 removes the local credential. A lost response preserves it so that an uncertain business request remains recoverable. No raw credentials or transport exceptions are logged.

`clearSession()` is an explicit local recovery mechanism for inaccessible/corrupt secure storage. It does **not** confirm server-side session revocation. Normal signout should call the server first. Before clearing credentials, changing accounts or origins, the application must retain any uncertain business request and earlier draft work. This plugin does not own the business outbox and cannot decide whether it is safe to discard it. No password is persisted; its necessary transient sign-in request remains in managed memory only.

## Bounds and errors

Requests are capped at 5,000 UTF-8 bytes for `/api/session`, 15,000 for `/api/export` and 250,000 for other endpoints. Responses are streamed with a 32 MiB complete-body bound. An oversized response is an explicit error, never a truncated success or partial export. UTF-8 text/JSON is returned as `utf8`; binary or invalid UTF-8 is returned byte-for-byte as base64.

GET/POST execution and configuration/session transitions are serialized in the native plugin. API error statuses still return their status/body, allowing the caller to apply the existing exact-request rejection/recovery rules. Transport interruptions use `NETWORK_UNCERTAIN`; an interrupted write is not proof of failure. Other explicit codes include `INVALID_ORIGIN`, `INVALID_PATH`, `INVALID_METHOD`, `INVALID_BODY`, `INVALID_HEADERS`, `REQUEST_TOO_LARGE`, `RESPONSE_TOO_LARGE`, `REDIRECT_DENIED`, `SESSION_EXISTS`, `SESSION_ORIGIN_MISMATCH`, `SESSION_COOKIE_INVALID` and `SECURE_STORAGE`.

The native HTTPS endpoint must be independently configured and reachable. The LAN HTTP diagnostic gateway is not a native App backend. This source does not deploy a backend or select a production endpoint.

## Durable business recovery

Business data uses a separate fixed private file per configured HTTPS origin, or the `unconfigured` scope before setup. The filename contains only an internal SHA-256 scope hash. JavaScript supplies a complete UTF-8 string; it cannot select paths or delete files. Changing origin leaves older scoped files intact. Clearing a session never clears business recovery data. Business records are distinct from the encrypted credential vault and must never contain session tokens or passwords.

`saveBusinessData({data})` uses Foundation atomic replacement with `completeUntilFirstUserAuthentication` protection on iOS, and `android.util.AtomicFile` start/finish/fail transactions in Android private files. No committed target is removed before writing its replacement. Android synchronizes the write before commit; both platforms read back the complete committed value before acknowledging the save. A caller must wait for this acknowledgement before sending a captured mutation. Native access is serialized with service configuration changes.

Both read and write have a 16 MiB UTF-8 bound. Oversized or malformed data reports `BUSINESS_DATA_TOO_LARGE` / `BUSINESS_DATA_CORRUPT` without truncation or deletion. Non-string or invalid-Unicode save input reports `INVALID_BUSINESS_DATA`. Only a missing file returns `{data:null}`; other read/write errors report `BUSINESS_STORAGE` and preserve files for explicit recovery. A failed confirmation can leave either the previous complete envelope or a newly committed complete envelope; the caller must preserve its in-memory captured work and must not send a new mutation until storage recovery succeeds. The JavaScript envelope parser still owns account/scope/schema verification and may not silently replace a corrupt envelope.

The platform API contracts are documented by [Apple data protection](https://developer.apple.com/documentation/foundation/nsdata/writingoptions/completefileprotectionuntilfirstuserauthentication) and [Android AtomicFile](https://developer.android.com/reference/android/util/AtomicFile). Actual device storage and termination acceptance remain pending.

## Local validation

```powershell
node --test mobile/plugins/battery-service/tests/*.test.mjs
```

Run from the application project root. On 5 October 2026, three suites passed: 95 assertions against the production Java policy, controlled assertions against the production Java bridge/business store using SDK/HTTP/vault/AtomicFile doubles, and browser unavailability checks. The controlled suite exercises exact Unicode envelopes, origin scope separation, invalid/oversized data, write rollback, failed replacement, preserved read corruption, session reset without draft deletion, request isolation and complete response handling. See its test output for the current assertion count. These checks do not verify actual Android TLS, encrypted storage, atomic filesystem implementation, the Android SDK or a device. A JDK is required for controlled Java execution; unavailable JDK checks report a skip.

iOS Swift/Keychain compilation, Android SDK/Gradle linkage, signing, installation, secure-store restart/key-loss behavior on devices and real backend TLS sign-in remain separately unverified until their SDK/device checks run. JavaScript/web packaging is also an application integration checkpoint, not a native acceptance result. The app should preserve business work before every potentially uncertain mutation.

Android uses pinned OkHttp 4.12.0 to avoid the process-global CookieHandler used by URL connections; it explicitly sets `CookieJar.NO_COOKIES`, no cache, no redirect and no implicit connection retry. Dependency copyright/license references are in [Third-party notices](THIRD_PARTY_NOTICES.md).
