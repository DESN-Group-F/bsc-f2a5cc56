# Management console (PC client for Microsoft Teams and SharePoint)

Updated: 4 November 2026 (Australia/Sydney). Owned by the server and web workstream. Status: **first increment implemented and checked locally; not deployed; not yet opened inside Teams.**

## Purpose and decisions (owner, 4 Nov 2026)

- Each client has one job. The **web application** is the complete reference with every function. The **iOS and Android clients** are field tools (scan, check out, return, register, retire). The **management console** is the desktop tool for looking up, editing and keeping up with records: practicality first.
- The console never offers NFC scanning. Browser scanning is a demonstration feature of the full web application (Demonstration inventory, Chrome on Android, top-level pages only; `docs/web-nfc-scanning.md`), and the shared scan panel renders nothing inside an embedded page such as the Teams tab.
- The console is a separately designed frontend inside the same codebase, at `/console`. It is not a new program, not a revival of the abandoned Electron desktop, and not a reskin of the web sidebar. It reuses the server, the database, the API, the shared query model, permissions and exact-request recovery. No business rule is reimplemented in the console.
- Entry point for the pilot: one website tab in the owner's Teams channel, opening on the overview. Everything else is reachable from inside the page. Server and database stay where they are (no SharePoint list, Power Apps or Dataverse migration in this phase).
- Channel members can see the tab; what they can do is decided by their battery-system account. Only the owner holds an Administrator account for the pilot, so only the owner edits saved battery records. Treat the channel as a small regional trial with teachers.
- Recurring check intervals come from the team's research and are entered by the administrator as task plan configuration. The console does not invent intervals or safety rules.

## Findings that shaped the design

- **Periodic check reminders already exist** as Recurring tasks: four categories, three recurrence rules (fixed interval, after completion, explicit dates), assignment, Messages and explicit completion (`docs/messages-and-reminders-plan.md`). The console surfaces them; it does not add a second reminder system.
- **Inspection records and tasks are separate evidence.** Completing a task does not create an inspection record, and recording an inspection does not complete a task. The console keeps them apart.
- **Loans have no due date.** There is no overdue loan. Overdue in the console always means an open recurring-task cycle past its due date. Outstanding loans are listed by elapsed time only.
- **Reminders are generated while the system is in use.** There is no scheduler; opening the console (or any authenticated request) is what evaluates them. A daily Teams post would need a scheduler and is out of scope.
- **Metadata edits use the operator edit contract** (`lib/operator-edit.ts`, migration 0023): exact before-snapshot, reviewed directory versions, verified receipts, reserved final rejections and a query-only outcome lookup. It was built for a management client and was unused by the web interface until now.

## Information architecture

| Area | Contents | Built from |
| --- | --- | --- |
| Overview | Active, In store, In use (and holders), recurring tasks due, inspection concerns, new arrivals; due work, inspection attention, longest checkouts, recent activity. Every tile and row opens the matching view or record. | New, computed from the shared snapshot and task records (`lib/console/overview.ts`) |
| Batteries | Data grid with views, filters, column chooser, sorting, multi-select, keyboard use, docked summary, export and (administrators) in-grid editing with review | New grid; shared query model; `BatteryDetails`, `ExportDialog` reused |
| Tasks | Due work queue (all, mine, overdue) with completion; recently completed; Plans and cycles; My messages | `TaskCycleDialog`, `TaskPlansPanel`, `MessagesPanel` reused |
| Activity | Shared operation history and exports | `ActivityHistory` reused |
| Admin (administrators only) | Records and directories (with CSV import), staff accounts | `RecordManagement`, `RecordEditor`, `ImportDialog`, `AccountManagement` reused |

Top bar: inventory switch (Working / Demonstration), quick find (`/` focuses it; ID, name, tag or model; Enter opens the battery), freshness status, refresh, messages (unread count), open the full application, and My account. The address keeps the area (`/console?area=batteries`) so a link opens the right place.

## Batteries workspace

- **Views** are starting criteria of the shared query (`lib/console/views.ts`): All active, In store, In use, Inspection concern, No inspection recorded, My batteries, New arrivals, Scrapped, All records. Opening New arrivals advances the viewer's arrival acknowledgement exactly as the web New arrivals action does; nothing else acknowledges.
- **Filters**: search, loan status, owner, and More filters (inspection, model, chemistry, storage room, holder, lifecycle). Applied criteria show as removable chips with Clear filters. The shared query gained one criterion, `inspection: all | concern | none` (latest valid record states a concern / no valid record), so exports match the view.
- **Columns**: ID (sticky), name, status with holder, owner, model, chemistry, registered storage, latest inspection by default; capacity, voltage, holder, tag, last observation, latest checkout, registration, manufacture and first-use dates, manufacture age and latest charge on demand. Unknown values sort last in both directions with Battery ID ties. Sorting on a column without a shared sort key changes only the view; exports keep the standard order (the header tooltip says so).
- **Keyboard**: arrows, Page Up/Down, Ctrl+Home/End, Space (select), Shift for ranges, Ctrl+A, Enter (summary), F2 (edit), Esc (close).
- **Summary panel**: responsibility, specifications, registered storage versus last observation (with source), inspection summary, usage and recent history, with Full record (the shared `BatteryDetails`, where inspections, charges and corrections are recorded), Edit in grid and Export.

## Editing saved records (administrators)

