# Reviewed first-time battery intake

Use **Intake & removal → New battery intake → Start demo intake**. Configure common specifications, responsible owner and J18 storage once, then scan into a pending review list. Scanning alone creates no registered battery. Returning an existing battery uses **Scan return**.

This workflow accepts demonstration inputs only. No RFID reader, verified physical location or real school asset is inferred. Starting intake opens the shared Demonstration inventory. The station remains open until **Exit intake**.

## Configure and scan

1. Use **Find a model** to review a reference, saved template or consistent registered model, or enter manual details. Check the exact variant, capacity qualifications and unknown values. Conflicting entered values require explicit replacement selection.
2. Choose an active responsible staff owner and J18. The room is optional. Demo room and Demo workspace remain unverified placeholders. Unknown manufacture date and specifications stay blank.
3. Review first use: default **Start at each battery's intake**, a known first-use date, or **Not recorded**. Select **Confirm common details and start scanning**. This prepares defaults, without registering assets.
4. Choose **Simulate next new battery**, or enter a unique `DEMO-INTAKE-` tag and press Enter / **Simulate this tag**. Each read adds one draft with its own copied common details and device scan time. Up to 200 drafts may be queued.
5. Use **Edit** to correct an individual tag, name/model, specifications, ownership, storage or dates. Its original device scan time is retained. **Remove** discards an accidental read without creating history or consuming a permanent ID. Changing common details affects subsequent scans, while earlier entries retain their own values.

Editable model suggestions preserve their reviewed source hash. Changing values records explicit overrides. If an inventory-derived reference became stale after other registrations or source changes, review it again or explicitly choose **Use manual model details** in the draft editor; this retains entered specifications without pretending the source was revalidated.

## Review and confirm

Use row selection or **Select all intake drafts**, then **Confirm selected** or **Confirm all**. Confirmation processes entries individually, in queue order. Verified successes leave the pending list and appear under **Registered in this station** with permanent IDs. Unselected and rejected drafts remain editable. A later failure does not undo earlier successful entries.

An uncertain response stops the remaining confirmations. The current draft and its exact request cannot be edited, removed or replaced until **Retry exact confirmation** establishes the original result. Retrying an already saved request returns its original ID and dates; it does not register another asset. Retry does not automatically submit the remaining drafts.

IDs use the permanent shared-inventory form `BAT-00000001`, independent of staff accounts and product types. The server assigns an ID only when registration succeeds. Existing identities and tags, including retired assets, remain reserved. Confirming a configured model or queue alone does not create loans, charging evidence or location observations.

## Dates and evidence

| Field | Meaning |
| --- | --- |
| Scanned at (this device) | Timestamp recorded by the browser when the draft was staged. Saved in the confirmed audit as `scannedAt` with `scanTimeSource: client_demo_draft`; it is not a verified hardware reading or server timestamp. Older preserved requests without this evidence remain Not recorded. |
| Registered at (server) | Exact UTC server timestamp of the first successful confirmation, retained in the original `created_at` and exposed as `registeredAt`. Subsequent edits and loans do not change it. |
| Default first use | Sydney calendar date of confirmed server registration. This operational default does not establish prior physical use. |
| Known first-use date / Not recorded | Explicit actual earlier date, or unknown service start. |
| Manufactured on | Optional actual production date; blank remains unknown. It is never inferred from scanning, registration, publication or first use. |

Age since manufacture and time in service use their distinct lifecycle dates. Invalid/future dates and first use before manufacture are rejected. Summary and specification downloads include original registration time and calculated age fields. Complete operation-history downloads retain scan-source evidence, authoritative model references and per-asset overrides. These values do not certify battery condition, remaining capacity, disposal or safety.

## Recovery and current boundaries

The complete editable queue, selection, common settings, verified receipts and any unresolved confirmation are saved in account/dataset-specific session storage before a change is accepted or a request is sent. **Exit intake** preserves the draft. Reopening in the same account and intact tab resumes it without automatically sending anything. Clearing storage, closing a tab or switching devices is outside this guarantee.

Storage read/write failures block new confirmations. **Restore draft recovery** preserves the captured state after storage access is restored; unreadable initial recovery requires reopening after restoring access. Do not interpret a timeout as failure. Authentication loss cannot establish the outcome of a prior confirmation. Sign in with the original account before resolving its preserved request.

The server atomically guards native authorization, owner and location versions, selected model evidence, tag uniqueness, numbering and session configuration. A final rejection reserves the same request key against delayed writes. Earlier source bindings remain preserved; the session's own new assets do not automatically invalidate unchanged entries.

Real RFID transport, verified rooms, institutional integration and actual school battery data remain pending. Browser interaction and staff efficiency have not been verified for this workflow. Actual automated outcomes and limitations are recorded in [Validation record](validation.md). See [Battery retirement and permanent removal](battery-removal.md) for the other workspace tabs.
