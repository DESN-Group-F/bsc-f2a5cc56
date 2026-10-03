# Teaching battery groups and inventory sorting

3 October 2026 · Local development after release 0.5.0 · Requirements baseline 1.18

## Open the Teaching groups workspace

Choose **Teaching groups** in the sidebar. Cards show each saved set's In store, In use and retired counts. Search group names or notes, use **Clear filters**, then choose **Open group**, **Edit group** or **Create teaching group**. Creation requires a name and a reviewed member list; notes are optional. Only a confirmed server result completes a save.

Inventory and personal battery views also place **Teaching groups** beside **All batteries / In store / In use** in the upper category row. It opens the same dedicated workspace; **Filter** remains in the toolbar below. The shortcut keeps a separate button role rather than changing the three recorded-status tabs.

**Back to previous page** appears prominently above both the group cards and an opened group. It returns to the view that opened the workspace, including My batteries or My batteries in use. A battery-list source stays mounted but hidden during this direct group visit, retaining its filters, ordering, page and selection. Changing inventory resets that list, and entering a separate scan/intake/removal workflow does not promise the same list-state preservation. Group forms and unresolved operation dialogs must be finished before returning. **All teaching groups** within an opened group returns only to the group cards.

A group contains 1–100 distinct existing batteries. Your groups belong to your account and current inventory. Working inventory and Demonstration inventory have separate sets. Another staff member can save the same group name independently. Administrators also manage only their own groups. Saved groups persist on the server, so they remain available after signing in from another device.

Edit changes the name, notes or battery selection and requires the loaded version. If another tab changes that group, your draft is retained; **Load latest group** explicitly replaces it with the latest saved version for review. Removing a group archives its definition and private evidence. The shared batteries and their histories remain available. Definition edits do not change asset ownership, use or lifecycle.

## Work with an opened group

An opened group is a fixed view of its members. It keeps **All batteries / In store / In use**, filters, ordering, selection and downloads. Retired members remain available for history review. **Clear filters** resets ordinary criteria, ordering and pagination while retaining the opened group and selected batteries. **All teaching groups** returns to the cards.

| Control | Result |
| --- | --- |
| **Check out group / Return group** | Opens one review of currently eligible members, reports excluded members and requires final confirmation |
| **Select all group members / Select filtered group members** | Selects all group members or the full matching set across pages |
| **Check out selected / Return selected** | Opens the existing reviewed movement workflow; final confirmation and eligibility checks remain required |
| **Retire or remove selected** | Stages returned active members for staff confirmation; the batch reason is optional |
| **Update selected members** | Administrators apply a common owner, registered storage, charge record or demo observation atomically |
| Individual battery details / **Edit battery** | Keeps the existing individual actions, permissions and group operation context |
| **Download / Download selected** | Downloads summaries or the chosen detailed sections, including complete stored history |
| **Group activity** | Opens the shared operation history filtered by this group's historic identity |

Other criteria can hide selected rows, so review the full chosen-battery list before an operation. If another tab removes selected members from the group, they require explicit removal from the selection before a new group operation or selected download. A stale reviewed group version cannot silently become a different member list.

Fixed membership does not change automatically when an asset is borrowed, reassigned or retired. Already-used assets cannot be checked out again; retired assets retain history/download access but cannot enter movements or metadata edits. Staff may register, move and retire assets; administrator-only saved-record edits, charges, demo observations and reasoned corrections keep their existing boundaries. Checkout is always to the signed-in staff account.

## Add batteries during scanning and intake

In **Scan checkout / Scan return**, select manual candidates and choose **Add selected to teaching group**. Choose an existing set or create a new one; existing membership is combined without duplicate IDs and reviewed against its loaded version. Completed session records also support selected-member or whole-session additions. An addition above 100 members is rejected rather than truncated. Adding batteries to a group does not retroactively relabel earlier movement history.

To record a scanned operation with group context, choose **Process as teaching group** before queuing or completing movements. This selects Batch mode and restricts candidates to that reviewed group. Review the queue and confirm it. If Continuous mode is deliberately selected afterward, each confirmed battery becomes a separate recorded operation. Start a new session to change the selected group after completed movements.