1. Turn on Edit. Editable cells (name, model, chemistry, capacity, voltage, tag, owner, storage room, manufacture and first-use dates) are tinted. Enter saves the cell and moves down, Tab moves right, Esc cancels. Values are validated with the server's limits as they are typed; invalid cells keep the typed text and show the reason.
2. **Set a field for the selection** applies one value (owner, room, model, chemistry, capacity, voltage, dates) to every selected active battery as unsaved changes. Retired batteries and batteries with an unresolved save are skipped.
3. **Review and save** lists every battery with before and after values and the version it was loaded at. Problems (invalid cells, retired records, unavailable rooms, inactive new owners, tag already assigned, dates in the future or out of order, a record changed since editing started) are listed and excluded before anything is sent.
4. Each battery is a separate `operator_edit` request. **This is not a batch transaction**: one rejection does not affect the others, and the dialog says so. Requests are written to this browser's storage before sending and removed only after a verified receipt or a reserved final rejection (`lib/console/edit-journal.ts`, `components/console/use-metadata-edits.ts`).
5. An interrupted request shows **Outcome unknown** with **Check outcome** (query-only `operator_edit_outcome`) and **Send original again** (the same request ID and payload; the server returns the original outcome if it already committed). A request known never to have been received can be discarded. Unresolved requests survive reloads, block new edits to that battery and are listed above the grid.
6. If the record changed on the server while a draft was open, the draft is marked and **Keep my changes** re-applies only the edited fields on top of the latest version, deliberately; the server's version guard remains the authority.

## Verification (local, 4 Nov 2026)

Environment: the owner's Windows machine, an exported copy of this branch at `..\bs-web` with its own `npm ci`, `scripts/start-console-dev.mjs` (development server with a private fictional database: all migrations, fictional administrator and staff accounts, the Demonstration inventory). A Chromium-based browser was used against `http://127.0.0.1:5190/console`. No hosted service or real data was touched.

- On the Windows copy: `npm run typecheck` pass; `npm run lint` pass (no errors; the two existing `react-hooks/refs` errors in `task-plan-details.tsx` are fixed in this branch); `npm run build` pass. Full domain suite: 992 tests, 948 passed, 44 failed, all known environment failures: 43 local Miniflare `fetch failed` errors from parallel Workers on Windows (the five affected files pass when run one at a time: scanning 16/16, sorting-teaching-groups 16/16, task-plans 31/31, teaching-checkouts-store 26/26, workflow-reliability 18/18) and the USB test that needs PowerShell 7, as recorded for the R3 merge on 2 Nov.
- `tests/console-management.test.mjs` (13 tests): due states on Sydney dates, due-work ordering, overview counts, arrivals, cell parsing, exact edit payloads verified against the server receipt verifier, refused edits, inactive-owner retention, draft staleness, journal persistence and damage handling, outcome settlement, views as shared-query criteria, sort order.
- Browser checks against the real local Worker and D1: overview with seeded loans, inspections and three task plans; grid views, columns and summary panel; in-grid edits of three batteries saved and read back; one room set for two selected batteries; a competing edit made between review and save was refused ("Not saved") and the rebased edit then saved; a simulated lost response after the server committed showed Outcome unknown, and Check outcome returned the verified receipt; a request that never left the browser survived a page reload, Check outcome reported it as not received, and Send original saved it; task completion from the due-work queue; a staff account sees no Admin area and no Edit; empty Working inventory; widths 1440 and 1180 pixels; no browser console errors.

Not verified: running inside Microsoft Teams or SharePoint, the hosted service, browsers other than Chromium, screen readers, and large inventories (performance beyond a few hundred rows). The full domain suite was not run with every file in series.

## Deployment dependencies

- The console needs the merged line deployed: `operator_edit` depends on migration 0023, and the `inspection` criterion is ignored by the hosted R3 export (so filtered exports would include everything) until the new server is live.
- Deploy `integration/r3-merge` (now containing the baseline and the lint fix) together with the console branch, following the existing hosted procedure, after owner confirmation.

## Embedding in Teams (designed, not implemented)

Tenant check (owner, 4 Nov 2026): the UNSW tenant allows the Microsoft **Website** tab app. The owner added a Website tab to the Team F channel through ＋ → Apps → Website and the external page displayed inside Teams. The Loop "existing page" and Lists entries in the same menu are not this route. The website tab is therefore the planned entry; it still needs the change below before the console can sign in inside it.

A Teams website tab loads the page in a cross-site iframe. The hosted service currently refuses that, by design:

- the hosted gateway (`deploy/integration/http-gateway.mjs`) sends `X-Frame-Options: DENY` and rejects cross-site navigations that are not top-level documents (`sec-fetch-dest: iframe`);
- the session cookie is `SameSite=Strict` (`lib/credentials.ts`) and the gateway requires that, so no session would be sent inside the frame.

Proposed change, to be built and tested in Teams before deployment: allow `frame-ancestors` for the Teams and SharePoint origins only (verify the current origins first), accept iframe navigations from those origins for document routes, and issue a separate partitioned, `SameSite=None; Secure` session for embedded sign-in, keeping the existing Origin checks on every write. Until then the reliable entry is a link in the channel (or a SharePoint quick link) that opens `/console` in the browser; the console already detects embedding and offers to open itself in the browser.

## Next steps

1. Owner review of the console on the local server; adjust.
2. Deploy the merged line and the console (owner confirmation), then add the channel link.
3. Embedding change above, tested inside the owner's Teams.
4. Candidates after pilot feedback: batch inspection recording (one form, separate requests per battery), saved custom views, CSV import review through the operator import contract (migration 0024), a model template area.
