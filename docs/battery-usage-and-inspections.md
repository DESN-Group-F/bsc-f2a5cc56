# Battery age, borrowing and inspection records

6 October 2026 · Local development after frozen source 0.7.0; no source publication or hosted upgrade.

Open a battery's details to read three related but independent kinds of evidence.

| Area | Meaning | Boundary |
| --- | --- | --- |
| Age & registration | Registration time, optional manufacture date and recorded first-use date | Manufacture age is never inferred from registration. Service time ends on the Sydney retirement/removal date; missing dates remain unknown. |
| Borrowing history | Total recorded checkouts, completed/current checkouts and total checked-out time | All stored non-voided loans are counted. An open loan runs to the displayed calculation time. Earlier use outside this system is unknown. |
| Inspection records | Actual check time, authenticated inspector, explicit finding, method, notes and optional reference/measurement | Staff-entered evidence; no automated safety certification, remaining-life estimate or charge/discharge cycle count. |

Borrowing totals use complete history independently of the detail lists' 200-record display limit. Reopening a mistaken return changes its duration, not the checkout count. A voided checkout contributes neither count nor duration. Time is elapsed between actual UTC instants, including Sydney daylight-saving changes. Missing, future or inconsistent loan timestamps make the total duration unavailable; they are not silently treated as zero. Refresh details to update an ongoing duration.

## Record a check

Staff and administrators choose **Record inspection** on an active battery. Select Visual check, Functional check, Capacity measurement or Other inspection, and explicitly choose No concern observed, Concern observed or Inconclusive. Record the actual performed time in Sydney. The signed-in account is the inspector; the server separately saves the entry time and the inspector's name at recording.

Notes are required for a concern or an Other inspection. A capacity measurement requires a positive measured value in mAh and its method/conditions; the system does not compare it to a rated value or calculate health. An optional evidence reference can identify an external report, file or link; file upload is not included. No check is inferred from checkout, return, charging or task completion. These form categories are record types, not prescribed physical test procedures.

**Latest recorded inspection** uses the most recent performed time among valid entries. Expand **View inspection history** for the original findings and methods. No record is shown explicitly as **No inspection recorded**. A reported concern remains a recorded finding and does not automatically block borrowing or create a scheduled task.

## Correct and recover

Administrators choose **Mark entered in error** and supply a reason. Original records cannot be edited or deleted; separate correction evidence records who made the correction and when. A voided entry remains visible and exportable but is excluded from the latest valid inspection. Existing entries can still be corrected after battery retirement; new checks on a retired battery are unavailable.

Before a write, the browser preserves the original account, inventory, battery, request ID and exact payload in this tab's session storage. An uncertain response keeps that request for **Review saved request → Retry original request**, including after a reload. The form clears it only after verifying the receipt or receiving a reserved final rejection. Closing the dialog retains an uncertain request; closing the browser tab can end session storage. A role change does not silently discard the saved input.

## Downloads and storage

Summary and battery-record reports include checkout totals and total checked-out time, with a report timestamp and explicit units. **Complete inspection history** is an additional selectable detail section. Excel includes an **Inspection history** worksheet and hidden original inspection evidence; JSON keeps the complete selected inspection record fields. Both include entries marked as entered in error. Downloads follow the existing shared/personal/selection boundary and do not truncate history at 200 records.

Migration `0017_battery_inspections` adds inspection and correction tables plus identity, scope, version, receipt and immutable-evidence guards. It does not rewrite loan, battery or existing inspection-proposal data. No sensor integration, BMS data, cycling model, automatic safety decision, inspection schedule or life prediction is introduced.
