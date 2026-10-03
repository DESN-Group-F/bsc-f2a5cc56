# Battery retirement and permanent removal

All active staff, including administrators, can use **Intake & removal → Retire or remove**. All staff can inspect **Removal history** and download the retained records. These actions permanently close an asset for subsequent use; they do not physically delete its database row or establish that a real disposal procedure occurred.

## Review assets before saving

1. Choose **Manual selection** or **Tag entry**. No real RFID reader is connected. Manual selection includes assets without registered tags; tag entry requires their exact recorded tag. One input source is used per confirmation.
2. Select active batteries with no current loan and add them to **Reviewed queue**, or enter a recorded tag to queue it. An on-loan battery must first use **Scan return**. Search and **Clear filters** preserve the queue.
3. Remove mistakes from the queue and choose all or individual rows. The queue retains reviewed versions and tags; newer database state is not silently substituted.
4. Choose **Scrapped** or **Permanently removed**. **Reason — optional** applies to the selected batch; leave it blank if no reason is recorded. Optionally supply a known destination for permanent removal.
5. Select **Confirm selected** or **Confirm all queued**, including when Reason is blank. Up to 100 assets are confirmed in one atomic transaction. A single stale binding, active loan or changed authorization rejects the whole selected batch. Earlier successful confirmations remain recorded. Unselected items remain in the review queue. Empty or whitespace-only reasons remain missing database evidence and appear as **Not recorded**; the software does not invent a reason.

Scrapped indicates a recorded retirement decision. Permanently removed indicates an asset leaving the managed register, for example a known transfer. Neither state is an ordinary loan. Both retain the responsible owner, previous storage, tag, original registration time and complete history. The tag and permanent ID cannot be recycled. Recorded terminal assets cannot be borrowed, returned, edited, reactivated or physically deleted through this prototype. No disposal method or safety certification is prescribed by the software.

## Recover a confirmation

The exact account/inventory-bound request is preserved in this tab before sending. An uncertain or mismatched response freezes its bindings, reason and source. Use **Retry exact removal** to obtain the original result without duplicating the action. Account changes do not establish that a previous request failed. Terminal rejection reservations prevent a delayed request from changing the batch after a final rejection.

Queue recovery is limited to the same account, dataset and intact browser tab storage. A storage error blocks new writes and keeps the recovery candidate. Restore storage access and follow **Restore request recovery**. Closing a tab, clearing storage or switching devices is outside this guarantee. Saved server outcomes and audit events remain available independently of the local draft.

## Find and download retained records

**Removal history** lists closed assets with status, date, reason and any destination. Search or choose a removal status; **Clear filters** resets both. Open an asset ID for its specifications and complete evidence. **Download matching records** captures the current matching IDs and opens the information-section picker; this download cannot expand to unrelated inventory. Summary and complete detail formats remain available.

The normal register defaults to **Active batteries**. Under **Filter → Battery details → Record status**, choose **All including removed**, **Scrapped** or **Permanently removed** to inspect and export archived records with other inventory criteria. **In store** and **On loan** always refer to active assets. **My batteries** can expose the same archive while preserving the account-based owner scope; **My loans** remains a current-loan view. Complete history downloads retain the original actor, exact reviewed bindings, before/after evidence, reason, source and server timestamp.

Terminal records preserve historical storage and observations; those fields are not claims of current physical presence. Existing periodic-plan/cycle evidence is retained and is not automatically cancelled by retirement. Administrators should review any affected active plan separately. Institutional disposal procedures, real asset verification, hardware and operational efficiency remain unvalidated. See [Validation record](validation.md) for actual software checks.
