# Battery Inventory — API contract for a native SwiftUI iOS client

> **Update, 5 November 2026: native NFC works in both inventories.** The owner confirmed that NFC is the project's core input for real stock; "NFC is a demonstration feature" was a relay error (only scan-zone location tracking was cut). Since the release that carries this note, `capabilities.nativeNfc` reports `enabledDatasets:["demo","live"]` and `live` accepts `source:"native_nfc"` for `scan_lookup`, `movement`, teaching checkouts, `lifecycle` and `intake`, with the same evidence rules and receipts as Demonstration. Still Demonstration-only: `simulated` sources, simulated intake, `mobile_register`, room observations and location capture. Clients read the capability instead of hard-coding a dataset. The demo-only statements below are kept as the 3 November analysis and are superseded where they say otherwise. See `docs/working-inventory-nfc.md`.

Source analysed: `/home/claude/src` (server 1.0.0, vinext 1.0.0-beta.5, zod ^3.25.76). The paths and line ranges cited below are relative to that root. Server validation uses zod, and every write path has been read. **UNCERTAIN** marks anything not settled by the source.

---

## 0. Conventions that apply to every endpoint

| Topic | Rule | Source |
|---|---|---|
| Transport | HTTPS JSON. Only `GET` and `POST` exist. There are no path parameters: everything goes in the query string or the JSON body. | `app/api/*/route.ts` |
| Success envelope | **GET** returns the object directly. **POST** returns `{"ok": true, "result": <receipt>}`. Two exceptions: `/api/session` POST returns `{user}` or `{ok:true}`, and `/api/export` returns an attachment. | `app/api/inventory/route.ts:161` |
| Error envelope | `{"error": string, "code"?: string}`, sent with the DomainError's HTTP status. A zod validation failure returns **400** with `error = "path.to.field: message; …"` and **no `code`**. Any unexpected server error returns **503** with a generic "Your input has been preserved; please try again" message, which for a write means the outcome is uncertain. | `lib/api.ts:20-45` |
| Response headers | `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. | `lib/api.ts:6-19` |
| POST body checks (`requestJson`) | In this order: **(1)** if an `Origin` header is present, it must equal `new URL(request.url).origin`, otherwise **403** "Cross-origin changes are not allowed.". A missing `Origin` is accepted. **(2)** `Content-Type` must *start with* the case-sensitive string `application/json`, otherwise **415**. **(3)** The size check counts `text.length` (UTF-16 code units) against the endpoint's max, otherwise **413**. **(4)** Unparseable JSON returns **400**. These checks run **before** authentication, so an unauthenticated POST with a bad Content-Type gets 415, not 401. | `lib/api.ts:69-90` |
| Auth | Every route except `/api/session` calls `requestUser()`. It reads the `inventory_session` cookie and returns **401** "Sign in with an active staff account." when the session is missing, expired, revoked or disabled. | `lib/api.ts:91-98` |
| Dataset | `demo` = **Demonstration**, `live` = **Working**. Most endpoints silently default to `demo` when the field is omitted. Always send it explicitly (see §2). | `lib/domain.ts:6` |
| IDs | Battery and directory `identifier`: 1–64 chars, `^[A-Za-z0-9][A-Za-z0-9._-]*$`. New batteries get server-assigned IDs of the form `BAT-00000001`. `requestId`, `sessionId`, group and run IDs are UUIDs (zod accepts either case). | `lib/domain.ts:10`, `lib/intake-store.ts:59,468` |
| Timestamps | `z.string().datetime({offset:true})`: ISO-8601 with `Z` or a `±hh:mm` offset. Server timestamps are `toISOString()` UTC with milliseconds. Calendar dates are `YYYY-MM-DD` (validated by `isDateOnly`). | `lib/battery-age.ts:4-9` |
| Request IDs | Every exactly-once write carries a client-generated `requestId` (UUID). The server stores `operations(id = "<scope>/<requestId>")` together with a **fingerprint** of the canonical payload. See §R for the retry rules. | `lib/server/inventory/transactions.ts:33-87` |

### Body-size limits enforced by the server (`requestJson` max)

| Endpoint | Max chars | Source |
|---|---|---|
| `POST /api/session` | 5,000 | `app/api/session/route.ts:18` |
| `POST /api/accounts` | 10,000 | `app/api/accounts/route.ts:27` |
| `POST /api/locations`, `POST /api/location-observations` | 20,000 | `app/api/locations/route.ts:22`, `location-observations/route.ts:13` |
| `POST /api/export` | 262,144 | `app/api/export/route.ts:38` |
| `GET /api/export?request=<json>` | `request` param ≤ **15,000** chars | `app/api/export/route.ts:27` |
| `POST /api/inventory`, `/api/battery-models`, `/api/messages`, `/api/task-plans`, `/api/teaching-groups`, `/api/teaching-checkouts` | 250,000 | `lib/api.ts:71`, `app/api/inventory/route.ts:67-71` |

The existing native plugin applies stricter limits of its own, counted in **UTF-8 bytes**: 5,000 for `/api/session`, **15,000 for `/api/export`** and 250,000 for everything else. It also caps the URL path at 24,000 chars and the response at 32 MiB (`mobile/plugins/battery-service/ios/Sources/BatteryServicePlugin/ServicePolicy.swift:11,40,51`). The 15,000 figure for `/api/export` is a **client policy** that mirrors the GET `request` limit. The server itself accepts 262,144 on POST.

---

## 1. Authentication

### 1.1 Session cookie

* **Name:** `inventory_session`. **Value:** 64 lowercase hex characters, 32 random bytes (`lib/credentials.ts:3,8,26-31`).
* **Set-Cookie (sign-in):** `inventory_session=<token>; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800` plus `; Secure`, but **only when the request URL the Worker sees is `https:`** (`lib/credentials.ts:23-25`, `app/api/session/route.ts:19,30`).
* **Clear (sign-out):** `inventory_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0[; Secure]`.
* **Lifetime:** a fixed 8 h from sign-in (`SESSION_SECONDS`). Activity does not extend it. Only the SHA-256 of the token is stored server-side, in `staff_sessions` (`lib/accounts.ts:26-30,73-77`).
* **Server parsing:** the `Cookie` header must contain **exactly one** `inventory_session=` pair, and it must match `^[a-f0-9]{64}$`. Otherwise the request is treated as unauthenticated (`lib/credentials.ts:26-31`).
* **Revocation:** a session dies when it expires, when the account is disabled, or when `auth_version` changes. Role change, active flag change, admin password reset and self password change all bump `auth_version` and delete the account's sessions. Every guarded write also re-checks `auth_version` inside its D1 batch (`lib/accounts.ts:26-30,93-117`).
* **No bearer token and no CSRF token exist.** The only CSRF defence is the Origin check plus `SameSite=Strict`.

### 1.2 Endpoints

| Method / Path | Body / Query | Response | Status codes |
|---|---|---|---|
| `GET /api/session` | none (cookie optional) | `{ user: StaffUser \| null, setupRequired: boolean }` | 200 even when not signed in (`user:null`). This is the **session check**. `app/api/session/route.ts:9-14` |
| `POST /api/session` sign-in | `{ "action":"signin", "payload": { "username": string, "password": string } }`. Username: trimmed, lowercased, 2–64 chars, `^[a-z0-9][a-z0-9._-]+$`. Password: 1–128 chars. | `{ user: StaffUser }` + `Set-Cookie` | 401 wrong credentials or disabled account. **429** after 10 failures per username within 15 min. 400 zod error. `lib/accounts.ts:62-81` |
| `POST /api/session` sign-out | `{ "action":"signout" }` | `{ ok: true }` + clearing `Set-Cookie`. Deletes the server session row. | 200 even without a valid cookie. `route.ts:20-23` |
| `POST /api/session` setup | `{ action:"setup", setupKey, payload: accountInput }` | First-admin bootstrap only. Not needed on iOS. | 403 |
| `GET /api/accounts?scope=self` | none | `{ user: StaffUser, capabilities: { passwordVersionGuard: 1 } }` | 401. `app/api/accounts/route.ts:22` |
| `POST /api/accounts` | `{ action:"profile", payload:{ id, expectedVersion, displayName, email, defaultDataset } }` or `{ action:"password", payload:{ currentPassword, newPassword (12–128), expectedVersion? } }` | `{ ok, result }`. A password change returns `{signInRequired:true}` and revokes **all** sessions. | 409 `record_conflict`, 400. `lib/accounts.ts:85-117` |

`StaffUser` = `{ id: uuid, username, displayName, email, role: "admin"|"staff", active: bool, version: int, authVersion: int, defaultDataset: "demo"|"live", createdAt, updatedAt }` (`lib/accounts.ts:6`).

### 1.3 Required headers for a native client

* **POST:** `Content-Type: application/json` (with or without `; charset=utf-8`).
* **Cookie:** `Cookie: inventory_session=<token>`, sent manually.
* **No custom headers.** No `x-request-id`, no client-identity header and no `Authorization` header is read anywhere. Request identity lives in the JSON `requestId`.
* **`Origin`:** the Worker accepts a request with no `Origin`, or with an `Origin` that equals the Worker's own request-URL origin. Deployment gateways differ (see §P1). **Recommendation:** on POST, send `Origin: <exact configured https origin>` with no trailing slash, and make it configurable. Never send any other value.
* **`Host`:** the Worker does not check it, but the OpenBayes gateways do: the Host must equal the configured public host, and a wrong Host returns 403 (`docs/deployment-openbayes-2026-10-28.md` verification bullets). URLSession sets Host from the URL, so this is fine as long as you do not override it.

### 1.4 What the existing native `battery-service` plugin does (for parity)

`mobile/plugins/battery-service/ios/Sources/BatteryServicePlugin/*.swift`, README `mobile/plugins/battery-service/README.md`.

* **Origin config:** one exact HTTPS origin, normalised (host lowercased, `:443` dropped). Changing it is refused while a non-expired session exists (`SESSION_EXISTS`) (`BatteryServicePlugin.swift:82-92`, `ServicePolicy.swift:21-38`).
* **Path allow-list:** the 11 `/api/*` routes only, GET or POST only, no body on GET (`ServicePolicy.swift:12-15,39-64`).
* **URLSession setup:** an `ephemeral` URLSession with `httpCookieStorage=nil`, `httpShouldSetCookies=false`, `httpCookieAcceptPolicy=.never`, no URL cache, timeouts 30 s request / 40 s resource / 45 s hard wait. Redirects are **refused** (`REDIRECT_DENIED`) (`ServiceTransfer.swift:183-209`, `BatteryServicePlugin.swift:132-141`).
* **Request headers:** sets `Content-Type: application/json` on every POST and `Cookie: inventory_session=<token>` from the Keychain. JavaScript may only add `Content-Type` and `Accept`. It **does not send `Origin`** (`BatteryServicePlugin.swift:132-138`).
* **Set-Cookie handling:** parses every `Set-Cookie` header. More than one `inventory_session` cookie, a missing `HttpOnly`, a missing **`Secure`**, `Path` other than `/`, or the presence of `Domain` makes it **reject the response and clear the stored credential** (`SESSION_COOKIE_INVALID`). The stored expiry is `min(Max-Age, 8h)`. An empty value or `Max-Age<=0` clears the credential (`ServicePolicy.swift:75-113`).
* **When the local credential is cleared:** after any HTTP **401**, a clearing cookie, or a 2xx `POST /api/session {"action":"signout"}`. It is **kept** on network failure (`NETWORK_UNCERTAIN`), so that a pending write can still be retried (`BatteryServicePlugin.swift:146-149`).
* **Keychain:** the token and its origin binding are stored with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (README "Credential handling").
* **Response exposure:** only `content-type` and `content-disposition` reach JavaScript. Text and JSON bodies are returned as UTF-8, anything else as base64.
* **Durable business file:** a separate atomic file per origin, protected `completeUntilFirstUserAuthentication`. It holds pending requests and drafts. A request first waits for every preceding business save; the app must wait for a save acknowledgement before sending a mutation (`BatteryServicePlugin.swift:53-65`, README "Durable business recovery").

---

## 2. Datasets (Working vs Demonstration)

| Aspect | Rule | Source |
|---|---|---|
| Values | `"live"` = Working, `"demo"` = Demonstration. The two datasets are separate shared inventories (separate D1 `scope`). Neither is per-user. | `lib/shared-inventory.ts`, `docs/permissions.md` |
| Selection on GET | `?dataset=demo\|live`. **The default is `demo` if omitted**, on `/api/inventory`, `/api/battery-models`, `/api/messages`, `/api/task-plans`, `/api/teaching-groups`, `/api/teaching-checkouts` and `/api/locations`. | each `context()` in `app/api/*/route.ts` |
| Selection on POST | `"dataset"` field in the JSON body. It defaults to `demo` on `/api/inventory`, `/api/battery-models`, `/api/messages` and `/api/task-plans`. It is **required** on `/api/teaching-groups`, `/api/teaching-checkouts`, `/api/locations` and `/api/location-observations`. | same |
| Starting dataset | `StaffUser.defaultDataset` is a navigation preference only. Both roles can use both datasets. | `docs/permissions.md` |
| Demo-only features | `initialize_demo`; any `simulated` source; simulated intake (`DEMO-INTAKE-…`); `mobile_register`; simulated location capture. Since 5 Nov 2026, `native_nfc` is accepted in both inventories. | §5–§8 |
| Idempotency keys | `operations` keys are per scope, so the same `requestId` is independent in demo and live. A retry must use the original dataset. | `lib/server/inventory/database.ts:12-14` |
| Initialisation | Before the first Demonstration read, the mobile client sends `POST /api/inventory {"dataset":"demo","action":"initialize_demo"}`. The call is idempotent and returns `{initialized:false}` if already done. It returns 400 in live. Both roles may call it. | `mobile/src/shared/hooks/use-inventory-data.js:26-33`, `lib/server/inventory/registration.ts:24-37` |

Reference data such as buildings J18/E10/G17, placeholder rooms `J18-DEMO-ROOM`/`-WORKSPACE`/`-STORAGE`, and a `people` row `staff-<accountId>` per account is provisioned lazily on snapshot and detail reads (`lib/server/inventory/provisioning.ts`).

---

## 3. Inventory list, search, filter, sort and pagination

### 3.1 `GET /api/inventory?dataset=<demo|live>` returns the full snapshot

**The server does no search, filtering, sorting or paging.** It returns *every* battery in the dataset, including retired ones, plus the directories. All list behaviour runs client-side over this snapshot (`lib/server/inventory/queries.ts:32-107,187-194`, `app/api/inventory/route.ts:56-60`). The mobile client polls it every **10 s** while idle (`mobile/src/shared/hooks/use-inventory-data.js:147`).

Response (not wrapped):
```jsonc
{
  "dataset": "demo",
  "user": StaffUser,                  // verify user.id == signed-in id and dataset == requested
  "capabilities": { "operatorRegistration":1, "nativeNfc": NativeNfcCapability, "editMetadata":1, "csvImport":1, "batteryModels":1, "modelCreate":1, "demoIntake": 1|0 },
  // NativeNfcCapability (lib/native-nfc-capability.ts): { version:1, enabled:true, enabledDatasets:["demo","live"], operations:[…], evidenceSource:"device-reported", physicalAcceptance:true } (until 5 Nov 2026: enabled only for "demo")
  "batteries": [BatteryRecord],       // ORDER BY id
  "people": [{ "id","version","name","reference","role":"staff"|"borrower","accountId": uuid|null }],
  "buildings": [{ "id","version","name" }],
  "rooms": [Room],
  "staffDirectory": [{ "id","displayName","username","active": bool }],
  "teachingGroups": [TeachingGroup],  // only the caller's own ACTIVE groups in this dataset
  "events": [AuditEvent],             // latest 200 only
  "purgedBatteries": [{ "id","actorAccountId","at" }],
  "newArrivals": NewArrivalsSnapshot, // see 3.4
  "actor": "<displayName>", "hardwareConnected": false
}
```

**`BatteryRecord`** (`lib/domain.ts:97-139`, SQL `queries.ts:43-74`):

| Field | Type | Notes |
|---|---|---|
| `id`, `name`, `chemistry`, `model` | string | `chemistry` and `model` may be `""` |
| `version` | int | **Optimistic-concurrency version.** It must be echoed in scan bindings, lifecycle, inspection and edit requests. |
| `tagId` | string\|null | Exact registered tag string (see §5) |
| `capacityMah`, `voltage` | number\|null | |
| `lifecycleStatus` | `"active"\|"scrapped"\|"permanently_removed"` | |
| `lifecycleAt`, `lifecycleReason`, `lifecycleDestination` | string\|null | |
| `manufacturedOn`, `firstUsedOn` | `YYYY-MM-DD`\|null | |
| `registeredAt` | ISO | Server creation time |
| `ownerId`, `ownerName`, `ownerAccountId` | string, string, uuid\|null | Responsible owner. `ownerId` is a `people.id` such as `staff-<uuid>`. |
| `homeBuildingId`, `homeBuildingName`, `homeRoomId`, `homeRoomName`, `homeRoomNumber` | string\|null | Registered home |
| `homeRoomIsPlaceholder`, `homeRoomSelectable` | bool\|null | |
| `loanId` | uuid\|null | Current open loan. A non-null value means the battery is **In use**. |
| `borrowerId`, `borrowerName`, `borrowerAccountId` | string\|null | |
| `borrowerKind` | `"staff"\|"legacy"\|null` | |
| `checkedOutAt`, `lastCheckedOutAt` | ISO\|null | |
| `observedRoom`, `observedRoomId`, `observedBuilding`, `observationRoomSnapshot` (`"recorded"\|"unavailable"\|null`), `observedAt`, `observationSource` | | Latest dated location evidence. This is **not** the home location. |
| `chargedAt`, `chargeDurationMinutes` | ISO\|null, number\|null | |
| `inspectionPreview` | `{ validRecords, concernRecords, latest: {id,kind,outcome,performedAt,recordedAt,inspectorName}\|null, latestConcern: {…}\|null }` | |

**`Room`**: `{ id, version, name, number: string|null, isPlaceholder: bool, selectable: bool, buildingId: string|null, building: "J18 - Willis Annexe" }` (`queries.ts:88-91,163-167`).

### 3.2 Client-side filter and sort semantics

Port these from `lib/inventory-query.ts:20-139`; the iOS app must implement them itself.

* **Status tabs** (`status`): `all`, `in` (**In store**: active and `loanId == null`), `out` (**In use**: active and `loanId != null`). Both `in` and `out` exclude non-active batteries (`inventory-query.ts:125`). Labels come from `batteryStatusLabel`: Scrapped, Permanently removed, In use, In store (`lib/battery-lifecycle.ts:6-8`).
* **Lifecycle:** defaults to `active`. Other values are `all`, `scrapped` and `permanently_removed`.
* **Personal scope** (`personalScope`): `responsible` (**My batteries**: `ownerAccountId == me`) and `borrowed` (**My loans / in use by me**: `loanId != null && borrowerAccountId == me`) (`inventory-query.ts:121`).
* **Teaching group filter:** the battery is in `group.batteryIds`, where the group is the caller's own active group.
* **Search:** a case-insensitive substring match over `id name chemistry model tagId ownerName borrowerName homeBuildingId homeBuildingName homeRoomNumber homeRoomName lifecycleReason lifecycleDestination` (`:138`).
* **Other filters:** building, room (`__unspecified`), observedRoom (`__not_observed`, `__unavailable`), owner, holder (`__legacy`), chemistry, model ("unknown" variants), capacity, voltage, age range, and checkout/charge **date ranges compared as Australia/Sydney calendar dates** (`:82-86,136-137`).
* **Sort keys:** `id, name, registered, manufactured, age, service_age, checkout, charge, observed, capacity, voltage, charge_duration`, ascending or descending. Nulls always sort last, ties break on `id` with numeric collation (`:12-19,87-113`).
* **Pagination:** client-only. The web and mobile clients use page sizes 10, 25, 50 and 100 (`lib/client/inventory-contracts.ts:75-85`).

### 3.3 Activity

`GET /api/inventory?dataset=X&activity=all&activityScope=all|mine` returns `{ events: [AuditEvent + actorId], activityScope }`. This is the **complete, uncapped** history; `mine` filters on `actor_id = me` (`app/api/inventory/route.ts:47-55`, `queries.ts:246-260`). `AuditEvent` = `{ id, action, batteryId|null, actorName, at, details: object }`.

### 3.4 New arrivals and acknowledgement

* `snapshot.newArrivals` = `{ serverNow, throughSequence, acknowledgedThroughSequence, unreadCount, items: [{ batteryId, sequence, registeredAt, isUnread }] }`. Items are active batteries first registered within the last **48 h** of `serverNow`. `isUnread` is true when another account registered the battery and its `sequence > acknowledgedThroughSequence` (`lib/new-arrivals.ts`, `lib/server/inventory/new-arrivals.ts:77-105`).
* The window is evaluated against `serverNow`. **Do not use the device clock.** Advance `serverNow` by monotonic elapsed time instead (`lib/new-arrivals.ts:46-52`).
* **Acknowledge:** `POST /api/inventory { "dataset", "action":"new_arrivals_ack", "payload": { "throughSequence": <int ≥0 from the snapshot you displayed> } }`. The payload is `.strict()`. Send the **captured** cursor, never "latest". Only an explicit user action should acknowledge, never navigation or polling (`AGENTS.md` notes, `mobile/src/shared/hooks/use-new-arrivals.js:42`).
  * Result: `{ dataset, actorAccountId, acknowledgedThroughSequence }`. The server keeps `MAX(old,new)`, so the call is idempotent and needs no `requestId`.
  * Errors: 409 when `throughSequence` is greater than the server counter or when access has changed; 403 when the account changed (`new-arrivals.ts:107-141`). Roles: staff and admin.

---

## 4. Battery detail and history

`GET /api/inventory?dataset=X&batteryId=<identifier>` returns a `BatteryDetail`, not wrapped (`app/api/inventory/route.ts:56-58`, `lib/server/inventory/queries.ts:262-345`, `lib/domain.ts:175-205`):

```jsonc
{
  "battery": BatteryRecord,
  "usageSummary": { "asOf", "totalCheckouts", "completedCheckouts", "activeCheckouts", "totalCheckedOutSeconds": int|null, "invalidDurationCount" },
  "inspections": [InspectionRecord],     // ≤200, newest performedAt first, includes voided
  "inspectionSummary": { "totalRecords", "validRecords", "latest": InspectionRecord|null },
  "movementSummary": { "activeLoan": LoanRecord|null, "latestReturn": LoanRecord|null, "recentLoans": [≤6], "registration": { "at","actorName" }|null },
  "loans": [LoanRecord],                 // ≤200
  "charges": [{ "id","completedAt","percentage"|null,"durationMinutes"|null,"actorName","recordedAt" }],  // ≤200
  "observations": [{ "id","roomName","roomBuilding","roomSnapshot","observedAt","receivedAt","source" }], // ≤200
  "events": [AuditEvent]                 // ≤200 for this battery
}
```

* `LoanRecord` = `{ id, borrowerName, borrowerAccountId|null, borrowerKind, checkedOutAt, returnedAt|null, cancelledAt|null, checkoutActorName, returnActorName|null, correctionReason|null }`.
* `InspectionRecord` = `{ id, batteryId, kind, outcome, performedAt, recordedAt, inspectorAccountId, inspectorName, method, notes, reference, capacityMah|null, voidedAt|null, voidedByAccountId|null, voidedByName|null, voidReason|null }` (`lib/battery-inspections.ts:35-40`).
* Errors: **404** "Battery not found in this inventory.", 400 for an invalid ID. Roles: staff and admin can view everything, including retired batteries.
* The lists are capped at 200. For complete history use `/api/export`, which takes JSON on POST or `request` (≤15,000 chars) on GET with `format=xlsx|csv|json`, and returns `Content-Disposition: attachment` (`app/api/export/route.ts`). The export request schema is in `lib/exports.ts`; it is not documented here because it is not on the requested list.

---

## 5. Tag lookup (NFC UID to battery)

### 5.1 Tag identifier format

* **Native NFC tags:** `nfc:uid:` followed by **uppercase hex** of the CoreNFC `NFCMiFareTag.identifier` bytes **in native byte order**. The length must be **8, 14 or 20 hex characters** (4, 7 or 10 bytes). Regex: `^nfc:uid:(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$` (`lib/teaching-nfc.ts:4,24`). The iOS reader polls `.iso14443` only and accepts only `.miFare` tags such as NTAG213 (`mobile/plugins/battery-nfc/ios/Sources/BatteryNfcPlugin/BatteryNfcPlugin.swift:140,228-239,389`).
* **Other registered tags:** any trimmed string of 1–128 characters, for example legacy RFID values or `DEMO-INTAKE-…` simulation tags (`lib/domain.ts:24`). Matching is **exact and case-sensitive** against `batteries.tag_id`.

### 5.2 `NfcEvidence` object

This object is required wherever `source:"native_nfc"` appears. It is `.strict()`, so extra keys are rejected (`lib/teaching-nfc.ts:6-28`):

```jsonc
{
  "attemptId": uuid, "source": "native-nfc-reader", "platform": "ios",
  "startedAt": ISO, "endedAt": ISO, "adoptedAt": ISO,         // device times
  "tagId": "nfc:uid:04A1B2C3D4E5F6",                           // MUST == "nfc:uid:" + result.uidHex
  "result": {
    "uidHex": "04A1B2C3D4E5F6",                               // uppercase, 8/14/20 hex
    "technology": "NFC-A / ISO 14443 / MIFARE Ultralight",    // 1–256 chars
    "ndefStatus": "readWrite"|"readOnly"|"notSupported"|"unknown",
    "capacityBytes": int|null,
    "records": [{ "tnf":0-7, "typeHex", "idHex", "payloadHex" }],  // ≤100, each hex ≤32768
    "ndefError"?: string(≤2000),
    "observedAt": ISO
  }
}
```

### 5.3 `scan_lookup`

`POST /api/inventory { "dataset", "action":"scan_lookup", "payload": { "tagIds": [string ×1–100], "source": "manual"|"native_nfc"|"simulated" } }`. The payload is `.strict()` (`lib/domain.ts:25`, `queries.ts:347-368`).

* Result: `{ source, results: [{ tagId, battery: BatteryRecord|null }] }`. Duplicates in the request are collapsed and the order is preserved. `battery:null` means the tag is not registered.
* The call has no side effects, so retries are harmless.
* **Superseded 5 Nov 2026: `native_nfc` is accepted in `live`; `simulated` is still rejected there.** Original analysis: **`native_nfc` and `simulated` are rejected in `live`** with 400: code `native_nfc_demo_only` for the first, no code for the second. In Working inventory the mobile client refuses NFC lookup altogether ("Working NFC lookup is not enabled. Use inventory search.") and **does not relabel hardware reads as `manual`** (`mobile/src/features/scan/lookup-controller.mjs:51-53`, `scan-controller.mjs:153-159`).
  * **UNCERTAIN, product decision:** whether iOS may send an NFC-read UID as `source:"manual"` in live. The server would accept it, but project policy says it must not.
* Roles: staff and admin.
* Alternative with no server call: match `tagId` locally against `snapshot.batteries`.

---

## 6. Checkout and return (`movement`)

`POST /api/inventory { "dataset", "action":"movement", "payload": MovementPayload }` (`lib/domain.ts:28-48`, `lib/server/inventory/movements.ts:76-509`). Roles: staff and admin. **Checkout always lends to the signed-in account**; there is no borrower field. A return may receive *anyone's* loan.

### 6.1 Payload

All objects are `.strict()`.

```jsonc
// checkout
{ "kind":"checkout", "requestId": uuid, "batteryIds": [id ×1–100],
  "scan"?: ScanContext, "teachingGroup"?: { "id": uuid, "version": int } }
// return
{ "kind":"return", "requestId": uuid, "batteryIds": [id ×1–100],
  "expectedLoans": [{ "batteryId": id, "loanId": uuid } ×1–100],   // one per battery, the loanId you reviewed
  "scan"?: ScanContext, "returnRoom"?: { "roomId": id, "version": int },  // returnRoom REQUIRES scan
  "teachingGroup"?: { "id","version" } }

ScanContext = { "sessionId": uuid, "source": "selection"|"manual"|"native_nfc"|"simulated",
                "bindings": [{ "batteryId": id, "tagId": string|null, "version": int, "nfcEvidence"?: NfcEvidence } ×1–100] }
```

* **Binding rules** (`movements.ts:100-136`, `domain.ts:28-43`):
  * There must be exactly one binding per `batteryId`, with no duplicate tags.
  * `tagId:null` is allowed only for `source:"selection"`.
  * `native_nfc` bindings require `nfcEvidence` with `nfcEvidence.tagId == tagId`. Non-native bindings must **not** include `nfcEvidence`.
  * One source per request.
* **Guards** (all checked atomically at commit):
  * Every battery is registered and **active**.
  * Each binding's `tagId` and **`version`** equal the current record.
  * Checkout: no open loan exists on any battery. Return: every `(batteryId, loanId)` is still open.
  * The account is active, with the same `auth_version`, role and display name/version.
  * The group (if given) is the caller's own, active, at that exact version, and contains every battery (`lib/server/inventory/groups.ts:23-64`).
  * `returnRoom`: building `J18`, `selectable`, **not a placeholder in `live`**, and `version` equal to the current room version.
* **Dataset (superseded 5 Nov 2026: `native_nfc` is accepted in `live`; `simulated` still returns 400):** `scan.source` of `native_nfc` or `simulated` returns **400 in `live`** (code `native_nfc_demo_only` for NFC). In Working inventory, use `source:"selection"` (the mobile client does: "use Manual selection in Working inventory", `scan-controller.mjs:156`) or `manual` for a typed exact tag.
* **Without `scan`:** a plain reviewed-queue movement is also valid. It carries no tag or version binding, but return still requires `expectedLoans`.

### 6.2 Receipt (`result`)

```jsonc
{ "kind", "batteryIds": [sorted unique], "count", "at": ISO, "requestId",
  "borrower"?: displayName, "borrowerAccountId"?: uuid,          // checkout only
  "scan"?: ScanContext (bindings sorted by batteryId),
  "returnPlacement"?: { "roomId","roomName","building","buildingId","isPlaceholder","source","observedAt","roomVersion","buildingVersion" },
  "teachingGroup"?: { "id","version","name","ownerAccountId","operationId": requestId, "batteryIds" },
  "replayed"?: true }                                              // present when this is a replay of an earlier commit
```

Verify the receipt with the checks in `lib/movement-session.ts:37-52`: same `requestId` and `kind`, the same ID set, `count` equal to the number of IDs, and on checkout `borrowerAccountId == me`. If `scan` was sent, it must come back equal after sorting.

### 6.3 Errors

| HTTP / code | Meaning |
|---|---|
| 400, no code (zod) | Payload invalid. Nothing was recorded. |
| 400 `native_nfc_demo_only` | Before 5 Nov 2026 only: NFC source used in live. No longer raised. A `simulated` source in live still returns 400 (no code) before any reservation. |
| 400, binding mismatch message | Bindings do not cover every battery exactly once, or `returnRoom` was sent without `scan`. Raised before reservation. |
| **4xx `movement_rejected_final`** | **Terminal.** Any business 4xx raised inside the transaction is converted to this code and **durably reserved** against this `requestId`. That covers 404 not registered, 409 `battery_inactive`, 409 `scan_conflict` (tag, version, room or loan changed), 409 loan already out or reviewed loan changed, 400 room not eligible, 409 group changed, and 409 account changed. **The original sub-code is not returned; only the message is.** This `requestId` can never succeed later (`movements.ts:23-74,487-508`). |
| 409, no code, "already used for a different operation" | Same `requestId` with a different fingerprint. This is a client bug: the payload changed between retries. |
| 401 | Session invalid. **Nothing executed on this attempt.** If an earlier attempt was uncertain, it remains uncertain. |
| 503 or network failure | **Uncertain.** |

---

## 7. Registration (intake) from mobile

There are three server registration actions. All allocate `BAT-########` atomically and share the logic in `lib/intake-store.ts`. **The server has no draft API.** Drafts, such as the demo batch queue of up to 200 entries in `lib/intake-draft.ts`, exist only on the client.

| Action | Datasets | Tag | Use |
|---|---|---|---|
| `operator_register` | **demo and live** | any 1–128 string, or `null` (untagged) | Manual "Working intake" form on the phone. This is what the mobile client uses (`mobile/src/features/lifecycle/manual-registration.jsx:70`). |
| `intake` | `native_nfc` in both inventories (since 5 Nov 2026); simulated intake demo only (otherwise 501) | `DEMO-INTAKE-…` (simulated) or `nfc:uid:…` with `source:"native_nfc"` plus `nfcEvidence` | Batch NFC intake (`lib/intake-session.ts:15-22`) |
| `mobile_register` | demo only (otherwise 501) | canonical `nfc:uid:…` or `null` | Legacy test path; avoid it. |

### 7.1 `operator_register` payload

`POST /api/inventory {"dataset","action":"operator_register","payload":…}` (`lib/operator-registration-session.ts:6-15`, `lib/intake-session.ts:7-8`, `lib/domain.ts:16-21`):

```jsonc
{ "requestId": uuid, "sessionId": uuid, "source": "operator-entered-registration",
  "tagId": string(1–128)|null,
  "directoryBindings": { "ownerVersion": int, "ownerAccountId": uuid, "buildingVersion": int, "roomVersion": int|null },  // from snapshot people/buildings/rooms
  "common": {
    "name": string(2–120), "chemistry": string(≤40)="", "model": string(≤120)="",
    "capacityMah": number|null, "voltage": number|null,
    "ownerId": "<people.id of an ACTIVE STAFF-LINKED person, e.g. staff-<uuid>>",
    "homeBuildingId": "J18",          // must be J18 (only supported building)
    "homeRoomId": id|null,            // selectable J18 room, or null
    "manufacturedOn": "YYYY-MM-DD"|null, "firstUsedOn": "YYYY-MM-DD"|null,
    "modelSelection"?: { "origin":"saved"|"inventory"|"reference", "id", "contentHash": 64hex, "confirmed": true, "appliedFields": ["name"|"model"|"chemistry"|"capacityMah"|"voltage"] }
  },
  "firstUseMode": "at_registration"|"date"|"unknown" }   // "date" ⇔ firstUsedOn set; otherwise firstUsedOn must be null
```

**Result:** `{ requestId, sessionId, dataset, actorAccountId, batteryId:"BAT-00000042", tagId, registeredAt, source, replayed, name, model, chemistry, capacityMah, voltage, ownerId, homeBuildingId, homeRoomId, manufacturedOn, firstUsedOn }`. When `firstUseMode = at_registration`, `firstUsedOn` is the **Sydney calendar date of `registeredAt`** (`intake-store.ts:470-475`). Verify the result with `verifyOperatorRegistrationReceipt` (`operator-registration-session.ts:30-38`).

**Errors:**

| HTTP / code | Meaning |
|---|---|
| 400 | Owner not an active staff person, building not J18, or room invalid (`intake-store.ts:247-266`). |
| 409 `intake_tag_registered` | The tag already belongs to a battery. |
| 409 | The tag belongs to a purged battery and remains reserved. |
| 409 `registration_context_conflict` | `directoryBindings` versions are stale. |
| 409 `intake_session_conflict` | The `sessionId` was reused with different details. |
| 409 `model_conflict` | The model selection changed. |
| 400 | Future date in Sydney time, or `firstUsedOn < manufacturedOn` (`domain.ts:57-65`). |
| — | **All of these business 400/404/409 errors are converted to `registration_rejected_final`** (`intake_rejected_final` for the `intake` action) and reserved against the `requestId` (`intake-store.ts:373-400,137-176`). |
| 403 | Account access changed. |
| 501 | `intake` or `mobile_register` attempted in live. |

**Roles:** staff and admin (`registerBatteries`).

**`sessionId`:** the server freezes the configuration (common fields, firstUseMode, source, directoryBindings) on the first use of a `sessionId`. Use a **new `sessionId` whenever the common details change**. One `sessionId` can carry many tags only if every other detail is identical.

### 7.2 `intake` (demo batch)

Same `common` and `firstUseMode` as above, plus:
* `{ requestId, sessionId, scannedAt?: ISO, tagId }`
* either `source` omitted or `"simulated_intake"` with tagId `^DEMO-INTAKE-…`,
* or `source:"native_nfc"` with `nfcEvidence` and `tagId` equal to `nfcEvidence.tagId`.

`common.teachingGroup` passes schema validation, but `intake-store.ts` applies no group effect; omit it (UNCERTAIN). The result has the same shape plus `source` and `nfcEvidence`.

### 7.3 Model references

* `GET /api/battery-models?dataset=X` returns `{ dataset, models: [BatteryModelChoice], issues: [{model,message}] }`. `models` covers saved models, inventory-derived models and the bundled reference catalogue. `BatteryModelChoice` = `{ id, origin, label, brand, variant, name, model, chemistry, capacityMah, voltage, capacityBasis, verificationStatus, notes, warnings[], sources[{id,url,title}], contentHash, createdAt?, actorName?, version? }` (`app/api/battery-models/route.ts:14-19`, `lib/battery-models.ts:5-25`).
  * To apply a model, copy the chosen fields and send `modelSelection {origin, id, contentHash, confirmed:true, appliedFields}`.
* Create a model (staff and admin): `POST /api/battery-models {"dataset","action":"create_reviewed","payload":{ "id": uuid (also the request id), "brand","model"(1–120),"variant","name"(2–120),"chemistry","capacityMah","voltage","notes" }}`. It returns `{ok,result: {state:"confirmed", receipt:{model,requestId,actorAccountId,dataset,replayed}} | {state:"rejected",…,code:"model_rejected_final"}}`.
  * After an uncertain response, call `action:"create_outcome"` with the **same payload**. It returns `missing`, `confirmed` or `rejected` without writing.
  * 409 `model_duplicate` when the brand, model and variant already exist (`lib/battery-model-store.ts:82-135`, `lib/model-create.ts`).
  * Editing a model is admin-only.

### 7.4 Binding a tag to an existing battery

This is a battery metadata edit: `POST /api/inventory {"action":"battery","update":true,"payload": batterySchema + expectedVersion}`. It is **admin-only**: staff get 403 (`lib/server/inventory/registration.ts:135`). Registration is the only way staff can attach a tag, and only for a new battery.

---

## 8. Retirement and removal (`lifecycle`)

`POST /api/inventory {"dataset","action":"lifecycle","payload":…}` (`lib/lifecycle-session.ts:6-23`, `lib/server/inventory/lifecycle.ts`). Roles: **staff and admin**. Owners other than the caller are allowed.

```jsonc
{ "requestId": uuid, "kind": "scrapped"|"permanently_removed",
  "reason": string(≤1000)="", "destination": string(≤200)|null,  // destination must be null/absent for "scrapped"
  "teachingGroup"?: { "id","version" },
  "source": "manual_selection"|"tag_entry"|"native_nfc",          // native_nfc accepted in both inventories since 5 Nov 2026 (earlier: 501 in live)
  "items": [{ "batteryId", "version": int, "tagId": string|null, "nfcEvidence"?: NfcEvidence } ×1–100] }
```

* Each battery may appear once, with no duplicate tags. `tag_entry` requires non-null tags. `native_nfc` requires the `nfc:uid` regex and evidence.
* **Guards:** every battery is active, and `version` and `tagId` equal the current record (409 `lifecycle_conflict`). There is **no open loan** (409 `lifecycle_loan_active`; return the battery first).
* **Result:** `{ requestId, dataset, actorAccountId, kind, reason, destination, at, replayed, source, items:[{ batteryId, tagId, version: reviewed+1, status: kind, nfcEvidence? }], teachingGroup? }`.
* **Terminal code:** `lifecycle_rejected_final` for 400/404/409/422 errors. 409 `idempotency_conflict` when a `requestId` is reused with a different payload.

**Recover or purge scrapped batteries:** `action:"retired_asset"`, payload `{ requestId, kind:"recover"|"purge", items:[{batteryId, version, tagId}] }`. `recover` is open to staff and admin; `purge` is admin-only and irreversible. The result items carry `status:"active"|"deleted"`. The final code is `retired_asset_rejected_final` (`lib/retired-asset-actions.ts`, `lib/server/inventory/retired-assets.ts`). `permanently_removed` batteries cannot be recovered.

---

## 9. Messages and task completion

### 9.1 Inbox

`GET /api/messages?dataset=X[&readState=all|unread|read][&taskStatus=all|open|completed][&visibility=current|removed|all][&search=≤200][&countOnly=true]` (`app/api/messages/route.ts:15-35`, `lib/task-plans.ts:276-296`). This GET can **generate** due cycles and messages server-side (`sync()`), so it has side effects.

* With `countOnly=true` it returns `{ messageCount, unreadCount, capabilities, generationIssues }`.
* Otherwise it returns `{ messages: [InboxMessage], unreadCount, capabilities, generationIssues }`.

`InboxMessage` = `{ id, version, removedAt|null, cycleId, planId, recipientId, title, body, createdAt, readAt|null, dueOn, reminderOn, reminderTime, reminderAtUtc, taskStatus:"open"|"completed", cycleVersion, cycle: TaskCycleRecord }`. `TaskCycleRecord` includes `id, planId, version, status, dueOn, canComplete, planRemoved, currentAssigneeIds, targetSnapshot` and the plan fields (`category, title, description, targetKind, batteryIds, …`) (`lib/task-plans.ts:17-22`).

Messages are private to the recipient (own inbox only). Their read, remove and restore events appear in shared Activity.

### 9.2 Mark read

`POST /api/messages {"dataset","action":"read","payload":{"id": uuid}}` returns `{ok, result:{ id, readAt }}`. It is naturally idempotent: an already-read message returns its existing `readAt` and no `requestId` is needed. 404 when the message is not in your inbox (`lib/task-plans.ts:350-367`).

### 9.3 Remove or restore a message

`POST /api/messages {"dataset","action":"remove"|"restore","requestId": uuid,"payload":{"id","expectedVersion"}}`. The result is `{ id, version, removedAt, requestId, action, actorAccountId, dataset }`. Errors: 409 `record_conflict`; terminal code `task_visibility_rejected_final`.

### 9.4 Complete a task cycle

`POST /api/task-plans {"dataset","action":"complete","requestId": uuid,"payload":{"cycleId": uuid,"expectedVersion": int,"notes"?: string≤2000}}` (`app/api/task-plans/route.ts:35-41`, `lib/task-plans.ts:257-274`).

* Use `cycle.id` and `cycle.version`, which equals `message.cycleVersion`.
* **Result:** `{ id, version: v+1, status:"completed", nextDueOn, skippedPeriods, calculationRule }`. A replay returns the same object (it has no `replayed` flag).
* **Errors:**
  * 404 cycle not found.
  * 409 `record_conflict`: not open, or the version changed.
  * 409 `plan_removed`.
  * 403: not currently assigned. Staff may complete only cycles they are assigned to; admins may complete any (`canComplete`).
* `requestId` is **optional** on the server, but **always send one**. Without it there is no replay protection.
* Completion has **no durable final-rejection reservation**. After an uncertain attempt, a retry that returns 409 means no operation row existed at retry time. A delayed original could in theory still commit, so re-read the cycle (UNCERTAIN edge case).
* `GET /api/task-plans?dataset=X[&visibility=…]` returns `{ plans, cycles, staffDirectory, capabilities, generationIssues }`. Configuring plans is admin-only.

---

## 10. Teaching groups

The authoritative schemas are `lib/teaching-groups.ts`, `lib/teaching-checkouts.ts` and `lib/teaching-context.ts`.

### 10.1 List and detail

`GET /api/teaching-groups?dataset=X` returns `{ groups: [TeachingGroup] }`, the caller's **own active** groups (`lib/teaching-group-store.ts:18-22`). The same list is in `snapshot.teachingGroups`. **There is no per-group GET.** Group detail is the group plus `snapshot.batteries` filtered by `batteryIds`.

`TeachingGroup` = `{ id: uuid, name (1–80), notes (≤500), batteryIds: [id ×1–100 unique], version, ownerAccountId, state:"active"|"archived", createdAt, updatedAt }`.

### 10.2 Create, edit and remove

`POST /api/teaching-groups {"dataset" (required), "payload": …}`, with one of these payloads:
* `{action:"create", requestId, id: new uuid, name, notes, batteryIds}`
* `{action:"update", requestId, id, name, notes, batteryIds, expectedVersion}`
* `{action:"remove", requestId, id, expectedVersion}`. This archives the group and cannot be undone through the API.

The result is `{ requestId, actorAccountId, dataset, action, group, replayed }`. 409 when the version changed or the name is duplicated (case-insensitive). Terminal code `teaching_group_rejected_final`. Roles: own groups only, for both staff and admin.

### 10.3 Group checkout and return, path A: plain movement scoped to a group

Add `teachingGroup:{id, version}` to the §6 `movement` payload. The server checks ownership, active state, exact version and that every battery is a member. The receipt's `teachingGroup` carries `{id, version, name, ownerAccountId, operationId == requestId, batteryIds}`.

### 10.4 Path B: teaching-checkout "runs" with alternatives and exchange

`GET /api/teaching-checkouts?dataset=X[&runId=uuid]` returns `{ runs: [TeachingCheckoutListedRun] }`. Without `runId` it returns the caller's own runs; with `runId`, that run. `?format=json|xlsx&runId=` downloads it (`app/api/teaching-checkouts/route.ts`, `lib/server/inventory/teaching-checkouts.ts:259-277`).

Listed run fields: `{ id, dataset, actorAccountId, actorName, teachingGroup (evidence), requestedBatteryIds, mappings, createdAt, separateCheckout?, items:[{ batteryId, loanId, status:"outstanding"|"returned"|"cancelled"|"deleted", tagId, version, returnedAt, checkedOutAt?, originalBatteryId?, pendingReturn? }], revision, currentMappings, changes }`.

`POST /api/teaching-checkouts {"dataset" (required), "payload": TeachingCheckoutRequest}` (`lib/teaching-checkouts.ts:7-21`):

```jsonc
// Binding = { batteryId, tagId: string|null, version: int }
// Source  = { kind: "selection"|"tag"|"native_nfc", evidence?: NfcEvidence }   // evidence iff native_nfc
{ "action":"checkout", "requestId", "teachingGroup":{id,version}, "personalScope":"all"|"responsible"|"borrowed",
  "mappings":[{ "original": Binding, "actual": Binding, "originalLoanId": uuid|null, "existingLoanId"?: uuid,
                "method":"original"|"automatic"|"manual", "source": Source } ×1–100], "separateCheckout"?: bool }
{ "action":"return", "requestId", "runId", "personalScope", "items":[{ ...Binding, "loanId": uuid, "source"?: Source } ×1–100] }
{ "action":"continue", "requestId", "runId", "expectedRevision": int, "teachingGroup", "personalScope", "mappings":[…] }
{ "action":"exchange", "requestId", "runId", "expectedRevision", "personalScope", "originalBatteryId",
  "outgoing": { ...Binding, "loanId", "source"? }, "actual": Binding, "actualLoanId": uuid|null, "returnOutgoing": bool, "source": Source }
```

* **Result:** `{ requestId, actorAccountId, dataset, action, run, change?, revision?, returnedItems?, at, replayed? }`.
* **Mapping rules** (`teaching-checkouts.ts:115-170`):
  * `method:"original"` requires `original == actual`, `source.kind == "selection"`, and an `originalLoanId` equal to the member's current loan.
  * `automatic` requires identical known model, chemistry, capacity and voltage.
  * Only `manual` may use a `tag` or `native_nfc` source.
  * One source kind per queue.
* **Datasets:** the server has **no** demo-only check for `native_nfc` here (unlike `movement`). Mirror the movement rule client-side anyway (UNCERTAIN).
* **Errors:** 409 `teaching_checkout_conflict`; terminal code `teaching_checkout_rejected_final` for any 4xx inside the call.

**Recommendation for v1:** use path A (`movement` with `teachingGroup`) for group checkout and return. Path B is needed only for substitute batteries and multi-revision runs.

---

## 11. Inspections

`POST /api/inventory {"dataset","action":"inspection","payload":…}` (`lib/battery-inspections.ts:6-26`, `lib/server/inventory/inspections.ts:73-101`). Roles: **staff and admin** may append. Voiding an inspection (`action:"inspection_void"`, payload `{requestId,batteryId,inspectionId,reason(5–1000)}`) is **admin-only**.

```jsonc
{ "requestId": uuid, "batteryId": id, "expectedBatteryVersion": int,   // = BatteryRecord.version you viewed
  "kind": "visual_check"|"functional_check"|"capacity_measurement"|"other",
  "outcome": "no_concern_observed"|"concern_observed"|"inconclusive",
  "performedAt": ISO (NOT in the future vs server clock — no grace),
  "method": string≤1000="", "notes": string≤2000="", "reference": string≤1000="",
  "capacityMah": number|null }   // required (and method required) iff kind=capacity_measurement; else must be null
```

* `notes` is required when `outcome = concern_observed` or `kind = other`.
* **Result:** `{ requestId, dataset, actorAccountId, batteryId, inspectionId, action:"inspection", at, replayed }`.
* Recording an inspection does **not** bump the battery's `version`.
* **Errors:** 400 future time; 404; 409 battery changed or retired; 409 `inspection_conflict`. Terminal code `inspection_rejected_final` for 400/404/409/422.

---

## 12. Rooms and locations for return placement

* **Source of the room list:** `snapshot.rooms` (§3.1). **`GET /api/locations` is not the room list.** It returns BLE *room beacons*: `{ dataset, beacons:[…], capabilities:{ hardwareIngestion:false, demoSimulation, manageBeacons } }`, and beacon management is admin-only (`lib/server/inventory/location.ts:95-99`).
* **Eligible return rooms:** `buildingId == "J18" && selectable && (dataset == "demo" || !isPlaceholder)` (`lib/location-catalog.ts:19-25`, `movements.ts:206-231`).
  * A fresh Working inventory contains **only placeholder rooms**, so live returns must leave the room unspecified (omit `returnRoom`) until an admin adds verified J18 rooms.
* **Sending a placement:** add `returnRoom:{roomId, version: room.version}` to a **scan-context** return. It creates an observation with source "Staff return confirmation". It does **not** change the battery's registered home.
* **Server room label:** `"<number> - <name>"`, `"<name> — Placeholder"` or `"<name>"` (`movements.ts:208`).
* **Location observations** (`POST /api/location-observations`): a phone BLE source returns 501 `location_hardware_unavailable`; simulated capture is admin-only and demo-only. iOS does not need this endpoint.

---

## R. Exact-request recovery: what to persist and how to retry

The rules below hold for `movement`, `lifecycle`, `operator_register`/`intake`, `retired_asset`, `inspection`, teaching groups and teaching checkouts, model `create_reviewed`, and message remove/restore. Sources: `lib/server/inventory/transactions.ts:33-153`, `lib/movement-session.ts:29-34`, `lib/scan-session.ts:73-78,129-140`, `lib/intake-session.ts:75-80`, `lib/lifecycle-session.ts:65-70`, `lib/client/teaching-checkout-request.ts:35-39`, `mobile/src/features/scan/scan-controller.mjs:115-138`.

1. **Before sending,** persist durably and read back:
   * account id, dataset, action and the **exact payload bytes** (including `requestId`, `sessionId`, evidence and versions);
   * the reviewed battery rows used to build the payload;
   * a status of `uncertain`.
   Use an atomic file write with `completeUntilFirstUserAuthentication` protection. **Do not send if the save failed.**
2. **Fingerprint:** the server fingerprints a canonical form of the payload together with the actor (and dataset). A retry must send **the same payload values**. Movement bindings and loans are re-sorted server-side; for everything else, keep the original key order and values.
   * Never regenerate `requestId`, `sessionId`, `adoptedAt` or any timestamp on retry.
   * A changed payload under an old `requestId` gets 409 `idempotency_conflict` (or a 409 "already used for a different operation" with no code).
   * **Use lowercase UUIDs.** Keys are case-sensitive strings, so `ABC…` and `abc…` are different requests.
3. **Classify the response:**
   * **2xx** with a receipt that verifies against the payload (§6.2, §7.1 and similar): success. `replayed:true` means it had already committed. Persist the receipt, clear the pending entry, then refresh the snapshot.
   * **First attempt, any 4xx:** rejected. Nothing committed: either validation failed before the reservation, or a terminal rejection was reserved.
   * **Retry of an uncertain attempt:** only a verified receipt, or a 4xx whose `code` ends in **`_rejected_final`**, resolves it. The final codes are `movement_rejected_final`, `lifecycle_rejected_final`, `registration_rejected_final`, `intake_rejected_final`, `retired_asset_rejected_final`, `inspection_rejected_final`, `teaching_group_rejected_final`, `teaching_checkout_rejected_final`, `model_rejected_final`, `task_visibility_rejected_final`, `task_create_rejected_final` and `group_operation_rejected_final`. Any other 4xx (401, 403, plain 409) leaves the request **uncertain**.
   * **5xx, timeout, connection loss or redirect:** uncertain.
4. **While uncertain:**
   * Block new writes that touch the same batteries.
   * Allow only "Retry the same request". After a 401, re-authenticate as the **same account** and retry.
   * Do not let "current state looks right" stand in for a receipt (`movement-session.ts:36`).
   * On sign-out or account switch, keep the pending entry; it is scoped by account, dataset and origin.
5. **After a terminal rejection:** that `requestId` is burned. Show the message, re-review against fresh data, and build a **new** payload with a new `requestId`. Movement and scan rejections also burn the scan binding versions you reviewed.
6. **Recovery file keys used by the mobile client** (useful for parity): `battery-movement:<acct>:<ds>:<kind>`, `battery-scan:<acct>:<ds>:<kind>`, `battery-intake:<acct>:demo`, `battery-lifecycle:<acct>:<ds>`, `battery-teaching-group:<acct>:<ds>`, `battery-teaching-checkout:<acct>:<ds>`, `battery-retired-action:<acct>:<ds>` (`lib/client/workflow-recovery.ts`).

---

## Role summary

From `lib/permissions.ts` and `docs/permissions.md`.

| Capability | staff | admin |
|---|---|---|
| View both datasets, detail, activity, export | ✓ | ✓ |
| Checkout (always to self) and return (anyone's loan); return placement | ✓ | ✓ |
| `operator_register`; demo `intake`; create battery models | ✓ | ✓ |
| Scrap or permanently remove (`lifecycle`); recover scrapped | ✓ | ✓ |
| Purge scrapped (`retired_asset` with `purge`) | ✗ 403 | ✓ |
| Append inspection | ✓ | ✓ |
| Void inspection; charges; observations; loan corrections; `battery`/`room`/`building`/`person` saves; non-battery imports; model edits | ✗ 403 | ✓ |
| Own teaching groups and teaching checkouts | ✓ | ✓ |
| Complete task cycle | only if currently assigned | any open cycle |
| Create or configure task plans; manage accounts | ✗ | ✓ |
| Own messages (read, remove, restore) | ✓ | ✓ |

---

## P. Pitfalls for a new client

1. **Origin header and deployment gateways.**
   * The Worker rejects an `Origin` that differs from its own request-URL origin, and accepts a missing one (`lib/api.ts:74-78`).
   * The OpenBayes gateway in this tree (`deploy/openbayes/2026-10-12/runtime.mjs:180-195`) **requires** `Origin == "https://" + Host` on every non-GET request; a missing `Origin` gets 403 there. Yet the existing native plugins send **no** `Origin`, and Android POSTs reportedly succeeded against the hosted R3 deployment (`docs/releases/current-integration-baseline.md:11-17`). The R3 gateway source is **not in this tree (UNCERTAIN)**.
   * The USB/device test gateway accepts either no `Origin` or the exact public origin, and rejects `Sec-Fetch-*` browser metadata when `Origin` is absent (`scripts/mobile-device-test-gateway.mjs:175-190`).
   * Safest choice: send `Origin: <configured origin>` exactly, behind a toggle, and never send `Sec-Fetch-*` headers.
2. **The `Secure` cookie attribute depends on the URL scheme the Worker sees.** If a TLS-terminating proxy forwards `http://` URLs, `Set-Cookie` arrives without `Secure`, and a strict cookie parser (like the existing plugin's) will refuse the session. Accept the cookie only from your configured HTTPS origin. Store the token in the Keychain and send it manually; disable `HTTPCookieStorage` (use an ephemeral configuration).
3. **Exactly one `inventory_session` cookie.** Duplicate cookies make the server treat the request as unauthenticated (`credentials.ts:26-31`). Do not let both URLSession's cookie jar and manual headers send it.
4. **Redirects:** do not follow them. An unauthenticated **page** request redirects to `/signin`, but `/api/*` returns JSON 401.
5. **`Content-Type` is a case-sensitive prefix match on `application/json`** (`lib/api.ts:79`). Every POST needs it, including sign-out.
6. **Size limits:** see the §0 table. The server counts `String.length` (UTF-16), not bytes. Native NFC evidence (`records[].payloadHex` up to 32,768 chars each, 100 records) can push a 100-battery `native_nfc` movement past 250,000; check before sending. Exports: GET `request` ≤ 15,000 chars, and the existing plugin also caps POST export bodies at 15,000 bytes.
7. **`dataset` silently defaults to `demo`** on most endpoints. A Working-inventory write that omits it goes to Demonstration. Always send it, and check `snapshot.dataset` and `snapshot.user.id` on every read (`use-inventory-data.js:35`).
8. **Superseded 5 Nov 2026: native NFC business writes are accepted in both inventories; only `simulated` sources, simulated intake and `mobile_register` stay Demonstration-only.** Original: **Native NFC business writes are Demonstration-only.** In live: `scan_lookup` and `movement` with `native_nfc` or `simulated` return 400 `native_nfc_demo_only`; `lifecycle` with `native_nfc` returns 501; `intake` and `mobile_register` return 501. In live use `selection` (or `manual` for a typed tag) and `operator_register`. Do not relabel NFC reads as manual.
9. **Version fields are mandatory concurrency guards.** `BatteryRecord.version` feeds scan bindings, lifecycle, retired-asset and inspection requests (`expectedBatteryVersion`). `Room.version` feeds `returnRoom`. `people[].version`, `buildings[].version` and `rooms[].version` feed `directoryBindings`. Group `version` feeds `teachingGroup`, cycle `version` feeds completion, and message `version` feeds remove/restore. Returns also need the exact `loanId`. Always take these from the most recent snapshot and re-fetch after any 409.
10. **Business 4xx errors inside a write are converted to `*_rejected_final`**, and the original sub-code is lost: `scan_conflict` and `battery_inactive` come back as `movement_rejected_final` with only the message (`movements.ts:23-74`). Do not branch on sub-codes such as `scan_conflict` for movements. Pre-transaction errors (zod 400s, `native_nfc_demo_only`) carry no reservation.
11. **Timezone: Australia/Sydney.** The following all use Sydney calendar dates (`lib/battery-age.ts:11-15`):
    * the `firstUsedOn` derived for `at_registration` (`intake-store.ts:470-475`);
    * the "not in the future" checks on `manufacturedOn` and `firstUsedOn` (`domain.ts:57-65`);
    * the client-side checkout and charge date filters;
    * age and service-age calculations;
    * task `dueOn`, completion dates and reminders (`lib/task-schedule.ts`).

    Use `TimeZone(identifier: "Australia/Sydney")` for these dates, not the device zone. The receipt check expects `firstUsedOn == SydneyDate(registeredAt)`.
12. **The device clock is untrusted.**
    * `inspection.performedAt` must not be later than server time; this check has **no grace period**. Clamp it to `now - few seconds` or let the user pick a past time.
    * Charge and observation times allow 60 s (`domain.ts:51-56`).
    * New-arrival expiry must use `serverNow` plus monotonic elapsed time.
13. **The snapshot is not paginated and includes retired batteries.** `events` holds only 200 entries, and detail lists are capped at 200. Filter `lifecycleStatus` client-side. A full history needs `?activity=all` or `/api/export`.
14. **Placeholder rooms are rejected for Working returns** (400). By default Working has only placeholder rooms, so offer "Room unspecified". `returnRoom` without `scan` is a 400.
15. **Registration requires `homeBuildingId: "J18"`** and an owner `people.id` linked to an **active staff account** (for example `staff-<uuid>`). For `operator_register` the snapshot versions must go into `directoryBindings`. Reusing a `sessionId` with changed details gives 409 `intake_session_conflict`, and the `requestId` is then burned.
16. **Some GETs write.** `/api/messages` and `/api/task-plans` generate due cycles and messages. `/api/inventory`, `/api/locations` and `/api/battery-models` provision reference rows. Demo needs `initialize_demo` once. Do not treat these GETs as cache-free reads in tests.
17. **Session lifetime is a hard 8 hours with no refresh,** and role or password changes revoke it immediately. Handle a 401 on any call by re-authenticating, **without discarding pending requests**. Clear the local token on 401 (plugin parity), but keep the pending-write file.
18. **The checkout borrower is always the signed-in account.** There is no proxy borrowing, including for admins (`movements.ts:279-311`). A 409 with the message "This account's directory association requires administrator review." (it has no code) means the account's people row collides with another row.
19. **Messages, task completion and new-arrival acknowledgement have weaker idempotency** than movements. Always send `requestId` on task `complete`; there is no final-rejection reservation (§9.4).
20. **UNCERTAIN items to confirm with the backend owner:**
    * whether the R3 gateway requires `Origin` (P1);
    * whether `source:"manual"` in live may carry NFC-read UIDs (§5.3);
    * whether teaching-checkout `native_nfc` should also be demo-only (§10.4);
    * whether `intake.common.teachingGroup` has any effect (§7.2).
