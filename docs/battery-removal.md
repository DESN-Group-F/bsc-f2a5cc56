# Battery retirement and permanent removal

All active staff, including administrators, can use **Intake & removal → Retire or remove**. All staff can inspect **Removal history** and download retained records. Retirement closes an asset for subsequent borrowing; it does not delete its database row or establish that a real disposal procedure occurred. The user-approved local extension of 8 October 2026 adds recovery and a separate administrator deletion action for Scrapped batteries.

## Review assets before saving

1. Choose **Manual selection** or **Tag entry**. No real RFID reader is connected. Manual selection includes assets without registered tags; tag entry requires their exact recorded tag. One input source is used per confirmation.
2. Select active batteries with no current loan and add them to **Reviewed queue**, or enter a recorded tag to queue it. An on-loan battery must first use **Scan return**. Search and **Clear filters** preserve the queue.
3. Remove mistakes from the queue and choose all or individual rows. The queue retains reviewed versions and tags; newer database state is not silently substituted.
4. Choose **Scrapped** or **Permanently removed**. **Reason — optional** applies to the selected batch; leave it blank if no reason is recorded. Optionally supply a known destination for permanent removal.
5. Select **Confirm selected** or **Confirm all queued**, including when Reason is blank. Up to 100 assets are confirmed in one atomic transaction. A single stale binding, active loan or changed authorization rejects the whole selected batch. Earlier successful confirmations remain recorded. Unselected items remain in the review queue. Empty or whitespace-only reasons remain missing database evidence and appear as **Not recorded**; the software does not invent a reason.

Scrapped indicates a recorded retirement decision. Permanently removed indicates an asset leaving the managed register, for example a known transfer. Neither state is an ordinary loan. Both retain the responsible owner, previous storage, tag, original registration time and complete history. Retired assets cannot be borrowed, returned or edited. Scrapped assets may be explicitly recovered or, by administrators only, permanently deleted as described below. Permanently removed assets remain terminal. No disposal method or safety certification is prescribed by the software.

## Recover selected Scrapped assets

In **Removal history**, select the intended Scrapped rows and choose **Recover selected**. Review all battery IDs, versions, exact tags and statuses, then explicitly confirm. Both staff and administrators may recover 1–100 eligible records atomically. A selection containing Permanently removed, missing, stale or on-loan assets cannot silently become a smaller batch.

Recovery returns the asset to the active register, in store, without creating a checkout. It preserves identity, name, specifications, owner, storage, original registration/first-use/manufacture dates, inspections and complete prior history. The original scrap event remains and a new dated, attributed recovery event is added. Recovery does not establish physical condition or safety approval; existing Concern observed evidence remains visible.

## Permanently delete selected Scrapped data

Only an administrator can choose **Delete selected records**. Review the exact selected Scrapped records in the separate deletion dialog, type **DELETE**, then explicitly confirm irreversible deletion. Unless this action is confirmed and saved, retired records remain indefinitely. Permanently removed records are ineligible for both recovery and deletion.

Deletion clears the chosen battery's own record, loans, charges, inspections/corrections, observations and asset audit, and removes system-held structured snapshots of that asset from related records. Other assets, Task/group definitions and independent human notes remain, including notes that mention the deleted battery. Existing Task/group references retain the minimal BAT ID with a deleted-record indication; an existing Task may keep or explicitly remove that target, but cannot newly add a deleted ID. Existing cycle evidence is not silently retargeted or cancelled.

The shared deletion evidence contains only BAT ID, deleting native account and time. Technical request reservations and irreversible tag hashes also remain to prevent identity/tag reuse and late original writes. Deleted details/history cannot be viewed or downloaded. Independent notes, previous downloads and backups are outside this database deletion's scope; there is no product recovery for deleted data.

All selected records commit together under active native authority, reviewed versions/tags and no-active-loan guards. Concurrent structured evidence changes cause a whole-batch rejection and require a fresh review. Long production-history cleanup performance has not been measured.

Both actions preserve their original account/dataset-bound request before sending. A network failure or mismatched receipt keeps that exact request locked for explicit retry, including when deleted records have disappeared from the list. Success appears only after verifying the matching server receipt. A reserved final rejection permits a new explicit review; an ordinary uncertain error does not discard the original request. Other unfinished workflows and inventories cannot bypass this recovery boundary.

## Recover a confirmation

The exact account/inventory-bound request is preserved in this tab before sending. An uncertain or mismatched response freezes its bindings, reason and source. Use **Retry exact removal** to obtain the original result without duplicating the action. Account changes do not establish that a previous request failed. Terminal rejection reservations prevent a delayed request from changing the batch after a final rejection.

Queue recovery is limited to the same account, dataset and intact browser tab storage. A storage error blocks new writes and keeps the recovery candidate. Restore storage access and follow **Restore request recovery**. Closing a tab, clearing storage or switching devices is outside this guarantee. Saved server outcomes and audit events remain available independently of the local draft.

## Find and download retained records

**Removal history** lists closed assets with status, date, reason and any destination. Search or choose a removal status; **Clear filters** resets both. Open an asset ID for its specifications and complete evidence. **Download matching records** captures the current matching IDs and opens the information-section picker; this download cannot expand to unrelated inventory. Summary and complete detail formats remain available.

The normal register defaults to **Active batteries**. Under **Filter → Battery details → Record status**, choose **All including removed**, **Scrapped** or **Permanently removed** to inspect and export archived records with other inventory criteria. **In store** and **In use** always refer to active assets. **My batteries** can expose the same archive while preserving the account-based owner scope; **My batteries in use** remains a current-loan view. Complete history downloads retain the original actor, exact reviewed bindings, before/after evidence, reason, source and server timestamp. Minimal deletion evidence is separate from selectable retained assets and does not offer a complete-history download.

Terminal records preserve historical storage and observations; those fields are not claims of current physical presence. Existing periodic-plan/cycle evidence is retained and is not automatically cancelled by retirement. Administrators should review any affected active plan separately. Institutional disposal procedures, real asset verification, hardware and operational efficiency remain unvalidated. See [Validation record](validation.md) for actual software checks.