In **New battery intake**, only server-confirmed registrations can be selected for **Add selected to teaching group** or **Add registered batteries to group**. Queued scans, rejected drafts and uncertain registration results are not registered assets. Adding confirmed records leaves the intake station open.

Battery inventory and personal views still offer **Save as teaching group** and the optional **Filter → Teaching groups** criterion. Selection can span pages and filters. These ordinary views retain their fixed personal boundaries; unavailable members are reported. Their **Clear filters** removes the optional group criterion. This differs from the opened group's fixed boundary.

## Review and download group activity

Shared **Activity history** presents an actual group operation as one entry with the recorded group name and affected-member count. Expand **View … recorded battery actions** to see the original per-battery evidence and open individual histories. Server-recorded name, group version, operator and actual member IDs survive later renaming, member changes or archiving. Definition edits stay private to the account; actual inventory operations are shared business evidence.

Filter by historic group or search across the main entry and its member evidence. A member match retains the complete operation. **Clear filters** resets criteria without clearing selected operations. **My activity** keeps the authenticated operator's fixed scope.

**Download activity** offers selected operations or all matching operations:

- **Operation summaries and recorded group names** retain the group name, count and selected operation records without expanding member IDs or evidence. Excel, CSV and JSON are available; ordinary individual actions retain their own records.
- **Include group battery details** adds original **Activity members** evidence and selectable complete battery sections. Excel and JSON retain all tables. Battery-detail sections reflect the export-time records and histories; the original operation-member evidence remains separately identified.

Selected operation IDs ignore ordinary filters but remain within the authenticated activity scope. Missing selections reject the whole download rather than silently dropping records.

## Sort filtered results

Open **Filter → Sort order**. Choose **Sort by**, then **Ascending** or **Descending**.

| Sort field | Compared value |
| --- | --- |
| Battery ID / Battery name | Natural English text order |
| Registration / Manufacture / Latest checkout / Latest charge / Latest observation | Date or timestamp, earlier to later in ascending order |
| Age since manufacture / Time in service | Elapsed days as of the current Sydney date; descending puts older assets first |
| Capacity / Voltage / Latest charging duration | Numeric value, smaller to larger in ascending order |

Descending reverses known values. Missing dates or parameters stay last in both directions. Equal values use Battery ID ascending order, with an exact-string fallback for equivalent natural IDs. Sorting changes the whole matching set before pagination and carries into the downloaded Batteries table for filtered, current-page, selected and detailed exports. Export metadata records the ordering; complete histories retain their records and evidence.

**Applied filters** shows nondefault ordering and removable ordinary criteria. **Clear filters** restores Battery ID ascending and resets pagination. It preserves selected batteries, the current inventory and the fixed personal or opened-group scope.

## Current status and recovery

The three quick tabs are **All batteries / In store / In use**. In use means there is an active recorded checkout to a staff holder. In store means no active checkout is recorded for that active asset. These states do not certify physical presence, reader detection or electrical use. Historical loan IDs, checkout times and return evidence remain unchanged.

Before saving a group, the interface preserves its exact request in account/inventory-bound tab storage. An uncertain result freezes that request; use **Retry exact group request**, including after reopening in the same tab, account and inventory. Recovery does not automatically resend. Storage must remain available and intact; closing the tab or changing devices does not carry the unresolved request over. A successfully saved group is server-persistent and has no such device restriction.

Movement, removal and administrator bulk updates also preserve their exact requests and require matching server receipts. Native account authority, reviewed group/member versions and asset/loan bindings are checked at the commit boundary. An unresolved write must be retried before a replacement operation. If a confirmed bulk update's display refresh fails, the dialog reports it as saved and requires closing/refreshing rather than issuing another update.

This workflow has isolated real-D1 and actual component-handler checks. Browser visual acceptance, real reader behavior and staff time savings remain unverified. The new controls are local development changes; the frozen 0.5.0 tag and hosted environments have not been updated.
